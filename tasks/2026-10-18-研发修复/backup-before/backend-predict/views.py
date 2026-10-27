from rest_framework import viewsets, status
from rest_framework.decorators import api_view, action, permission_classes
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.views import APIView
from rest_framework.pagination import PageNumberPagination
from django.shortcuts import get_object_or_404
from django.db import IntegrityError
from django.db import transaction
from django.db.models import Prefetch
from django.conf import settings
from .serializers import (
    CassavaImageListSerializer, CassavaImageSerializer, SegmentationResultSerializer, 
    PredictionResultSerializer, PredictionCorrectionSerializer, ProcessingTaskSerializer,
    FolderSerializer, ResourceShareSerializer, SystemSettingSerializer
)
from .models import (
    CassavaImage, SegmentationResult, PredictionResult, 
    ProcessingTask, Folder, ResourceShare, GuestUsage, SystemSetting, PredictionCorrection
)
from .permissions import HasPermission, IsRootUser, is_miniapp_request
from .view_mixins import PermissionMixin, TaskProcessingMixin, ResponseFormatMixin, FileUploadMixin
from .services import ShareService, PredictionService, ImageService
from .oss_service import check_oss_configured, upload_file_to_oss, delete_file_from_oss
from .storage_utils import build_preview_storage_key
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
import logging
import os
import uuid
import io
from PIL import Image
import numpy as np
from .mask_utils import calculate_mask_metrics, load_mask_file

logger = logging.getLogger(__name__)
upload_logger = logging.getLogger('predict.upload')

class StandardResultsSetPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 1000

class PredictionResultPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 2000
    
    def get_page_size(self, request):
        # Try query param first
        if self.page_size_query_param:
            try:
                val = int(request.query_params[self.page_size_query_param])
                if val > 0:
                    return min(val, self.max_page_size)
            except (KeyError, ValueError):
                pass
        
        # Try SystemSetting
        try:
            setting = SystemSetting.get_solo()
            return setting.max_display_results
        except Exception:
            pass
            
        return self.page_size

