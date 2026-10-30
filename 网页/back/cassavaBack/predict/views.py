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
from django.db.models import Prefetch, Q
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
from .services import ShareService, PredictionService, ImageService, AuditService
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
from .image_quality import image_dimensions, resolution_info

from .recycling import RecyclingActions, recycle

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

class CassavaImageViewSet(RecyclingActions, viewsets.ModelViewSet, PermissionMixin, TaskProcessingMixin, FileUploadMixin, ResponseFormatMixin):
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
        'capture_metadata': 'edit_image',
    }

    def get_queryset(self):
        queryset = (self.queryset.model.all_objects.filter(deleted_at__isnull=False) if self.request.user.is_authenticated and (self.request.query_params.get('trash') == '1' or self.action in ('restore', 'purge', 'deletion_impact')) else super().get_queryset())
        
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

        search = (self.request.query_params.get('search') or '').strip()
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(description__icontains=search)
                | Q(folder__name__icontains=search)
            )

        ordering = (self.request.query_params.get('ordering') or '').strip()
        allowed_ordering = {
            'created_at', '-created_at', 'updated_at', '-updated_at',
            'name', '-name', 'size', '-size', 'capture_time', '-capture_time',
        }
        if ordering:
            if ordering in allowed_ordering:
                queryset = queryset.order_by(ordering)
        else:
            queryset = queryset.order_by('-created_at')

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return CassavaImageListSerializer
        return CassavaImageSerializer

    @action(detail=False, methods=['get'])
    def selection(self, request):
        queryset = self.get_queryset()
        if queryset.count() > 20000:
            return self.error_response('一次最多选择20000张，请缩小目录或搜索范围', status_code=400)
        ids = list(queryset.values_list('pk', flat=True))
        return Response({'image_ids': ids, 'count': len(ids)})

    @action(detail=False, methods=['post'], url_path='capture-metadata')
    def capture_metadata(self, request):
        ids = request.data.get('image_ids', [])
        if not isinstance(ids, list) or not 1 <= len(ids) <= 1000:
            return self.error_response('每次请选择1到1000张图片', status_code=400)
        queryset = self.get_queryset().filter(pk__in=ids)
        if not request.user.is_superuser:
            queryset = queryset.filter(owner=request.user)
        updated = []
        with transaction.atomic():
            from .resource_lock import lock_owner
            lock_owner(request.user)
            for image in queryset.select_for_update():
                serializer = CassavaImageSerializer(image, data={'capture_time': request.data.get('capture_time')},
                    partial=True, context=self.get_serializer_context())
                serializer.is_valid(raise_exception=True); serializer.save(); updated.append(image.pk)
        return Response({'updated': len(updated), 'failed_ids': [pk for pk in ids if str(pk) not in {str(value) for value in updated}]})

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
        image_id = instance.id
        image_name = instance.name
        recycle(instance, self.request.user)
        AuditService.log_action(
            self.request.user, 'DELETE', 'CassavaImage', image_id,
            {'name': image_name}, success=True, request=self.request,
        )

    @action(detail=False, methods=['post'], url_path='upload-files')
    def upload_files(self, request):
        if not request.user.is_authenticated:
            return self.error_response('请先登录', status_code=401)
        files = request.FILES.getlist('files')
        if not files:
            return self.error_response('未提供文件', status_code=400)
        uploaded, skipped, failed = [], [], []
        for file in files:
            image, error = ImageService.upload_image(file, request.data.get('folder_id') or None,
                check_duplicate=request.data.get('check_duplicate', '1') != '0', user=request.user)
            if error:
                (skipped if error[0] == 'DUPLICATE_CONTENT' else failed).append({'name': file.name, 'code': error[0], 'error': error[1]})
            else:
                uploaded.append(image)
        serialized = CassavaImageSerializer(uploaded, many=True, context=self.get_serializer_context()).data
        if not skipped and not failed:
            return Response(serialized, status=201)
        return Response({'images': serialized, 'success_count': len(uploaded), 'duplicates': skipped, 'failed': failed}, status=207 if failed else 201)

    @action(detail=False, methods=['post'], url_path='upload-batch')
    def upload_batch(self, request):
        """
        批量上传（处理 ZIP 包等）
        """
        import zipfile
        from .services import ImageService
        
        file = request.FILES.get('file')
        if not file:
            return Response({'error': '没有收到文件，请重新选择'}, status=status.HTTP_400_BAD_REQUEST)
            
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
             return Response({'error': '压缩包不是有效的 ZIP 文件'}, status=status.HTTP_400_BAD_REQUEST)
             
        count = 0
        errors = []
        duplicates = []
        resolution_warnings = []
        
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
                            info = resolution_info(image.pixel_width, image.pixel_height)
                            if info["low_resolution"]:
                                resolution_warnings.append({"name": image.name, **info})
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
                'resolution_warnings': resolution_warnings,
                'errors': errors[:10] # 限制返回的错误数量
            })
            
        except Exception as e:
            return Response({'error': 'ZIP 解压处理失败，请检查压缩包内容后重试'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class FolderViewSet(RecyclingActions, viewsets.ModelViewSet, PermissionMixin, ResponseFormatMixin):
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

    def perform_destroy(self, instance):
        recycle(instance, self.request.user)

    def perform_create(self, serializer):
        parent_id = self.request.data.get('parent')
        if parent_id and self.request.user.is_authenticated and (not self.request.user.is_superuser):
            parent = get_object_or_404(Folder, id=parent_id)
            if parent.owner_id != self.request.user.id:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied()
        serializer.save(owner=self.request.user)

    def get_queryset(self):
        queryset = (self.queryset.model.all_objects.filter(deleted_at__isnull=False) if self.request.user.is_authenticated and (self.request.query_params.get('trash') == '1' or self.action in ('restore', 'purge', 'deletion_impact')) else super().get_queryset())
        
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
        from .recycling import unique_name
        moved = []
        with transaction.atomic():
            from .resource_lock import lock_owner
            lock_owner(request.user)
            Folder.objects.select_for_update().get(pk=folder.pk)
            for image in queryset.select_for_update():
                image.name = unique_name(CassavaImage.objects.filter(owner=image.owner, folder=folder), image.name, image.pk)
                image.folder = folder; image.save(update_fields=['name', 'folder'])
                moved.append(image.pk)
        return self.success_response({'updated': len(moved), 'failed_ids': [value for value in image_ids if str(value) not in {str(pk) for pk in moved}]})

    @action(detail=True, methods=['post'], url_path='delete_with_strategy')
    def delete_with_strategy(self, request, pk=None):
        folder = self.get_object()
        if request.user.is_authenticated and (not request.user.is_superuser) and folder.owner_id != request.user.id:
            if not ShareService.check_permission(request.user, 'folder', folder, 'manage'):
                return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        recycle(folder, request.user)
        return self.success_response({'recycled_folder_id': folder.pk, 'strategy': 'recycle'})

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
        'original_image__folder', 'segmentation__original_image', 'owner', 'processing_task'
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
        'export': 'view_prediction',
        'overlay': 'view_prediction',
    }

    def get_queryset(self):
        queryset = super().get_queryset()

        # 支持按任务过滤（列表与导出共用；此前只有 export action 认 task_id，
        # 导致 /api/predictions/?task_id=N 返回全库 count，结果中心只能靠前端再过滤）
        task_id = self.request.query_params.get('task_id')
        if task_id:
            if task_id.isdigit():
                queryset = queryset.filter(processing_task_id=int(task_id))
            else:
                queryset = queryset.none()

        from .result_queries import result_scope
        queryset = result_scope(queryset, self.request.query_params)

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

    @action(detail=False, methods=['get'], url_path='export')
    def export(self, request):
        from django.db.models import Q
        from .measurement import measurement_info
        from .result_export import export_response
        file_type = request.query_params.get('file_type', 'csv')
        if file_type not in {'csv', 'xlsx', 'zip'}:
            return self.error_response('不支持的导出格式', status_code=400)
        queryset = self.filter_queryset(self.get_queryset())
        task_id = request.query_params.get('task_id')
        if task_id:
            if not task_id.isdigit():
                return self.error_response('任务编号无效', status_code=400)
            queryset = queryset.filter(processing_task_id=int(task_id))
        query = request.query_params.get('search', '').strip()
        if query:
            queryset = queryset.filter(Q(original_image__name__icontains=query) | Q(original_image__folder__name__icontains=query))
        try:
            import json
            ids = request.query_params.get('result_ids')
            if ids:
                try: queryset = queryset.filter(pk__in=[int(value) for value in ids.split(',')])
                except ValueError: return self.error_response('无效结果编号', status_code=400)
            return export_response(queryset, file_type, style=json.loads(request.query_params.get('style', '{}')),
                version=request.query_params.get('version', 'latest'))
        except ValueError as exc:
            return self.error_response(str(exc), status_code=400)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        from django.db.models import Avg, Min, Max, Count, Q
        return Response(self.get_queryset().aggregate(total=Count('pk'), avg=Avg('_final_ppd'),
            min=Min('_final_ppd'), max=Max('_final_ppd'), healthy=Count('pk', filter=Q(_final_ppd__lt=4)),
            mild=Count('pk', filter=Q(_final_ppd__gte=4, _final_ppd__lt=7)), severe=Count('pk', filter=Q(_final_ppd__gte=7)),
            needs_review=Count('pk', filter=Q(_final_ppd__isnull=True))))

    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        from .measurement import latest_correction, measurement_info
        prediction = self.get_object()
        if not request.user.is_authenticated or (not request.user.is_superuser and prediction.owner_id != request.user.pk):
            return self.error_response('仅所有者可完成复检', status_code=403)
        with transaction.atomic():
            from .resource_lock import lock_owner
            lock_owner(request.user)
            prediction = PredictionResult.objects.select_for_update().get(pk=prediction.pk)
            correction = latest_correction(prediction)
            version = correction.version if correction else 0
            if request.data.get('version') != version:
                return self.error_response('结果版本已改变，请重新载入后复检', status_code=409)
            prediction.reviewed_version = version
            prediction.reviewed_at = timezone.now()
            prediction.reviewed_by = request.user
            prediction.save(update_fields=['reviewed_version', 'reviewed_at', 'reviewed_by'])
            AuditService.log_action(request.user, 'UPDATE', 'PredictionResult', prediction.pk,
                {'reviewed_version': version, 'reviewed_at': prediction.reviewed_at.isoformat()}, success=True, request=request)
        return self.success_response(measurement_info(prediction))

    @action(detail=True, methods=['get'])
    def figure(self, request, pk=None):
        from django.http import HttpResponse
        from .contour_export import figure_png
        from .measurement import selected_correction
        import json
        prediction = self.get_object()
        try:
            correction = selected_correction(prediction, request.query_params.get('version', 'latest'))
            return HttpResponse(figure_png(prediction, correction, json.loads(request.query_params.get('style', '{}'))), content_type='image/png')
        except (ValueError, OSError, TypeError) as exc:
            return self.error_response(str(exc), status_code=400)

    @action(detail=True, methods=['get'], url_path='overlay')
    def overlay(self, request, pk=None):
        from django.http import HttpResponse
        from .measurement import latest_correction, overlay_png
        prediction = self.get_object()
        version = request.query_params.get('version', 'latest')
        correction = latest_correction(prediction)
        if version == '0':
            correction = None
        elif version != 'latest':
            if not version.isdigit():
                return self.error_response('版本号无效', status_code=400)
            correction = get_object_or_404(prediction.corrections, version=int(version))
        try:
            response = HttpResponse(overlay_png(prediction, correction), content_type='image/png')
            response['Cache-Control'] = 'private, no-store'
            return response
        except (OSError, ValueError) as exc:
            return self.error_response(str(exc), status_code=409)

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
        from .measurement import segment_measurements
        edit_data = request.data.get('edit_data', {})
        if isinstance(edit_data, str):
            import json
            if len(edit_data.encode('utf-8')) > 1024 * 1024:
                return self.error_response('编辑元数据不能超过 1MB', status_code=status.HTTP_400_BAD_REQUEST)
            try:
                edit_data = json.loads(edit_data)
            except json.JSONDecodeError:
                edit_data = {'raw': edit_data}
        edit_data = edit_data if isinstance(edit_data, dict) else {}
        rotation = edit_data.get('rotation_degrees', 0)
        if type(rotation) is not int or rotation not in (0, 90, 180, 270):
            return self.error_response('旋转角度仅支持0、90、180、270度', status_code=400)
        edit_data['rotation_degrees'] = rotation
        edit_data['segments'] = segment_measurements(prediction, cassava, rotten)
        stored_keys = []
        try:
            with transaction.atomic():
                locked_prediction = PredictionResult.objects.select_for_update().get(pk=prediction.pk)
                version = (
                    locked_prediction.corrections.order_by('-version')
                    .values_list('version', flat=True).first() or 0
                ) + 1
                expected_version = request.data.get('base_version')
                if expected_version is not None and str(expected_version) != str(version - 1):
                    return self.error_response('结果已有新校正版本，请重新打开核对后再保存', status_code=409)
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

class ProcessingTaskViewSet(RecyclingActions, viewsets.ModelViewSet, PermissionMixin, ResponseFormatMixin):
    """
    处理任务视图集
    """
    queryset = ProcessingTask.objects.all()
    serializer_class = ProcessingTaskSerializer
    permission_classes = [HasPermission]  # 移除 IsAuthenticated，允许访客通过 HasPermission 控制
    permission_codename = 'view_task'
    pagination_class = StandardResultsSetPagination
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

    def perform_destroy(self, instance):
        recycle(instance, self.request.user)

    def get_queryset(self):
        # 访客只能看到自己的任务 (根据 Cookie 中的 guest_token 过滤)
        queryset = (self.queryset.model.all_objects.filter(deleted_at__isnull=False) if self.request.user.is_authenticated and (self.request.query_params.get('trash') == '1' or self.action in ('restore', 'purge', 'deletion_impact')) else super().get_queryset())
        if self.action == 'retrieve' and self.request.user.is_authenticated:
            queryset = self.queryset.model.all_objects.all()

        # 预先标注结果条数，避免列表页对每个任务再发一次 count 查询
        from django.db.models import Count
        queryset = queryset.annotate(_result_count=Count('prediction_results', distinct=True)).order_by('-created_time', '-pk')
        if self.action in ('list', 'summary'):
            search = self.request.query_params.get('search', '').strip()
            state = self.request.query_params.get('status', '')
            if search:
                queryset = queryset.filter(name__icontains=search)
            if state:
                queryset = queryset.filter(status=state)

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

    @action(detail=False, methods=['get'])
    def summary(self, request):
        from django.db.models import Count
        counts = dict(self.get_queryset().order_by().values('status').annotate(n=Count('pk')).values_list('status', 'n'))
        return Response({'total': sum(counts.values()), **{key: counts.get(key, 0) for key in ('completed', 'running', 'failed', 'pending', 'cancelled')}})

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
                        return Response({'error': '系统繁忙，请稍后重试'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
                
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
        AuditService.log_action(
            self.request.user, 'CREATE', 'ProcessingTask', task.id,
            {'name': task.name, 'type': task.type, 'algorithm': getattr(task, 'algorithm', '')},
            success=True, request=self.request,
        )
            
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

def _oss_key_owned_by(user, key):
    """判断 key 是否属于该用户名下的某条业务记录。

    2026-10-27 加固：`/api/oss/` 原先只依赖全局 IsAuthenticated，
    任何登录用户都能读取、列目录、删除**任意**对象（含他人图片与掩码）。
    这里把「有没有登录」升级为「是不是你的对象」。
    未知归属的对象（历史上直接上传、无业务记录引用的 key）仅管理员可达。
    """
    from django.db.models import Q
    from .models import CassavaImage, SegmentationResult, PredictionResult

    if not key:
        return False
    if getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False):
        return True
    if CassavaImage.objects.filter(owner=user).filter(
        Q(oss_key=key) | Q(preview_oss_key=key)
    ).exists():
        return True
    if SegmentationResult.objects.filter(owner=user, oss_key=key).exists():
        return True
    if PredictionResult.objects.filter(owner=user).filter(
        Q(oss_key=key)
        | Q(cassava_mask_key=key)
        | Q(rotten_mask_key=key)
        | Q(confidence_map_key=key)
    ).exists():
        return True
    return False


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

        if key and not _oss_key_owned_by(request.user, key):
            # 禁止用指定 key 覆盖他人对象
            exists = default_storage.exists(key)
            if check_oss_configured():
                from .oss_service import get_file_from_oss
                exists = get_file_from_oss(key) is not None
            if exists:
                return Response({'error': '无权覆盖该对象'}, status=status.HTTP_403_FORBIDDEN)

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
            if not _oss_key_owned_by(request.user, key):
                return Response({'error': '无权访问该对象'}, status=status.HTTP_403_FORBIDDEN)
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
        if not (request.user.is_staff or request.user.is_superuser):
            return Response(
                {'error': '仅管理员可枚举存储目录'},
                status=status.HTTP_403_FORBIDDEN,
            )
        files = list_files_in_oss(prefix) if check_oss_configured() else []
        return Response({'status': 'ok', 'files': files})
        
    def delete(self, request):
        from django.core.files.storage import default_storage
        from .oss_service import check_oss_configured, delete_file_from_oss

        key = request.query_params.get('key') or request.data.get('key')
        if not key:
            return Response({'error': 'No key provided'}, status=status.HTTP_400_BAD_REQUEST)

        if not _oss_key_owned_by(request.user, key):
            return Response({'error': '无权删除该对象'}, status=status.HTTP_403_FORBIDDEN)


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
