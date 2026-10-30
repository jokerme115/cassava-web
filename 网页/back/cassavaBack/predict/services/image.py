"""ImageService —— 批次6 从 services.py 拆出。"""

from ..image_quality import image_dimensions
from .base import BaseService
from .share import ShareService
from PIL import Image
from io import BytesIO
import os
import uuid

import logging

logger = logging.getLogger(__name__)

class ImageService(BaseService):
    """
    图像服务类，处理图像相关的业务逻辑
    """

    SUPPORTED_UPLOAD_FORMATS = {'JPEG', 'PNG', 'BMP', 'WEBP', 'TIFF'}
    CONVERTIBLE_UPLOAD_FORMATS = {'MPO'}

    @staticmethod
    def _normalize_uploaded_image_bytes(image_data):
        verifier = Image.open(BytesIO(image_data))
        verifier.verify()
        image_format = verifier.format

        image = Image.open(BytesIO(image_data))
        if image_format in ImageService.SUPPORTED_UPLOAD_FORMATS:
            return {
                'content': image_data,
                'image': image,
                'format': image_format,
                'converted': False,
                'suggested_extension': None,
            }

        if image_format in ImageService.CONVERTIBLE_UPLOAD_FORMATS:
            try:
                image.seek(0)
            except EOFError:
                pass

            converted = image.convert('RGB')
            output = BytesIO()
            converted.save(output, format='JPEG', quality=95)
            return {
                'content': output.getvalue(),
                'image': image,
                'format': 'JPEG',
                'converted': True,
                'suggested_extension': '.jpg',
            }

        raise Exception(f"Unsupported image format: {image_format}")
    
    @staticmethod
    def upload_image(file, folder_id=None, check_duplicate=True, force=False, user=None):
        """All upload routes share original-byte identity and metadata. Never overwrite."""
        import hashlib
        from datetime import datetime, timezone as dt_timezone, timedelta
        from django.db import transaction
        from django.contrib.auth.models import User
        from ..models import CassavaImage, Folder
        from ..storage_utils import read_storage_bytes, save_storage_bytes
        from ..recycling import unique_name
        from PIL import ImageOps
        try:
            file.seek(0)
            raw = file.read(128 * 1024 * 1024 + 1)
            if len(raw) > 128 * 1024 * 1024:
                return None, ('IMAGE_TOO_LARGE', '单张图片超过128MB')
            digest = hashlib.sha256(raw).hexdigest()
            normalized = ImageService._normalize_uploaded_image_bytes(raw)
            data, image = normalized['content'], normalized['image']
            width, height = image_dimensions(data)
            if width * height > 50000000:
                return None, ('IMAGE_TOO_LARGE', '图片超过5000万像素')
            folder = Folder.objects.get(pk=folder_id) if folder_id else None
            if folder and (not user or (not user.is_superuser and folder.owner_id != user.pk
                    and not ShareService.check_permission(user, 'folder', folder, 'edit'))):
                return None, ('PERMISSION_DENIED', '无权上传到该文件夹')
            capture = None
            exif = image.getexif()
            try:
                exif = {**dict(exif), **dict(exif.get_ifd(34665))}
            except (KeyError, ValueError, TypeError):
                pass
            if exif.get(36867):
                try:
                    capture = datetime.strptime(str(exif[36867]).strip().strip('\x00'), '%Y:%m:%d %H:%M:%S')
                    offset = str(exif.get(36881, '+08:00'))
                    zone = dt_timezone(timedelta(hours=8))
                    if len(offset) == 6 and offset[0] in '+-' and offset[3] == ':':
                        zone = dt_timezone(timedelta(minutes=(int(offset[1:3])*60+int(offset[4:]))*(1 if offset[0]=='+' else -1)))
                    capture = capture.replace(tzinfo=zone)
                except (ValueError, TypeError):
                    capture = None
            name = os.path.basename(str(file.name).replace('\\', '/'))
            with transaction.atomic():
                # Owner row serializes root-directory names as well as folder uploads.
                from ..resource_lock import lock_owner
                lock_owner(user)
                candidates = CassavaImage.objects.filter(owner=user, folder=folder)
                if check_duplicate:
                    for old in candidates.filter(content_sha256=''):
                        try:
                            old.content_sha256 = hashlib.sha256(read_storage_bytes(old.oss_key)).hexdigest()
                            old.save(update_fields=['content_sha256'])
                        except (OSError, ValueError):
                            pass
                    existing = candidates.filter(content_sha256=digest).first()
                    if existing:
                        return None, ('DUPLICATE_CONTENT', f'同目录内容重复，已跳过：{existing.name}')
                name = unique_name(candidates, name)
                extension = normalized.get('suggested_extension') or os.path.splitext(name)[1].lower()
                key = f'images/{folder.pk if folder else "unclassified"}/{uuid.uuid4().hex}{extension}'
                saved = save_storage_bytes(key, data, error_message='原图保存失败')
                preview = ImageOps.exif_transpose(image).convert('RGB')
                preview.thumbnail((600, 600))
                buffer = BytesIO(); preview.save(buffer, format='JPEG', quality=75)
                preview_key = save_storage_bytes(f'previews/{uuid.uuid4().hex}.jpg', buffer.getvalue(), error_message='预览保存失败')
                result = CassavaImage.objects.create(name=name, oss_key=saved, preview_oss_key=preview_key,
                    size=len(data), pixel_width=width, pixel_height=height, folder=folder, capture_time=capture,
                    capture_time_source='exif' if capture else 'unknown', content_sha256=digest, owner=user)
                return result, None
        except Folder.DoesNotExist:
            return None, ('FOLDER_NOT_FOUND', '目标目录不存在或已进入回收站')
        except Exception as exc:
            logger.warning('Image import failed: %s', exc)
            return None, ('INVALID_IMAGE', str(exc))

    @staticmethod
    def upload_single_image(file, folder_id=None, check_duplicate=True, force=False, user=None):
        image, error = ImageService.upload_image(
            file=file,
            folder_id=folder_id,
            check_duplicate=check_duplicate,
            force=force,
            user=user
        )
        if error:
            code, message = error
            if code == 'DUPLICATE_NAME':
                return ('DUPLICATE_NAME', message)
            raise Exception(message)
        return image
    
    @staticmethod
    def batch_upload_images(files, folder_id=None, check_duplicate=True, force=False, user=None):
        results = []
        success_count = 0
        for file in files:
            try:
                image, error = ImageService.upload_image(
                    file=file,
                    folder_id=folder_id,
                    check_duplicate=check_duplicate,
                    force=force,
                    user=user
                )
                if error:
                    code, message = error
                    results.append({
                        "name": getattr(file, "name", ""),
                        "success": False,
                        "code": code,
                        "message": message
                    })
                else:
                    success_count += 1
                    results.append({
                        "name": image.name,
                        "success": True,
                        "id": image.id
                    })
            except Exception as e:
                results.append({
                    "name": getattr(file, "name", ""),
                    "success": False,
                    "code": "ERROR",
                    "message": str(e)
                })
        return {
            "success_count": success_count,
            "total": len(files),
            "results": results
        }
    
    @staticmethod
    def batch_upload_from_request(request, user=None):
        """
        从请求中批量上传图片，支持ZIP或多文件
        """
        files = request.FILES.getlist('files')
        if not files and 'file' in request.FILES:
            files = [request.FILES['file']]
        if not files:
            raise Exception("未提供文件")
        folder_id = request.data.get('folder_id')
        check_duplicate = request.data.get('check_duplicate', '1') == '1'
        force = request.data.get('force', '0') == '1'
        return ImageService.batch_upload_images(
            files=files,
            folder_id=folder_id,
            check_duplicate=check_duplicate,
            force=force,
            user=user
        )
    
    @staticmethod
    def delete_image(image_id):
        """
        删除图像
        
        Args:
            image_id: 图像ID
            
        Returns:
            tuple: (success, error) 元组
        """
        CassavaImage = ImageService.get_model('CassavaImage')
        try:
            image = CassavaImage.objects.get(id=image_id)
            # 删除数据库记录
            image.delete()
            return True, None
        except CassavaImage.DoesNotExist:
            return False, ('NOT_FOUND', '图像不存在')
        except Exception as e:
            logger.error(f"删除图像失败: {e}")
            return False, ('ERROR', str(e))
    
    @staticmethod
    def delete_image_with_file(image):
        """
        根据实例删除图像及其在OSS中的文件
        """
        try:
            image.delete()
            return True
        except Exception as e:
            logger.error(f"删除图像失败: {e}")
            return False
    
    @staticmethod
    def get_image_details(image_id):
        """
        获取图像详细信息
        
        Args:
            image_id: 图像ID
            
        Returns:
            CassavaImage对象或None
        """
        CassavaImage = ImageService.get_model('CassavaImage')
        try:
            return CassavaImage.objects.get(id=image_id)
        except CassavaImage.DoesNotExist:
            return None