class CassavaImageViewSet(viewsets.ModelViewSet, PermissionMixin, TaskProcessingMixin, FileUploadMixin, ResponseFormatMixin):
    """
    木薯图像管理视图集
    """
    queryset = CassavaImage.objects.select_related('folder', 'owner').all()
    serializer_class = CassavaImageSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [HasPermission]
    pagination_class = StandardResultsSetPagination
    permission_codename = 'view_image'
    allow_guest = True
    perms_map = {
        'list': 'view_image',
        'retrieve': 'view_image',
        'create': 'upload_image',
        'update': 'edit_image',
        'partial_update': 'edit_image',
        'destroy': 'delete_image',
        'upload_files': 'upload_image',
        'upload_batch': 'upload_image',
    }

    def get_queryset(self):
        queryset = super().get_queryset()
        
        # 访客只能看到访客资源白名单中的图片 (且状态为active)
        # 这里实际上实现了 "访客之间共享"：所有访客看到的是同一个白名单池
        # 并且不受 "只能是root共享" 的限制 (只要在GuestAccessibleResource表中即可)
        if not self.request.user.is_authenticated:
            from .models import GuestAccessibleResource
            # Miniapp requests use the same resource boundary as browser guests.
            whitelisted_ids = GuestAccessibleResource.objects.filter(
                resource_type='image',
                is_active=True
            ).values_list('resource_id', flat=True)
            queryset = queryset.filter(id__in=whitelisted_ids)
        elif hasattr(self, 'filter_queryset_by_permission'):
            queryset = self.filter_queryset_by_permission(queryset)

        folder_filter = (self.request.query_params.get('folder') or '').strip()
        if folder_filter == 'uncategorized':
            queryset = queryset.filter(folder__isnull=True)
        elif folder_filter:
            try:
                queryset = queryset.filter(folder_id=int(folder_filter))
            except (TypeError, ValueError):
                logger.warning("Ignoring invalid image folder filter: %s", folder_filter)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return CassavaImageListSerializer
        return CassavaImageSerializer

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.user.is_authenticated and ('folder' in request.data) and (not request.user.is_superuser):
            folder_val = request.data.get('folder')
            if folder_val not in (None, '', 'null'):
                folder = get_object_or_404(Folder, id=folder_val)
                if folder.owner_id != request.user.id:
                    if not ShareService.check_permission(request.user, 'folder', folder, 'edit'):
                        return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        if request.user.is_authenticated and (not request.user.is_superuser) and instance.owner_id != request.user.id:
            if not ShareService.check_permission(request.user, 'image', instance, 'edit'):
                return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.user.is_authenticated and ('folder' in request.data) and (not request.user.is_superuser):
            folder_val = request.data.get('folder')
            if folder_val not in (None, '', 'null'):
                folder = get_object_or_404(Folder, id=folder_val)
                if folder.owner_id != request.user.id:
                    if not ShareService.check_permission(request.user, 'folder', folder, 'edit'):
                        return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        if request.user.is_authenticated and (not request.user.is_superuser) and instance.owner_id != request.user.id:
            if not ShareService.check_permission(request.user, 'image', instance, 'edit'):
                return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.user.is_authenticated and (not request.user.is_superuser) and instance.owner_id != request.user.id:
            if not ShareService.check_permission(request.user, 'image', instance, 'manage'):
                return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def perform_destroy(self, instance):
        super().perform_destroy(instance)

    @action(detail=False, methods=['post'], url_path='upload-files')
    def upload_files(self, request):
        """
        批量上传图片文件
        """
        files = request.FILES.getlist('files')
        folder_id = request.data.get('folder_id')
        check_duplicate = request.data.get('check_duplicate') == '1'
        request_id = getattr(request, 'request_id', '-')
        user_id = request.user.id if request.user.is_authenticated else 'anonymous'
        storage_backend = getattr(settings, 'FILE_STORAGE_BACKEND', 'local')

        upload_logger.info(
            'upload_start request_id=%s user_id=%s folder_id=%s file_count=%s check_duplicate=%s storage=%s',
            request_id,
            user_id,
            folder_id or '',
            len(files),
            check_duplicate,
            storage_backend,
        )
        
        # Check file size limit
        try:
            setting = SystemSetting.get_solo()
            limit_mb = setting.upload_size_limit_mb
            limit_bytes = limit_mb * 1024 * 1024
            
            for file in files:
                if file.size > limit_bytes:
                    upload_logger.warning(
                        'upload_rejected_size request_id=%s user_id=%s name=%s size=%s limit_mb=%s',
                        request_id,
                        user_id,
                        file.name,
                        file.size,
                        limit_mb,
                    )
                    return Response({'error': f'File {file.name} exceeds size limit of {limit_mb}MB'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            pass

        folder = None
        if folder_id:
            try:
                folder = Folder.objects.get(id=folder_id)
            except Folder.DoesNotExist:
                upload_logger.warning(
                    'upload_rejected_folder_missing request_id=%s user_id=%s folder_id=%s',
                    request_id,
                    user_id,
                    folder_id,
                )
                return Response({'error': 'Folder not found'}, status=status.HTTP_404_NOT_FOUND)
            if request.user.is_authenticated and (not request.user.is_superuser) and folder.owner_id != request.user.id:
                if not ShareService.check_permission(request.user, 'folder', folder, 'edit'):
                    upload_logger.warning(
                        'upload_rejected_permission request_id=%s user_id=%s folder_id=%s folder_owner_id=%s',
                        request_id,
                        user_id,
                        folder_id,
                        folder.owner_id,
                    )
                    return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        
        uploaded_images = []
        duplicate_files = []
        failed_files = []
        
        for file in files:
            file_content = None
            normalized_upload = None
            # 检查重复
            if check_duplicate:
                exists_qs = CassavaImage.objects.filter(name=file.name)
                if request.user.is_authenticated and (not request.user.is_superuser):
                    exists_qs = exists_qs.filter(owner=request.user)
                exists = exists_qs.exists()
                if exists:
                    duplicate_files.append(file.name)
                    upload_logger.info(
                        'upload_duplicate_skipped request_id=%s user_id=%s name=%s folder_id=%s',
                        request_id,
                        user_id,
                        file.name,
                        folder_id or '',
                    )
                    continue

            try:
                file.seek(0)
                normalized_upload = ImageService._normalize_uploaded_image_bytes(file.read())
                if normalized_upload.get('converted'):
                    file = SimpleUploadedFile(
                        file.name,
                        normalized_upload['content'],
                        content_type='image/jpeg',
                    )
            except Exception as e:
                upload_logger.warning(
                    'upload_rejected_invalid_normalized request_id=%s user_id=%s name=%s error=%s',
                    request_id,
                    user_id,
                    file.name,
                    str(e),
                    exc_info=True,
                )
                return Response({'error': f'Invalid image content in file {file.name}: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)
            
            # 严格验证图片内容
            try:
                # 尝试打开并验证图片
                file.seek(0)
                img_verify = Image.open(file)
                img_verify.verify() # 验证文件头和结构
                # verify后需要重新seek(0)且对象不能再使用，需要重新open
                file.seek(0)
                if img_verify.format not in ['JPEG', 'PNG', 'BMP', 'WEBP', 'TIFF']:
                     raise Exception(f"Unsupported image format: {img_verify.format}")
            except Exception as e:
                upload_logger.warning(
                    'upload_rejected_invalid_image request_id=%s user_id=%s name=%s error=%s',
                    request_id,
                    user_id,
                    file.name,
                    str(e),
                    exc_info=True,
                )
                return Response({'error': f'Invalid image content in file {file.name}: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)

            # 创建图片记录
            try:
                file_content = file.read()
                original_name = file.name
                _, ext = os.path.splitext(original_name)
                safe_ext = (ext or '').lower()

                # 构建存储路径 (OSS Key 或 本地路径)
                if folder:
                    file_path = f"images/{folder.id}/{uuid.uuid4().hex}{safe_ext}"
                else:
                    file_path = f"images/{uuid.uuid4().hex}{safe_ext}"
                
                saved_path = file_path
                
                # 检查OSS配置
                if check_oss_configured():
                    # 上传到OSS
                    result = upload_file_to_oss(file_path, file_content)
                    
                    if result.get('status_code') != 200:
                        raise Exception(f"OSS upload failed: {result.get('error')}")
                    
                    # OSS 上传成功，使用 file_path 作为 oss_key
                    saved_path = file_path
                else:
                    # 本地存储
                    # 检查文件是否存在，如果存在则自动重命名（Django default_storage 会自动处理）
                    saved_path = default_storage.save(file_path, ContentFile(file_content))
                
                # Generate Preview
                preview_oss_key = None
                try:
                    # Create image from content
                    img = Image.open(io.BytesIO(file_content))
                    
                    # Convert to RGB if necessary
                    if img.mode in ('RGBA', 'P'):
                        img = img.convert('RGB')
                        
                    # Calculate new size maintaining aspect ratio
                    # Max dimension 600px (optimized for cost reduction)
                    # Changed from 800px to reduce storage size by ~30%
                    max_size = (600, 600)
                    img.thumbnail(max_size)
                    
                    # Save to buffer
                    # Quality reduced from 70 to 60 for additional 15-20% size reduction
                    thumb_io = io.BytesIO()
                    img.save(thumb_io, format='JPEG', quality=60)
                    thumb_content = thumb_io.getvalue()
                    
                    preview_path = build_preview_storage_key(folder=folder)
                    
                    # Upload/Save Preview
                    if check_oss_configured():
                        upload_file_to_oss(preview_path, thumb_content)
                        preview_oss_key = preview_path
                    else:
                        preview_oss_key = default_storage.save(preview_path, ContentFile(thumb_content))
                        
                except Exception as e:
                    upload_logger.warning(
                        'upload_preview_failed request_id=%s user_id=%s name=%s storage_key=%s error=%s',
                        request_id,
                        user_id,
                        file.name,
                        saved_path,
                        str(e),
                        exc_info=True,
                    )
                    # Don't fail the upload if preview generation fails
                
                # 创建记录
                image = CassavaImage.objects.create(
                    name=original_name,
                    oss_key=saved_path, 
                    preview_oss_key=preview_oss_key,
                    folder=folder,
                    size=file.size,
                    owner=request.user if request.user.is_authenticated else None
                )
                uploaded_images.append(image)
                upload_logger.info(
                    'upload_file_saved request_id=%s user_id=%s image_id=%s name=%s storage_key=%s preview_key=%s size=%s storage=%s',
                    request_id,
                    user_id,
                    image.id,
                    original_name,
                    saved_path,
                    preview_oss_key or '',
                    file.size,
                    storage_backend,
                )
            except Exception as e:
                error_message = str(e)
                upload_logger.exception(
                    'upload_file_failed request_id=%s user_id=%s name=%s folder_id=%s storage=%s error=%s',
                    request_id,
                    user_id,
                    file.name,
                    folder_id or '',
                    storage_backend,
                    error_message,
                )
                failed_files.append({
                    'name': file.name,
                    'error': error_message,
                })
        
        if failed_files and not uploaded_images:
            upload_logger.error(
                'upload_finished_failed request_id=%s user_id=%s uploaded_count=0 failed_count=%s duplicate_count=%s',
                request_id,
                user_id,
                len(failed_files),
                len(duplicate_files),
            )
            return Response({
                'error': 'Upload failed',
                'uploaded_count': 0,
                'failed': failed_files,
                'duplicates': duplicate_files,
            }, status=status.HTTP_502_BAD_GATEWAY)

        if failed_files:
            upload_logger.warning(
                'upload_finished_partial request_id=%s user_id=%s uploaded_count=%s failed_count=%s duplicate_count=%s',
                request_id,
                user_id,
                len(uploaded_images),
                len(failed_files),
                len(duplicate_files),
            )
            return Response({
                'message': 'Upload completed with errors',
                'uploaded_count': len(uploaded_images),
                'failed': failed_files,
                'duplicates': duplicate_files,
                'results': self.get_serializer(uploaded_images, many=True).data,
            }, status=status.HTTP_207_MULTI_STATUS)

        if duplicate_files:
             upload_logger.info(
                 'upload_finished_duplicates request_id=%s user_id=%s uploaded_count=%s duplicate_count=%s',
                 request_id,
                 user_id,
                 len(uploaded_images),
                 len(duplicate_files),
             )
             # 如果有重复文件且是部分成功，返回特定状态码或信息
             return Response({
                 'message': 'Upload completed with duplicates',
                 'uploaded_count': len(uploaded_images),
                 'duplicates': duplicate_files
             }, status=status.HTTP_200_OK) # 或者 207 Multi-Status

        serializer = self.get_serializer(uploaded_images, many=True)
        upload_logger.info(
            'upload_finished_success request_id=%s user_id=%s uploaded_count=%s duplicate_count=0',
            request_id,
            user_id,
            len(uploaded_images),
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='upload-batch')
    def upload_batch(self, request):
        """
        批量上传（处理 ZIP 包等）
        """
        import zipfile
        from .services import ImageService
        
        file = request.FILES.get('file')
        if not file:
            return Response({'error': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)
            
        # Check size limit
        try:
            setting = SystemSetting.get_solo()
            limit_mb = setting.upload_size_limit_mb
            limit_bytes = limit_mb * 1024 * 1024
            if file.size > limit_bytes:
                 return Response({'error': f'File exceeds size limit of {limit_mb}MB'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            pass

        folder_id = request.data.get('folder_id')
        check_duplicate = request.data.get('check_duplicate') == '1'
        force = request.data.get('force') == '1'
        
        # 检查是否是ZIP文件
        try:
            file.seek(0)
        except Exception:
            pass
        if not zipfile.is_zipfile(file):
             return Response({'error': 'Invalid zip file'}, status=status.HTTP_400_BAD_REQUEST)
             
        count = 0
        errors = []
        duplicates = []
        
        try:
            try:
                file.seek(0)
            except Exception:
                pass
            with zipfile.ZipFile(file, 'r') as zip_ref:
                # 获取ZIP中所有文件
                file_names = zip_ref.namelist()
                
                # 过滤出图片文件
                image_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}
                image_files = [f for f in file_names if any(f.lower().endswith(ext) for ext in image_extensions) and not f.startswith('__MACOSX') and not f.startswith('.')]
                
                for image_name in image_files:
                    try:
                        # 读取文件内容
                        file_content = zip_ref.read(image_name)
                        
                        # 创建一个ContentFile或BytesIO对象
                        # Django request.FILES中的对象通常有name, size, read等方法
                        # 这里我们需要构造一个类似的对象传递给ImageService
                        from django.core.files.uploadedfile import SimpleUploadedFile
                        
                        # 处理文件名（去除路径）
                        simple_name = os.path.basename(image_name)
                        if not simple_name:
                            continue
                            
                        uploaded_file = SimpleUploadedFile(simple_name, file_content)
                        
                        # 调用ImageService上传
                        # 注意：ImageService.upload_image 需要 file 对象
                        image, error = ImageService.upload_image(
                            file=uploaded_file,
                            folder_id=folder_id,
                            check_duplicate=check_duplicate,
                            force=force,
                            user=request.user if request.user.is_authenticated else None
                        )
                        
                        if image:
                            count += 1
                        else:
                            if error and error[0] == 'DUPLICATE_NAME':
                                duplicates.append(simple_name)
                            else:
                                errors.append(f"{simple_name}: {error[1] if error else 'Unknown error'}")
                            
                    except Exception as e:
                        upload_logger.exception(
                            'upload_zip_entry_failed request_id=%s user_id=%s entry=%s error=%s',
                            getattr(request, 'request_id', '-'),
                            request.user.id if request.user.is_authenticated else 'anonymous',
                            image_name,
                            str(e),
                        )
                        errors.append(f"{image_name}: {str(e)}")
                        
            return Response({
                'status': 'ok', 
                'count': count,
                'duplicates': duplicates,
                'errors': errors[:10] # 限制返回的错误数量
            })
            
        except Exception as e:
            return Response({'error': f'Failed to process zip file: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class FolderViewSet(viewsets.ModelViewSet, PermissionMixin, ResponseFormatMixin):
    """
    文件夹管理视图集
    """
    queryset = Folder.objects.all()
    serializer_class = FolderSerializer
    permission_classes = [HasPermission]  # Allow guest access controlled by HasPermission
    pagination_class = StandardResultsSetPagination
    permission_codename = 'view_folder'
    allow_guest = True
    perms_map = {
        'list': 'view_folder',
        'retrieve': 'view_folder',
        'create': 'create_folder',
        'update': 'edit_folder',
        'partial_update': 'edit_folder',
        'destroy': 'delete_folder',
        'images': 'view_folder',
        'add_images': 'edit_folder',
    }

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if getattr(self, 'action', None) not in {'list', 'retrieve'}:
            return context

        from collections import defaultdict
        from django.db.models import Count
        from .models import GuestAccessibleResource

        children = defaultdict(list)
        folder_ids = []
        for folder_id, parent_id in Folder.objects.values_list('id', 'parent_id'):
            folder_ids.append(folder_id)
            children[parent_id].append(folder_id)
        direct_counts = dict(
            CassavaImage.objects.values('folder_id').annotate(total=Count('id'))
            .values_list('folder_id', 'total')
        )
        count_map = {}

        def descendant_count(folder_id, visiting=None):
            if folder_id in count_map:
                return count_map[folder_id]
            visiting = visiting or set()
            if folder_id in visiting:
                return 0
            visiting.add(folder_id)
            total = direct_counts.get(folder_id, 0)
            total += sum(descendant_count(child_id, visiting) for child_id in children.get(folder_id, ()))
            visiting.remove(folder_id)
            count_map[folder_id] = total
            return total

        for folder_id in folder_ids:
            descendant_count(folder_id)
        context['folder_image_counts'] = count_map
        context['guest_folder_ids'] = set(
            GuestAccessibleResource.objects.filter(resource_type='folder', is_active=True)
            .values_list('resource_id', flat=True)
        )
        return context

    def perform_create(self, serializer):
        parent_id = self.request.data.get('parent')
        if parent_id and self.request.user.is_authenticated and (not self.request.user.is_superuser):
            parent = get_object_or_404(Folder, id=parent_id)
            if parent.owner_id != self.request.user.id:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied()
        serializer.save(owner=self.request.user)

    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Filter by parent folder
        parent_id = self.request.query_params.get('parent')
        if parent_id is not None:
            if parent_id == 'null' or parent_id == '':
                queryset = queryset.filter(parent__isnull=True)
            else:
                queryset = queryset.filter(parent_id=parent_id)
        # Note: If parent is not specified, we return ALL folders (flat list) or let frontend filter.
        # Usually for tree view or navigation, frontend requests with specific parent.
        # But for initial load or search, might want all. 
        # Let's keep it flexible: if 'parent' param is present, filter. If not, return all.
        
        # If guest, filter by whitelist
        if not self.request.user.is_authenticated:
            from .models import GuestAccessibleResource
            # Get whitelisted folder IDs
            whitelisted_ids = GuestAccessibleResource.objects.filter(
                resource_type='folder', 
                is_active=True
            ).values_list('resource_id', flat=True)
            return queryset.filter(id__in=whitelisted_ids)

        if hasattr(self, 'filter_queryset_by_permission'):
            return self.filter_queryset_by_permission(queryset)
        return queryset

    @action(detail=True, methods=['get'])
    def images(self, request, pk=None):
        folder = self.get_object()
        images = folder.images.all()
        if request.user.is_authenticated and (not request.user.is_superuser) and folder.owner_id != request.user.id:
            if not ShareService.check_permission(request.user, 'folder', folder, 'view'):
                return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        serializer = CassavaImageListSerializer(images, many=True, context=self.get_serializer_context())
        return self.success_response(serializer.data)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.user.is_authenticated and ('parent' in request.data) and (not request.user.is_superuser):
            parent_val = request.data.get('parent')
            if parent_val not in (None, '', 'null'):
                parent = get_object_or_404(Folder, id=parent_val)
                if parent.owner_id != request.user.id:
                    return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        if request.user.is_authenticated and (not request.user.is_superuser) and instance.owner_id != request.user.id:
            if not ShareService.check_permission(request.user, 'folder', instance, 'edit'):
                return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.user.is_authenticated and ('parent' in request.data) and (not request.user.is_superuser):
            parent_val = request.data.get('parent')
            if parent_val not in (None, '', 'null'):
                parent = get_object_or_404(Folder, id=parent_val)
                if parent.owner_id != request.user.id:
                    return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        if request.user.is_authenticated and (not request.user.is_superuser) and instance.owner_id != request.user.id:
            if not ShareService.check_permission(request.user, 'folder', instance, 'edit'):
                return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.user.is_authenticated and (not request.user.is_superuser) and instance.owner_id != request.user.id:
            if not ShareService.check_permission(request.user, 'folder', instance, 'manage'):
                return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def add_images(self, request, pk=None):
        folder = self.get_object()
        if request.user.is_authenticated and (not request.user.is_superuser) and folder.owner_id != request.user.id:
            if not ShareService.check_permission(request.user, 'folder', folder, 'edit'):
                return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        image_ids = request.data.get('image_ids', [])
        queryset = CassavaImage.objects.filter(id__in=image_ids)
        if request.user.is_authenticated and (not request.user.is_superuser):
            from django.db.models import Q
            from django.utils import timezone
            now = timezone.now()
            editable_shared_ids = list(ResourceShare.objects.filter(
                shared_with=request.user,
                resource_type='image',
                permission__in=['edit', 'manage']
            ).filter(
                Q(expires_at__isnull=True) | Q(expires_at__gt=now)
            ).values_list('resource_id', flat=True))
            queryset = queryset.filter(Q(owner=request.user) | Q(id__in=editable_shared_ids))
        updated = queryset.update(folder=folder)
        return self.success_response({'updated': updated})

    @action(detail=True, methods=['post'], url_path='delete_with_strategy')
    def delete_with_strategy(self, request, pk=None):
        folder = self.get_object()
        if request.user.is_authenticated and (not request.user.is_superuser) and folder.owner_id != request.user.id:
            if not ShareService.check_permission(request.user, 'folder', folder, 'manage'):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        strategy = request.data.get('strategy') or 'keep'
        target_folder_id = request.data.get('target_folder_id')

        folder_ids = set()
        queue = [folder.id]
        while queue:
            current = queue.pop()
            if current in folder_ids:
                continue
            folder_ids.add(current)
            children = list(Folder.objects.filter(parent_id=current).values_list('id', flat=True))
            queue.extend(children)

        images_qs = CassavaImage.objects.filter(folder_id__in=list(folder_ids))
        if request.user.is_authenticated and (not request.user.is_superuser) and folder.owner_id == request.user.id:
            images_qs = images_qs.filter(owner=request.user)

        with transaction.atomic():
            affected_images = images_qs.count()

            if strategy == 'move':
                if not target_folder_id:
                    return self.error_response("未提供目标文件夹", status_code=status.HTTP_400_BAD_REQUEST)
                try:
                    target_folder = Folder.objects.get(id=target_folder_id)
                except Folder.DoesNotExist:
                    return self.error_response("目标文件夹不存在", status_code=status.HTTP_404_NOT_FOUND)
                if request.user.is_authenticated and (not request.user.is_superuser) and target_folder.owner_id != request.user.id:
                    if not ShareService.check_permission(request.user, 'folder', target_folder, 'edit'):
                        return self.error_response("无权移动到该文件夹", status_code=status.HTTP_403_FORBIDDEN)
                images_qs.update(folder=target_folder)
            elif strategy == 'delete':
                images_qs.delete()
            else:
                images_qs.update(folder=None)

            folder.delete()

        return self.success_response({
            'deleted_folder_id': folder.id,
            'affected_images': affected_images,
            'strategy': strategy
        })

class SegmentationResultViewSet(viewsets.ModelViewSet, PermissionMixin, ResponseFormatMixin):
    """
    分割结果视图集
    """
    queryset = SegmentationResult.objects.all()
    serializer_class = SegmentationResultSerializer
    permission_classes = [HasPermission]
    permission_codename = 'view_segmentation'
    allow_guest = True
    pagination_class = StandardResultsSetPagination

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def get_queryset(self):
        queryset = super().get_queryset()
        
        # If guest, filter by whitelist
        if not self.request.user.is_authenticated:
            from .models import GuestAccessibleResource
            # Get whitelisted image IDs
            whitelisted_ids = GuestAccessibleResource.objects.filter(
                resource_type='image', 
                is_active=True
            ).values_list('resource_id', flat=True)
            return queryset.filter(original_image_id__in=whitelisted_ids)

        if hasattr(self, 'filter_queryset_by_permission'):
            return self.filter_queryset_by_permission(queryset)
        return queryset

class PredictionResultViewSet(viewsets.ModelViewSet, PermissionMixin, ResponseFormatMixin):
    """
    预测结果视图集
    """
    queryset = PredictionResult.objects.select_related(
        'original_image__folder', 'segmentation__original_image', 'owner'
    ).prefetch_related(Prefetch(
        'corrections',
        queryset=PredictionCorrection.objects.select_related('owner').order_by('-version'),
        to_attr='_ordered_corrections',
    ))
    serializer_class = PredictionResultSerializer
    permission_classes = [HasPermission]
    permission_codename = 'view_prediction'
    allow_guest = True
    miniapp_actions = {'miniapp_run'}
    pagination_class = PredictionResultPagination
    perms_map = {
        'list': 'view_prediction',
        'retrieve': 'view_prediction',
        'miniapp_run': 'create_task',
        'editor': 'view_prediction',
        'corrections': 'view_prediction',
        'correction_detail': 'view_prediction',
    }

    def get_queryset(self):
        queryset = super().get_queryset()
        
        # If guest, filter by whitelist
        if not self.request.user.is_authenticated:
            from .models import GuestAccessibleResource
            from django.db.models import Q
            # Get whitelisted image IDs
            whitelist_qs = GuestAccessibleResource.objects.filter(
                resource_type='image', 
                is_active=True
            )
            whitelisted_ids = whitelist_qs.values_list('resource_id', flat=True)
            
            # Filter by original_image or segmentation__original_image
            return queryset.filter(
                Q(original_image_id__in=whitelisted_ids) | 
                Q(segmentation__original_image_id__in=whitelisted_ids)
            ).distinct()

        if hasattr(self, 'filter_queryset_by_permission'):
            return self.filter_queryset_by_permission(queryset)
        return queryset

    def _assert_can_edit_result(self, prediction):
        user = self.request.user
        if not user or not user.is_authenticated:
            return self.error_response('请登录后再保存人工校正结果', status_code=status.HTTP_403_FORBIDDEN)
        if user.is_superuser:
            return None
        owner_id = prediction.owner_id or getattr(prediction.original_image, 'owner_id', None)
        if owner_id != user.id:
            return self.error_response('无权编辑该预测结果', status_code=status.HTTP_403_FORBIDDEN)
        return None

    def _editor_payload(self, prediction):
        data = PredictionResultSerializer(prediction, context={'request': self.request}).data
        ordered = getattr(prediction, '_ordered_corrections', None)
        corrections = ordered if ordered is not None else list(prediction.corrections.order_by('-version'))
        latest = corrections[0] if corrections else None
        data['editor_available'] = bool(prediction.cassava_mask_key and prediction.rotten_mask_key)
        data['current_correction'] = PredictionCorrectionSerializer(
            latest, context={'request': self.request}
        ).data if latest else None
        data['corrections'] = PredictionCorrectionSerializer(
            corrections, many=True, context={'request': self.request}
        ).data
        return data

    @action(detail=True, methods=['get'], url_path='editor')
    def editor(self, request, pk=None):
        prediction = self.get_object()
        return self.success_response(self._editor_payload(prediction))

    @action(detail=True, methods=['get', 'post'], url_path='corrections')
    def corrections(self, request, pk=None):
        prediction = self.get_object()
        if request.method == 'GET':
            corrections = prediction.corrections.order_by('-version')
            return self.success_response(PredictionCorrectionSerializer(
                corrections, many=True, context={'request': request}
            ).data)

        denied = self._assert_can_edit_result(prediction)
        if denied:
            return denied
        cassava_file = request.FILES.get('cassava_mask')
        rotten_file = request.FILES.get('rotten_mask')
        if not cassava_file or not rotten_file:
            return self.error_response('请同时上传木薯掩码和腐烂掩码', status_code=status.HTTP_400_BAD_REQUEST)

        try:
            from .storage_utils import read_storage_bytes
            reference_key = prediction.cassava_mask_key
            if not reference_key:
                return self.error_response(
                    '该历史结果没有原始掩码，请重新预测后编辑',
                    status_code=status.HTTP_409_CONFLICT,
                )
            reference_image = Image.open(io.BytesIO(read_storage_bytes(reference_key)))
            expected_size = reference_image.size
            cassava, rotten, cassava_pixels, rotten_pixels, ppd_percent = calculate_mask_metrics(
                load_mask_file(cassava_file, expected_size),
                load_mask_file(rotten_file, expected_size),
            )
            if cassava_pixels == 0:
                return self.error_response(
                    '木薯范围不能为空，无法计算 PPD',
                    status_code=status.HTTP_400_BAD_REQUEST,
                )
        except (ValueError, OSError, FileNotFoundError) as exc:
            return self.error_response(str(exc), status_code=status.HTTP_400_BAD_REQUEST)

        from .storage_utils import delete_storage_keys, save_storage_bytes
        from .mask_utils import mask_to_png_bytes
        edit_data = request.data.get('edit_data', {})
        if isinstance(edit_data, str):
            import json
            if len(edit_data.encode('utf-8')) > 1024 * 1024:
                return self.error_response('编辑元数据不能超过 1MB', status_code=status.HTTP_400_BAD_REQUEST)
            try:
                edit_data = json.loads(edit_data)
            except json.JSONDecodeError:
                edit_data = {'raw': edit_data}
        stored_keys = []
        try:
            with transaction.atomic():
                locked_prediction = PredictionResult.objects.select_for_update().get(pk=prediction.pk)
                version = (
                    locked_prediction.corrections.order_by('-version')
                    .values_list('version', flat=True).first() or 0
                ) + 1
                base_key = f'prediction_corrections/{prediction.id}/v{version}'
                cassava_key = save_storage_bytes(
                    f'{base_key}/cassava.png', mask_to_png_bytes(cassava),
                    error_message='木薯掩码保存失败',
                )
                stored_keys.append(cassava_key)
                rotten_key = save_storage_bytes(
                    f'{base_key}/rotten.png', mask_to_png_bytes(rotten),
                    error_message='腐烂掩码保存失败',
                )
                stored_keys.append(rotten_key)
                correction = PredictionCorrection.objects.create(
                    prediction=locked_prediction,
                    version=version,
                    cassava_mask_key=cassava_key,
                    rotten_mask_key=rotten_key,
                    width=int(cassava.shape[1]),
                    height=int(cassava.shape[0]),
                    cassava_pixels=cassava_pixels,
                    rotten_pixels=rotten_pixels,
                    ppd_percent=ppd_percent,
                    edit_data=edit_data if isinstance(edit_data, dict) else {},
                    note=str(request.data.get('note', '') or '')[:2000],
                    owner=request.user,
                )
        except Exception:
            delete_storage_keys(stored_keys)
            logger.exception('prediction_correction_save_failed prediction_id=%s', prediction.id)
            return self.error_response('人工校正保存失败，请重试', status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return self.success_response(
            PredictionCorrectionSerializer(correction, context={'request': request}).data,
            message='人工校正版本已保存',
            status_code=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['get'], url_path=r'corrections/(?P<version>[^/.]+)')
    def correction_detail(self, request, pk=None, version=None):
        prediction = self.get_object()
        correction = get_object_or_404(prediction.corrections, version=version)
        return self.success_response(PredictionCorrectionSerializer(
            correction, context={'request': request}
        ).data)

    @action(detail=False, methods=['post'], url_path='miniapp-run')
    def miniapp_run(self, request):
        image_ids = request.data.get('image_ids')
        if not isinstance(image_ids, list) or len(image_ids) == 0:
            return self.error_response('请先提供 image_ids', status_code=status.HTTP_400_BAD_REQUEST)

        normalized_ids = []
        for image_id in image_ids:
            try:
                parsed_id = int(image_id)
            except (TypeError, ValueError):
                continue
            if parsed_id > 0:
                normalized_ids.append(parsed_id)

        if not normalized_ids:
            return self.error_response('没有有效的图片 ID', status_code=status.HTTP_400_BAD_REQUEST)

        image_qs = CassavaImage.objects.filter(id__in=normalized_ids)
        if request.user.is_authenticated and not request.user.is_superuser:
            image_qs = image_qs.filter(owner=request.user)
        elif not request.user.is_authenticated:
            from .models import GuestAccessibleResource
            whitelisted_ids = GuestAccessibleResource.objects.filter(
                resource_type='image',
                is_active=True,
                resource_id__in=normalized_ids,
            ).values_list('resource_id', flat=True)
            image_qs = image_qs.filter(id__in=whitelisted_ids)

        accessible_ids = set(image_qs.values_list('id', flat=True))
        if len(accessible_ids) != len(set(normalized_ids)):
            return self.error_response('存在无权限访问的图片', status_code=status.HTTP_403_FORBIDDEN)

        execution = PredictionService.run_predictions_for_images(
            image_ids=normalized_ids,
            params=request.data,
            owner=request.user if request.user.is_authenticated else None
        )

        serializer = self.get_serializer(execution.get('results', []), many=True)
        response_message = '预测完成'
        if execution.get('errors'):
            response_message = '预测完成，部分图片处理失败'

        return self.success_response(
            {
                'results': serializer.data,
                'errors': execution.get('errors', []),
                'processed_count': execution.get('processed_count', 0),
                'requested_count': execution.get('requested_count', len(normalized_ids)),
            },
            message=response_message
        )

class ProcessingTaskViewSet(viewsets.ModelViewSet, PermissionMixin, ResponseFormatMixin):
    """
    处理任务视图集
    """
    queryset = ProcessingTask.objects.all()
    serializer_class = ProcessingTaskSerializer
    permission_classes = [HasPermission]  # 移除 IsAuthenticated，允许访客通过 HasPermission 控制
    permission_codename = 'view_task'
    allow_guest = True  # 允许访客访问（具体限制在 HasPermission 中实现）
    perms_map = {
        'list': 'view_task',
        'retrieve': 'view_task',
        'create': 'create_task',
        'update': 'create_task',
        'partial_update': 'create_task',
        'destroy': 'delete_task',
        'cancel': 'cancel_task',
    }

    def get_queryset(self):
        # 访客只能看到自己的任务 (根据 Cookie 中的 guest_token 过滤)
        queryset = super().get_queryset()
        
        if not self.request.user.is_authenticated:
            # 获取 guest_token
            guest_token = self.request.COOKIES.get('guest_token')
            if not guest_token:
                # 如果没有 token，尝试从 header 获取 (兼容性)
                guest_token = self.request.headers.get('X-Guest-Token')
                
            if guest_token:
                return queryset.filter(guest_token=guest_token)
            else:
                return queryset.none()
            
        if hasattr(self, 'filter_queryset_by_permission'):
            return self.filter_queryset_by_permission(queryset)
        return queryset

    def create(self, request, *args, **kwargs):
        # 如果是访客创建预测任务，增加使用计数并设置Cookie
        response = None
        guest_token = None
        is_new_token = False
        
        if not request.user.is_authenticated:
            if request.data.get('type') == 'prediction':
                from .permissions import get_guest_token
                
                # 获取或生成访客标识
                guest_token = get_guest_token(request)
                is_new_token = guest_token != request.COOKIES.get('guest_token')
                
                today = timezone.now().date()
                try:
                    # 兼容旧数据：如果guest_token不存在，可能需要处理（但新生成的是基于hash的，不会冲突）
                    # 这里只关注guest_token
                    guest_usage, _ = GuestUsage.objects.get_or_create(
                        guest_token=guest_token,
                        date=today
                    )
                except IntegrityError:
                    # 并发处理
                    guest_usage = GuestUsage.objects.filter(guest_token=guest_token, date=today).first()
                    if not guest_usage:
                        # Should not happen if IntegrityError occurred on unique constraint
                        # But as a fallback, return 403 or log error
                        return Response({'error': 'System busy, please try again'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
                
                # 检查限额
                if guest_usage.count >= 10:
                    return Response({'error': '今日预测次数已达上限(10次)'}, status=status.HTTP_403_FORBIDDEN)
                    
                # 增加计数
                guest_usage.count += 1
                guest_usage.save()
        
        # 调用父类创建方法
        # 注意：我们需要拦截 perform_create 来设置 guest_token
        # 但 perform_create 不返回 response，所以我们在这里处理 response
        
        # 临时保存 guest_token 到 request 对象，以便 perform_create 使用
        if guest_token:
            request._guest_token = guest_token
            
        response = super().create(request, *args, **kwargs)
            
        # 如果是新生成的Token，设置Cookie (有效期1年)
        if is_new_token and guest_token:
            response.set_cookie(
                'guest_token', 
                guest_token, 
                max_age=365*24*60*60, 
                httponly=False, # 允许前端读取
                samesite='Lax'
            )
        
        return response

    def perform_create(self, serializer):
        """
        创建任务并启动后台处理
        """
        # 保存任务，如果有用户则关联
        save_kwargs = {}
        if self.request.user.is_authenticated:
            save_kwargs['owner'] = self.request.user
        elif hasattr(self.request, '_guest_token'):
            save_kwargs['guest_token'] = self.request._guest_token
            
        task = serializer.save(status='pending', **save_kwargs)
            
        # Prediction jobs are submitted to a bounded runner after commit. The
        # complete request parameters are persisted on the task itself.
        if task.type == 'prediction':
            from .task_runner import submit_prediction_task
            transaction.on_commit(lambda: submit_prediction_task(task.id))

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        task = self.get_object()
        if task.status in {'pending', 'running'}:
            task.status = 'cancelled'
            task.save()
        return self.success_response({'message': 'Task cancelled'})

class ShareViewSet(viewsets.ModelViewSet, PermissionMixin, ResponseFormatMixin):
    """
    资源共享视图集
    """
    queryset = ResourceShare.objects.all()
    serializer_class = ResourceShareSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'])
    def my_shares(self, request):
        shares = ShareService.get_my_shares(request.user)
        serializer = self.get_serializer(shares, many=True)
        return self.success_response(serializer.data)

    @action(detail=False, methods=['get'])
    def shared_with_me(self, request):
        shares = ShareService.get_shared_with_me(request.user)
        serializer = self.get_serializer(shares, many=True)
        return self.success_response(serializer.data)

    @action(detail=False, methods=['post'])
    def share(self, request):
        resource_type = request.data.get('resource_type')
        resource_id = request.data.get('resource_id')
        shared_with_username = request.data.get('shared_with_username')
        permission = request.data.get('permission') or 'view'
        expires_at_raw = request.data.get('expires_at')

        expires_at = None
        if expires_at_raw:
            expires_at = parse_datetime(expires_at_raw)
            if expires_at and timezone.is_naive(expires_at):
                expires_at = timezone.make_aware(expires_at, timezone.get_current_timezone())

        share_obj, err = ShareService.share_resource(
            owner=request.user,
            resource_type=resource_type,
            resource_id=resource_id,
            shared_with_username=shared_with_username,
            permission=permission,
            expires_at=expires_at
        )

        if err:
            return self.error_response(err, status_code=status.HTTP_400_BAD_REQUEST)

        serializer = self.get_serializer(share_obj)
        return self.success_response(serializer.data, status_code=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def revoke(self, request):
        share_id = request.data.get('share_id')
        ok, err = ShareService.revoke_share(request.user, share_id)
        if not ok:
            return self.error_response(err or "操作失败", status_code=status.HTTP_400_BAD_REQUEST)
        return self.success_response({'revoked': True})

class OssObjectView(APIView):
    def post(self, request):
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile
        import uuid
        from .oss_service import check_oss_configured, upload_file_to_oss, get_file_url

        file = request.FILES.get('file')
        if not file:
            return Response({'error': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)

        key = request.data.get('key')
        prefix = request.data.get('prefix') or ''

        if not key:
            ext = os.path.splitext(file.name)[1]
            prefix = prefix.strip().strip('/')
            key = f"{prefix}/{uuid.uuid4()}{ext}" if prefix else f"{uuid.uuid4()}{ext}"

        data = file.read()
        if check_oss_configured():
            result = upload_file_to_oss(key, data)
            if result.get('status_code') != 200:
                return Response({'error': result.get('error') or 'OSS upload failed'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            return Response({'status': 'ok', 'key': key, 'url': get_file_url(key)})

        saved_path = default_storage.save(key, ContentFile(data))
        return Response({'status': 'ok', 'key': saved_path, 'url': get_file_url(saved_path)})
        
    def get(self, request):
        from django.http import FileResponse, HttpResponse
        from django.core.files.storage import default_storage
        from .oss_service import check_oss_configured, list_files_in_oss, get_file_from_oss

        key = request.query_params.get('key')
        if key:
            if check_oss_configured():
                data = get_file_from_oss(key)
                if data is None:
                    return Response({'error': 'File not found'}, status=status.HTTP_404_NOT_FOUND)
                return HttpResponse(data, content_type='application/octet-stream')

            if not default_storage.exists(key):
                return Response({'error': 'File not found'}, status=status.HTTP_404_NOT_FOUND)
            fh = default_storage.open(key, 'rb')
            return FileResponse(fh)

        prefix = request.query_params.get('prefix') or ''
        files = list_files_in_oss(prefix) if check_oss_configured() else []
        return Response({'status': 'ok', 'files': files})
        
    def delete(self, request):
        from django.core.files.storage import default_storage
        from .oss_service import check_oss_configured, delete_file_from_oss

        key = request.query_params.get('key') or request.data.get('key')
        if not key:
            return Response({'error': 'No key provided'}, status=status.HTTP_400_BAD_REQUEST)
            
        if check_oss_configured():
            result = delete_file_from_oss(key)
            if result.get('status_code') and result.get('status_code') >= 400:
                return Response(result, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            return Response({'status': 'ok', 'result': result})

        try:
            default_storage.delete(key)
            return Response({'status': 'ok', 'result': {'status_code': 200}})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class SystemSettingView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        settings_obj = SystemSetting.get_solo()
        data = SystemSettingSerializer(settings_obj).data
        return Response(data)

    def patch(self, request):
        if not request.user.is_superuser:
            return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        settings_obj = SystemSetting.get_solo()
        
        # Capture old values for audit log
        old_values = SystemSettingSerializer(settings_obj).data
        
        serializer = SystemSettingSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        
        # Create audit log
        try:
            from .models import AuditLog
            new_values = serializer.data
            changes = {}
            for key, val in new_values.items():
                if key in old_values and old_values[key] != val:
                    changes[key] = {'old': old_values[key], 'new': val}
            
            if changes:
                AuditLog.objects.create(
                    user=request.user,
                    action='UPDATE',
                    resource='SystemSetting',
                    resource_id='1',
                    details={'changes': changes},
                    ip_address=request.META.get('REMOTE_ADDR'),
                    success=True
                )
        except Exception as e:
            # Don't fail the request if logging fails
            logger.warning("Failed to create audit log: %s", e)
            
        return Response(serializer.data)

@api_view(['GET'])
@permission_classes([AllowAny])
def public_settings(request):
    """
    Publicly accessible settings (Site title, announcement, etc.)
    """
    settings_obj = SystemSetting.get_solo()
    return Response({
        'site_title': settings_obj.site_title,
        'site_announcement': settings_obj.site_announcement,
        'announcement_level': settings_obj.announcement_level,
        'enable_guest_access': settings_obj.enable_guest_access,
        'allow_registration': settings_obj.allow_registration,
        'maintenance_mode': settings_obj.maintenance_mode
    })
