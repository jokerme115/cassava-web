# API 契约版本：1.0.0
# 统一返回结构（upload_files / upload_batch）：
#   status: 'ok' | 'partial' | 'error'
#   success_count: int
#   uploaded_images: Image[]
#   duplicates: string[]
#   failed_files: string[]
# 约定：所有图片 ID 统一使用字符串类型（兼容 char(32) 遗留 ID）

from rest_framework import viewsets, status
from rest_framework.decorators import api_view, action, permission_classes
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView
from rest_framework.pagination import PageNumberPagination
from django.shortcuts import get_object_or_404
from django.db import IntegrityError
from django.db import transaction
from .serializers import (
    CassavaImageListSerializer, CassavaImageSerializer, SegmentationResultSerializer,
    PredictionResultSerializer, ProcessingTaskSerializer,
    FolderSerializer, SystemSettingSerializer
)
from .models import (
    CassavaImage, SegmentationResult, PredictionResult,
    ProcessingTask, Folder, ResourceShare, SystemSetting
)
from .view_mixins import PermissionMixin, TaskProcessingMixin, ResponseFormatMixin, FileUploadMixin
from .services import ShareService, PredictionService, ImageService
from .desktop_user import get_request_user_or_desktop
from .storage_utils import build_preview_storage_key, delete_cassava_image_files
from django.utils import timezone
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
import logging
import os
import uuid
import io
from PIL import Image
from concurrent.futures import ThreadPoolExecutor, as_completed
from django.db import close_old_connections

logger = logging.getLogger(__name__)


def _new_trace_id():
    """生成请求链路 trace id，用于日志追踪"""
    return uuid.uuid4().hex[:12]


def desktop_user(request):
    return get_request_user_or_desktop(request)

class StandardResultsSetPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 1000

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
            return setting.max_display_images
        except Exception:
            pass

        return self.page_size

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
    permission_classes = [AllowAny]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        queryset = super().get_queryset()
        if hasattr(self, 'filter_queryset_by_permission'):
            queryset = self.filter_queryset_by_permission(queryset)

        folder_filter = (self.request.query_params.get('folder') or '').strip()
        if folder_filter == 'uncategorized':
            queryset = queryset.filter(folder__isnull=True)
        elif folder_filter:
            # 宽容策略：支持数字型 folder_id，也支持 legacy char(32) 字符串 ID
            try:
                parsed = int(folder_filter)
                if parsed > 0:
                    queryset = queryset.filter(folder_id=parsed)
            except (TypeError, ValueError):
                # 非数字 ID，按字符串处理（Django ORM 会做类型适配）
                queryset = queryset.filter(folder_id=folder_filter)

        return queryset

    def get_serializer_class(self):
        if self.action == 'list':
            return CassavaImageListSerializer
        return CassavaImageSerializer

    def update(self, request, *args, **kwargs):
        # 桌面单用户模式：移除权限检查
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        # 桌面单用户模式：移除权限检查
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        # 桌面单用户模式：移除权限检查
        return super().destroy(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(owner=desktop_user(self.request))

    def perform_destroy(self, instance):
        # 桌面模式删除逻辑：区分 managed 和 external
        if getattr(instance, 'storage_mode', 'managed') == 'external':
            # 外部引用模式：只删除数据库记录，不触碰原文件
            instance.delete()
        else:
            # 已复制模式：先清理文件，再删数据库记录
            from .storage_utils import delete_cassava_image_files
            deleted = delete_cassava_image_files(instance)
            logger.info(f"Deleted storage files for CassavaImage {instance.pk}: {deleted}")
            instance.delete()

    @action(detail=False, methods=['post'], url_path='batch-delete')
    def batch_delete(self, request):
        """
        批量删除图片
        """
        image_ids = request.data.get('image_ids', [])
        if not image_ids:
            return self.error_response('No image IDs provided')

        # 请求大小限制：最多100条/次，防止意外或恶意大量删除
        MAX_BATCH_DELETE = 100
        if len(image_ids) > MAX_BATCH_DELETE:
            return self.error_response(f'单次批量删除最多 {MAX_BATCH_DELETE} 条记录')

        images = CassavaImage.objects.filter(id__in=image_ids)
        deleted_count = 0

        for image in images:
            if getattr(image, 'storage_mode', 'managed') == 'external':
                image.delete()
            else:
                from .storage_utils import delete_cassava_image_files
                delete_cassava_image_files(image)
                image.delete()
            deleted_count += 1

        return self.success_response({'deleted': deleted_count})

    @action(detail=False, methods=['post'], url_path='upload-files')
    def upload_files(self, request):
        """
        批量上传图片文件
        """
        trace_id = _new_trace_id()
        files = request.FILES.getlist('files')
        use_legacy_char_pk = CassavaImage._uses_legacy_char_pk(CassavaImage._meta.db_table)
        logger.info(f"[{trace_id}] 上传请求开始: {len(files)} 个文件")

        # Check file size limit
        try:
            setting = SystemSetting.get_solo()
            limit_mb = setting.upload_size_limit_mb
            limit_bytes = limit_mb * 1024 * 1024

            for file in files:
                if file.size > limit_bytes:
                    return Response({'error': f'File {file.name} exceeds size limit of {limit_mb}MB'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            pass

        folder_id = request.data.get('folder_id')
        check_duplicate = request.data.get('check_duplicate') == '1'
        force_overwrite = request.data.get('force_overwrite') == '1'

        folder = None
        if folder_id:
            try:
                folder = Folder.objects.get(id=folder_id)
            except Folder.DoesNotExist:
                return Response({'error': 'Folder not found'}, status=status.HTTP_404_NOT_FOUND)

        uploaded_images = []
        duplicate_files = []
        failed_files = []

        # 提取需要处理的文件（排除重复）
        files_to_process = []
        for file in files:
            file_content = None
            normalized_upload = None
            # 检查重复（桌面单用户模式：移除 owner 过滤）
            if check_duplicate:
                # 使用事务避免竞态条件：检查-删除-创建 在事务内完成
                with transaction.atomic():
                    exists_qs = CassavaImage.objects.filter(name=file.name)
                    exists = exists_qs.exists()
                    if exists:
                        if force_overwrite:
                            # 真覆盖：删除所有同名旧记录（保留文件由 FileSystemStorage 处理）
                            deleted_count = exists_qs.delete()[0]
                            logger.info(f"[{trace_id}] Overwrote {deleted_count} existing record(s) for: {file.name}")
                        else:
                            duplicate_files.append(file.name)
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
                failed_files.append(file.name)
                continue

            # 严格验证图片内容
            try:
                file.seek(0)
                img_verify = Image.open(file)
                img_verify.verify()
                file.seek(0)
                if img_verify.format not in ['JPEG', 'PNG', 'BMP', 'WEBP', 'TIFF']:
                    failed_files.append(file.name)
                    continue
            except Exception as e:
                failed_files.append(file.name)
                continue

            files_to_process.append(file)

        # 并发处理文件预览生成（CPU密集型，与IO可重叠）
        def process_single_file(file):
            """处理单个文件，返回 (file, preview_oss_key) 或 (file, None)"""
            close_old_connections()
            try:
                file.seek(0)
                file_content = file.read()
                original_name = file.name
                _, ext = os.path.splitext(original_name)
                safe_ext = (ext or '').lower()

                if folder:
                    file_path = f"images/{folder.id}/{uuid.uuid4().hex}{safe_ext}"
                else:
                    file_path = f"images/{uuid.uuid4().hex}{safe_ext}"

                saved_path = default_storage.save(file_path, ContentFile(file_content))

                preview_oss_key = None
                try:
                    img = Image.open(io.BytesIO(file_content))
                    if img.mode in ('RGBA', 'P'):
                        img = img.convert('RGB')
                    max_size = (600, 600)
                    img.thumbnail(max_size)
                    thumb_io = io.BytesIO()
                    img.save(thumb_io, format='JPEG', quality=60)
                    thumb_content = thumb_io.getvalue()
                    preview_path = build_preview_storage_key(folder=folder)
                    preview_oss_key = default_storage.save(preview_path, ContentFile(thumb_content))
                except Exception as e:
                    logger.warning(f"[{trace_id}] Error generating preview for {file.name}: {e}")

                return (file, original_name, file.size, saved_path, preview_oss_key)
            except Exception as e:
                logger.exception("[%s] Error processing file %s: %s", trace_id, file.name, e)
                return None

        # 使用线程池并发处理预览生成（最多8个线程）
        preview_results = {}
        with ThreadPoolExecutor(max_workers=min(8, len(files_to_process))) as executor:
            future_to_file = {executor.submit(process_single_file, f): f for f in files_to_process}
            for future in as_completed(future_to_file):
                result = future.result()
                if result:
                    file, original_name, file_size, saved_path, preview_oss_key = result
                    preview_results[file.name] = (original_name, file_size, saved_path, preview_oss_key)

        # 串行创建数据库记录（保证一致性）
        for file in files_to_process:
            if file.name not in preview_results:
                continue
            original_name, file_size, saved_path, preview_oss_key = preview_results[file.name]
            try:
                create_kwargs = {
                    'name': original_name,
                    'image': saved_path,
                    'preview_oss_key': preview_oss_key,
                    'folder': folder,
                    'size': file_size,
                    'owner': desktop_user(request),
                }
                if use_legacy_char_pk:
                    create_kwargs['id'] = CassavaImage._generate_legacy_pk()
                image = CassavaImage.objects.create(**create_kwargs)
                uploaded_images.append(image)
            except Exception as e:
                logger.exception("[%s] Error creating record for %s: %s", trace_id, file.name, e)
                failed_files.append(file.name)

        # 统一返回结构：始终返回 {status, success_count, uploaded_images, duplicates, failed_files}
        # 不再区分状态码返回不同结构，前端统一处理
        logger.info(f"[{trace_id}] 上传完成: 成功={len(uploaded_images)}, 重复={len(duplicate_files)}, 失败={len(failed_files)}")

        if failed_files and not uploaded_images and not duplicate_files:
            logger.error(f"[{trace_id}] 上传完全失败: {failed_files}")
            return Response({
                'status': 'error',
                'message': 'Upload failed',
                'success_count': 0,
                'uploaded_images': [],
                'duplicates': [],
                'failed_files': failed_files,
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        response_data = {
            'status': 'ok',
            'success_count': len(uploaded_images),
            'uploaded_images': self.get_serializer(uploaded_images, many=True).data,
            'duplicates': duplicate_files,
            'failed_files': failed_files,
        }

        if duplicate_files:
            response_data['status'] = 'partial'  # 部分成功（含重复）
            return Response(response_data, status=status.HTTP_207_MULTI_STATUS)

        if failed_files:
            response_data['status'] = 'partial'  # 部分成功（部分文件失败）
            return Response(response_data, status=status.HTTP_207_MULTI_STATUS)

        return Response(response_data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='import-local-images')
    def import_local_images(self, request):
        """
        直接引用本地图片（不复制文件）
        request body: { paths: string[] }
        每个路径必须是绝对路径，文件必须存在。
        """
        trace_id = _new_trace_id()
        paths = request.data.get('paths', [])
        folder_id = request.data.get('folder_id')
        if not isinstance(paths, list) or not paths:
            return Response({'error': 'paths is required and must be a list'}, status=status.HTTP_400_BAD_REQUEST)

        folder = None
        if folder_id:
            try:
                folder = Folder.objects.get(id=folder_id)
            except Folder.DoesNotExist:
                return Response({'error': 'Folder not found'}, status=status.HTTP_404_NOT_FOUND)

        imported = []
        failed = []
        skipped = []
        for abs_path in paths:
            if not os.path.isabs(abs_path) or not os.path.isfile(abs_path):
                failed.append({'path': abs_path, 'error': 'Invalid or non-existent path'})
                continue
            # 按 source_path 去重
            if CassavaImage.objects.filter(source_path=abs_path).exists():
                skipped.append(abs_path)
                continue
            try:
                name = os.path.basename(abs_path)
                file_size = os.path.getsize(abs_path)
                preview_oss_key = None
                try:
                    img = Image.open(abs_path)
                    if img.mode in ('RGBA', 'P'):
                        img = img.convert('RGB')
                    max_size = (600, 600)
                    img.thumbnail(max_size)
                    thumb_io = io.BytesIO()
                    img.save(thumb_io, format='JPEG', quality=60)
                    thumb_content = thumb_io.getvalue()
                    preview_path = build_preview_storage_key(folder=folder)
                    preview_oss_key = default_storage.save(preview_path, ContentFile(thumb_content))
                except Exception as e:
                    logger.warning(f"[{trace_id}] Error generating preview for {abs_path}: {e}")

                image = CassavaImage.objects.create(
                    name=name,
                    image='',
                    source_path=abs_path,
                    preview_oss_key=preview_oss_key or '',
                    folder=folder,
                    size=file_size,
                    owner=desktop_user(request),
                    status='pending',
                    storage_mode='external',
                    file_status='valid',
                )
                imported.append(image)
            except Exception as e:
                logger.exception(f"[{trace_id}] Failed to import {abs_path}: {e}")
                failed.append({'path': abs_path, 'error': str(e)})

        logger.info(f"[{trace_id}] Local import: success={len(imported)}, failed={len(failed)}, skipped={len(skipped)}")
        return Response({
            'status': 'ok' if not failed else 'partial',
            'imported_count': len(imported),
            'imported': self.get_serializer(imported, many=True).data,
            'failed': failed,
            'skipped': skipped,
        }, status=status.HTTP_200_OK if imported or skipped else status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'], url_path='check-file-validity')
    def check_file_validity(self, request):
        """
        批量检测外部引用图片的文件有效性
        request body: { image_ids: int[] }
        返回 { image_id: 'valid' | 'missing', ... }
        """
        image_ids = request.data.get('image_ids', [])
        if not isinstance(image_ids, list):
            return Response({'error': 'image_ids must be a list'}, status=status.HTTP_400_BAD_REQUEST)

        results = {}
        for img_id in image_ids:
            try:
                image = CassavaImage.objects.get(id=img_id)
            except CassavaImage.DoesNotExist:
                results[str(img_id)] = 'not_found'
                continue

            if getattr(image, 'storage_mode', 'managed') != 'external':
                results[str(img_id)] = 'not_external'
                continue

            source_path = getattr(image, 'source_path', '') or ''
            if not source_path:
                results[str(img_id)] = 'missing'
                continue

            if os.path.isfile(source_path):
                results[str(img_id)] = 'valid'
                if image.file_status != 'valid':
                    image.file_status = 'valid'
                    image.save(update_fields=['file_status', 'updated_at'])
            else:
                results[str(img_id)] = 'missing'
                if image.file_status != 'missing':
                    image.file_status = 'missing'
                    image.save(update_fields=['file_status', 'updated_at'])

        return Response(results)

    @action(detail=False, methods=['post'], url_path='upload-batch')
    def upload_batch(self, request):
        """
        批量上传（处理 ZIP 包等）
        """
        trace_id = _new_trace_id()
        import zipfile
        from .services import ImageService

        file = request.FILES.get('file')
        logger.info(f"[{trace_id}] ZIP上传请求开始: {file.name if file else 'unknown'}")
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
                            user=desktop_user(request)
                        )

                        if image:
                            count += 1
                        else:
                            if error and error[0] == 'DUPLICATE_NAME':
                                duplicates.append(simple_name)
                            else:
                                errors.append(f"{simple_name}: {error[1] if error else 'Unknown error'}")

                    except Exception as e:
                        logger.warning(f"[{trace_id}] Error processing {image_name} in zip: {e}")
                        errors.append(f"{image_name}: {str(e)}")

            # 统一返回结构
            logger.info(f"[{trace_id}] ZIP上传完成: 成功={count}, 重复={len(duplicates)}, 失败={len(errors)}")
            total = count + len(duplicates) + len(errors)
            if total == 0:
                logger.error(f"[{trace_id}] ZIP无有效图片")
                return Response({
                    'status': 'error',
                    'message': 'No valid images found in zip file',
                    'success_count': 0,
                    'duplicates': duplicates,
                    'failed_files': errors[:10],
                }, status=status.HTTP_400_BAD_REQUEST)

            if errors and not count:
                logger.error(f"[{trace_id}] ZIP上传完全失败: {errors[:5]}")
                return Response({
                    'status': 'error',
                    'message': 'All images failed to upload',
                    'success_count': 0,
                    'duplicates': duplicates,
                    'failed_files': errors[:10],
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            response_data = {
                'status': 'ok' if (count > 0 and not duplicates and not errors) else 'partial',
                'success_count': count,
                'uploaded_images': [],
                'duplicates': duplicates,
                'failed_files': errors[:10],
            }
            return Response(response_data, status=status.HTTP_207_MULTI_STATUS if response_data['status'] == 'partial' else status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': f'Failed to process zip file: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class FolderViewSet(viewsets.ModelViewSet, PermissionMixin, ResponseFormatMixin):
    """
    文件夹管理视图集
    """
    queryset = Folder.objects.all()
    serializer_class = FolderSerializer
    permission_classes = [AllowAny]
    pagination_class = StandardResultsSetPagination

    def perform_create(self, serializer):
        # 桌面单用户模式：移除权限检查
        serializer.save(owner=desktop_user(self.request))

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

        if hasattr(self, 'filter_queryset_by_permission'):
            return self.filter_queryset_by_permission(queryset)
        return queryset

    @action(detail=True, methods=['get'])
    def images(self, request, pk=None):
        # 桌面单用户模式：移除权限检查
        folder = self.get_object()
        images = folder.images.all()
        serializer = CassavaImageListSerializer(images, many=True, context=self.get_serializer_context())
        return self.success_response(serializer.data)

    def update(self, request, *args, **kwargs):
        # 桌面单用户模式：移除权限检查
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        # 桌面单用户模式：移除权限检查
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        # 桌面单用户模式：移除权限检查
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def add_images(self, request, pk=None):
        # 桌面单用户模式：移除权限检查
        folder = self.get_object()
        image_ids = request.data.get('image_ids', [])
        queryset = CassavaImage.objects.filter(id__in=image_ids)
        updated = queryset.update(folder=folder)
        return self.success_response({'updated': updated})

    @action(detail=True, methods=['post'], url_path='delete_with_strategy')
    def delete_with_strategy(self, request, pk=None):
        # 桌面单用户模式：移除权限检查
        folder = self.get_object()
        strategy = request.data.get('strategy') or 'keep'
        target_folder_id = request.data.get('target_folder_id')

        # 递归深度限制，防止极深嵌套导致栈溢出
        MAX_DEPTH = 100
        folder_ids = set()
        queue = [(folder.id, 0)]  # (folder_id, depth)
        while queue:
            current, depth = queue.pop()
            if depth > MAX_DEPTH:
                return self.error_response(f"文件夹嵌套深度超过 {MAX_DEPTH} 层，可能存在循环引用", status_code=status.HTTP_400_BAD_REQUEST)
            if current in folder_ids:
                continue
            folder_ids.add(current)
            children = list(Folder.objects.filter(parent_id=current).values_list('id', flat=True))
            for child_id in children:
                queue.append((child_id, depth + 1))

        images_qs = CassavaImage.objects.filter(folder_id__in=list(folder_ids))

        with transaction.atomic():
            affected_images = images_qs.count()

            if strategy == 'move':
                if not target_folder_id:
                    return self.error_response("未提供目标文件夹", status_code=status.HTTP_400_BAD_REQUEST)
                try:
                    target_folder = Folder.objects.get(id=target_folder_id)
                except Folder.DoesNotExist:
                    return self.error_response("目标文件夹不存在", status_code=status.HTTP_404_NOT_FOUND)
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
    permission_classes = [AllowAny]
    pagination_class = StandardResultsSetPagination

    def perform_create(self, serializer):
        # 桌面模式：不保存 owner 字段（SegmentationResult 模型无此字段）
        serializer.save()

    def get_queryset(self):
        queryset = super().get_queryset()

        if hasattr(self, 'filter_queryset_by_permission'):
            return self.filter_queryset_by_permission(queryset)
        return queryset

class PredictionResultViewSet(viewsets.ModelViewSet, PermissionMixin, ResponseFormatMixin):
    """
    预测结果视图集
    """
    queryset = PredictionResult.objects.all()
    serializer_class = PredictionResultSerializer
    permission_classes = [AllowAny]
    pagination_class = PredictionResultPagination

    def get_queryset(self):
        queryset = super().get_queryset()

        # 桌面模式：支持 task_id 过滤
        task_id = self.request.query_params.get('task_id')
        if task_id:
            queryset = queryset.filter(task_id=task_id)

        if hasattr(self, 'filter_queryset_by_permission'):
            return self.filter_queryset_by_permission(queryset)
        return queryset

    @action(detail=False, methods=['post'], url_path='miniapp-run')
    def miniapp_run(self, request):
        image_ids = request.data.get('image_ids')
        if not isinstance(image_ids, list) or len(image_ids) == 0:
            return self.error_response('请先提供 image_ids', status_code=status.HTTP_400_BAD_REQUEST)

        # 统一转字符串（兼容 char(32) 遗留 ID），全程无类型混合
        normalized_ids = []
        for image_id in image_ids:
            sid = str(image_id)
            if sid.isdigit() and int(sid) > 0:
                normalized_ids.append(sid)  # 数字 ID 也转字符串
            elif sid.strip():
                normalized_ids.append(sid)

        if not normalized_ids:
            return self.error_response('没有有效的图片 ID', status_code=status.HTTP_400_BAD_REQUEST)

        # 桌面单用户模式：移除权限检查
        execution = PredictionService.run_predictions_for_images(
            image_ids=normalized_ids,
            params=request.data,
            owner=desktop_user(request)
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
    permission_classes = [AllowAny]

    def get_queryset(self):
        queryset = super().get_queryset()

        if hasattr(self, 'filter_queryset_by_permission'):
            return self.filter_queryset_by_permission(queryset)
        return queryset

    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        """
        创建任务并启动后台处理
        """
        task = serializer.save(owner=desktop_user(self.request))

        # 如果是预测任务，启动后台线程执行
        if task.type == 'prediction':
            import threading
            from django.db import transaction
            from .services import TaskService

            # 获取请求中的参数
            # 注意：serializer.validated_data 已经处理过了，但我们可能需要原始 request.data 中的某些非模型字段
            # 这里简单起见传递 request.data，但在 execute_prediction_task 中需要小心处理
            params = self.request.data

            def _start():
                thread = threading.Thread(
                    target=TaskService.execute_prediction_task,
                    args=(task.id, params)
                )
                thread.daemon = True
                thread.start()

            transaction.on_commit(_start)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        task = self.get_object()
        if task.status == 'running':
            task.status = 'cancelled'
            task.save()
        return self.success_response({'message': 'Task cancelled'})

    @action(detail=True, methods=['post'])
    def retry(self, request, pk=None):
        """
        重试失败的任务
        """
        task = self.get_object()
        if task.status not in ('failed', 'cancelled'):
            return self.error_response('Only failed or cancelled tasks can be retried')

        task.status = 'pending'
        task.progress = 0
        task.save()

        # 如果是预测任务，启动后台线程执行
        if task.type == 'prediction':
            import threading
            from django.db import transaction
            from .services import TaskService

            params = task.parameters or {}

            def _start():
                thread = threading.Thread(
                    target=TaskService.execute_prediction_task,
                    args=(task.id, params)
                )
                thread.daemon = True
                thread.start()

            transaction.on_commit(_start)

        return self.success_response({'message': 'Task retry initiated', 'task_id': task.id})

class SystemSettingView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        settings_obj = SystemSetting.get_solo()
        data = SystemSettingSerializer(settings_obj).data
        data['enable_guest_access'] = False
        data['allow_registration'] = False
        data['maintenance_mode'] = False
        return Response(data)

    def patch(self, request):
        settings_obj = SystemSetting.get_solo()
        acting_user = desktop_user(request)

        # Capture old values for audit log
        old_values = SystemSettingSerializer(settings_obj).data

        payload = request.data.copy()
        payload['enable_guest_access'] = False
        payload['allow_registration'] = False
        payload['maintenance_mode'] = False

        serializer = SystemSettingSerializer(settings_obj, data=payload, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=acting_user)

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
                    user=acting_user,
                    action='UPDATE',
                    resource='SystemSetting',
                    resource_id='1',
                    details={'changes': changes},
                    ip_address=request.META.get('REMOTE_ADDR'),
                    success=True
                )
        except Exception as e:
            # Don't fail the request if logging fails
            logger.error(f"[{trace_id}] Failed to create audit log: {e}")

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
        'enable_guest_access': False,
        'allow_registration': False,
        'maintenance_mode': False
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def system_info(request):
    """
    返回系统信息，用于关于页面展示
    """
    import platform
    import sys
    import torch
    import os

    # 获取数据库路径
    from django.conf import settings
    db_path = settings.DATABASES['default']['NAME']
    db_path_str = str(db_path) if db_path else ''

    # 获取数据目录
    data_dir = os.environ.get('DESKTOP_DATA_DIR', '')
    if not data_dir:
        data_dir = os.path.join(os.path.dirname(db_path_str), '..') if db_path_str else ''

    # 获取运行时间
    from django.core.management import call_command
    from django.conf import settings
    start_time = getattr(settings, 'STARTUP_TIME', None)
    uptime = 0
    if start_time:
        uptime = int((timezone.now() - start_time).total_seconds())

    return Response({
        'version': '1.2.0',
        'electron': '28.0.0',
        'chrome': '120.0.0.0',
        'node': platform.python_version(),
        'platform': platform.system(),
        'arch': platform.machine(),
        'python': platform.python_version(),
        'pytorch': torch.__version__ if hasattr(torch, '__version__') else 'N/A',
        'cuda_available': torch.cuda.is_available() if hasattr(torch, 'cuda') else False,
        'database_path': db_path_str,
        'data_dir': str(data_dir),
        'uptime': uptime,
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def system_stats(request):
    """
    返回系统统计数据
    """
    total_images = CassavaImage.objects.count()
    total_predictions = PredictionResult.objects.count()
    total_tasks = ProcessingTask.objects.count()
    completed_tasks = ProcessingTask.objects.filter(status='completed').count()
    failed_tasks = ProcessingTask.objects.filter(status='failed').count()

    return Response({
        'total_images': total_images,
        'total_predictions': total_predictions,
        'total_tasks': total_tasks,
        'completed_tasks': completed_tasks,
        'failed_tasks': failed_tasks,
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def rebuild_index(request):
    """
    重建外部引用图片索引
    检测所有 storage_mode='external' 的图片，标记失效文件
    """
    valid_count = 0
    missing_count = 0

    try:
        external_images = CassavaImage.objects.filter(storage_mode='external')
        for image in external_images:
            source_path = getattr(image, 'source_path', '') or ''
            if source_path and os.path.isfile(source_path):
                if image.file_status != 'valid':
                    image.file_status = 'valid'
                    image.save(update_fields=['file_status', 'updated_at'])
                valid_count += 1
            else:
                if image.file_status != 'missing':
                    image.file_status = 'missing'
                    image.save(update_fields=['file_status', 'updated_at'])
                missing_count += 1

        return Response({'valid': valid_count, 'missing': missing_count, 'status': 'ok'})
    except Exception as e:
        return Response({'error': str(e)}, status=500)


def get_cache_size(path):
    """递归计算目录大小"""
    total = 0
    if os.path.exists(path):
        for dirpath, dirnames, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                try:
                    total += os.path.getsize(fp)
                except (OSError, IOError):
                    pass
    return total


def format_size(bytes_size):
    """格式化文件大小"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_size < 1024.0:
            return f"{bytes_size:.2f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.2f} TB"


@api_view(['GET'])
@permission_classes([AllowAny])
def cache_info(request):
    """
    获取缓存信息：缩略图缓存、临时文件、预测结果缓存
    """
    data_dir = os.environ.get('DESKTOP_DATA_DIR', '')
    thumbnail_cache = os.path.join(data_dir, 'thumbnails') if data_dir else ''
    temp_files = os.path.join(data_dir, 'temp') if data_dir else ''
    pred_cache = os.path.join(data_dir, 'predictions') if data_dir else ''

    thumbnail_size = get_cache_size(thumbnail_cache) if thumbnail_cache else 0
    temp_size = get_cache_size(temp_files) if temp_files else 0
    pred_size = get_cache_size(pred_cache) if pred_cache else 0

    return Response({
        'thumbnail_cache': {
            'path': thumbnail_cache,
            'size': thumbnail_size,
            'size_formatted': format_size(thumbnail_size)
        },
        'temp_files': {
            'path': temp_files,
            'size': temp_size,
            'size_formatted': format_size(temp_size)
        },
        'predictions_cache': {
            'path': pred_cache,
            'size': pred_size,
            'size_formatted': format_size(pred_size)
        },
        'total_size': thumbnail_size + temp_size + pred_size,
        'total_size_formatted': format_size(thumbnail_size + temp_size + pred_size)
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def clear_cache(request):
    """
    清理缓存：清除指定类型的缓存文件
    """
    cache_type = request.data.get('type', 'all')

    data_dir = os.environ.get('DESKTOP_DATA_DIR', '')
    cleared = []
    errors = []

    def clear_directory(path, name):
        if not path or not os.path.exists(path):
            return
        count = 0
        for dirpath, dirnames, filenames in os.walk(path):
            for f in filenames:
                try:
                    os.remove(os.path.join(dirpath, f))
                    count += 1
                except (OSError, IOError) as e:
                    pass
        return count

    if cache_type in ('all', 'thumbnails'):
        path = os.path.join(data_dir, 'thumbnails') if data_dir else ''
        count = clear_directory(path, '缩略图')
        if count:
            cleared.append(f'缩略图缓存 ({count} 文件)')

    if cache_type in ('all', 'temp'):
        path = os.path.join(data_dir, 'temp') if data_dir else ''
        count = clear_directory(path, '临时文件')
        if count:
            cleared.append(f'临时文件 ({count} 文件)')

    if cache_type in ('all', 'predictions'):
        path = os.path.join(data_dir, 'predictions') if data_dir else ''
        count = clear_directory(path, '预测缓存')
        if count:
            cleared.append(f'预测缓存 ({count} 文件)')

    return Response({
        'status': 'ok',
        'cleared': cleared,
        'errors': errors
    })
