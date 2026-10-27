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
        """
        上传图像文件
        
        Args:
            file: 文件对象
            folder_id: 文件夹ID
            check_duplicate: 是否检查重复
            force: 是否强制覆盖
            user: 上传用户
            
        Returns:
            tuple: (image_obj, error) 元组，image_obj为创建的图像对象，error为错误信息
        """
        from ..oss_service import upload_file_to_oss, check_oss_configured
        from ..storage_utils import build_preview_storage_key
        from django.db import transaction
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile
        import uuid
        from PIL.ExifTags import TAGS
        import io
        from datetime import datetime
        
        CassavaImage = ImageService.get_model('CassavaImage')
        Folder = ImageService.get_model('Folder')
        
        name = file.name
        folder = None
        if folder_id:
            try:
                folder = Folder.objects.get(id=folder_id)
            except Folder.DoesNotExist:
                folder = None
        
        if folder and user and (not user.is_superuser) and folder.owner_id != user.id:
            if not ShareService.check_permission(user, 'folder', folder, 'edit'):
                return None, ('PERMISSION_DENIED', '无权上传到该文件夹')
        
        # 检查重名
        qs = CassavaImage.objects.filter(name=name)
        if user:
            qs = qs.filter(owner=user)
            
        if folder:
            qs = qs.filter(folder=folder)
        else:
            qs = qs.filter(folder=None)
        
        if qs.exists():
            if force:
                # 覆盖：删除原图片（含OSS）
                for img in qs:
                    img.delete()
            elif check_duplicate:
                return None, ('DUPLICATE_NAME', '文件重名')
            else:
                # 自动重命名
                base, ext = name.rsplit('.', 1) if '.' in name else (name, '')
                i = 1
                new_name = f"{base}({i}).{ext}" if ext else f"{base}({i})"
                
                # 检查新名字是否重复
                check_qs = CassavaImage.objects.filter(name=new_name, folder=folder)
                if user:
                    check_qs = check_qs.filter(owner=user)
                else:
                    # 如果没有用户，且是旧数据兼容，可能不filter owner
                    # 但为了安全，如果不传user，默认只查自己的？或者全局？
                    # 假设不传user就是系统级或公开，或者不检查owner
                    pass

                while check_qs.exists():
                    i += 1
                    new_name = f"{base}({i}).{ext}" if ext else f"{base}({i})"
                    check_qs = CassavaImage.objects.filter(name=new_name, folder=folder)
                    if user:
                        check_qs = check_qs.filter(owner=user)
                name = new_name
        
        # 验证图片有效性并尝试获取EXIF
        capture_time = None
        normalized_upload = None
        try:
            # 重置文件指针
            file.seek(0)
            image_data = file.read()

            normalized_upload = ImageService._normalize_uploaded_image_bytes(image_data)
            image_data = normalized_upload['content']
            image = normalized_upload['image']
            pixel_width, pixel_height = image_dimensions(image_data)
            
            # 获取EXIF数据
            exif_data = image.getexif()
            if exif_data:
                # 优先检查的标签列表
                # 36867: DateTimeOriginal (拍摄时间)
                # 36868: DateTimeDigitized (数字化时间)
                # 306: DateTime (修改时间)
                date_tags = [36867, 36868, 306]
                
                for tag_id in date_tags:
                    if tag_id in exif_data:
                        date_str = exif_data[tag_id]
                        try:
                            # 尝试解析EXIF日期时间字符串 "YYYY:MM:DD HH:MM:SS"
                            # 有些设备可能会在字符串末尾包含null字符或其他非标准格式
                            clean_date_str = str(date_str).strip().replace('\x00', '')
                            capture_time = datetime.strptime(clean_date_str, '%Y:%m:%d %H:%M:%S')
                            if capture_time:
                                break
                        except (ValueError, TypeError):
                            continue
            
            # 重置文件指针以供后续使用
            file.seek(0)
        except Exception as e:
            logger.warning(f"无效图片文件: {e}")
            return None, ('INVALID_IMAGE', f"Invalid image file: {str(e)}")
        
        import os
        _, ext = os.path.splitext(name)
        safe_ext = normalized_upload.get('suggested_extension') or (ext or '').lower()
        if folder:
            storage_key = f"images/{folder.id}/{uuid.uuid4().hex}{safe_ext}"
        else:
            storage_key = f"images/{uuid.uuid4().hex}{safe_ext}"
        data = image_data
        if check_oss_configured():
            upload_result = upload_file_to_oss(storage_key, data)
            if upload_result.get('status_code') != 200:
                return None, ('OSS_UPLOAD_FAILED', 'OSS上传失败')
            saved_path = storage_key
        else:
            saved_path = default_storage.save(storage_key, ContentFile(data))

        preview_oss_key = None
        try:
            preview_image = image.copy()
            if preview_image.mode in ('RGBA', 'P'):
                preview_image = preview_image.convert('RGB')

            preview_image.thumbnail((600, 600))
            thumb_io = io.BytesIO()
            preview_image.save(thumb_io, format='JPEG', quality=60)
            preview_content = thumb_io.getvalue()
            preview_path = build_preview_storage_key(folder=folder)

            if check_oss_configured():
                preview_result = upload_file_to_oss(preview_path, preview_content)
                if preview_result.get('status_code') == 200:
                    preview_oss_key = preview_path
            else:
                preview_oss_key = default_storage.save(preview_path, ContentFile(preview_content))
        except Exception as exc:
            logger.warning(f"预览图生成失败: {exc}")
        
        # 创建图像记录
        real_size = len(data)
        image = CassavaImage.objects.create(
            name=name,
            oss_key=saved_path,
            preview_oss_key=preview_oss_key,
            size=real_size,
            pixel_width=pixel_width, pixel_height=pixel_height,
            folder=folder,
            capture_time=capture_time,
            owner=user
        )
        
        return image, None
    
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
