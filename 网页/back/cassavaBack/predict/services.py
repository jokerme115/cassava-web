"""木薯采后腐烂面积预测 —— 业务服务层。

批次6 分步拆分（原 3913 行）：
- 模型推理相关（权重定位、DeepLabV3+ 推理、TTA、掩膜后处理）已移到 `deeplab_service.py`
- 本文件保留图片/分割/预测/任务/文件夹/审计/分享等业务服务类

对外名字保持不变：`predict.views` 等模块仍然 `from .services import XxxService`。
"""

import logging
import os
import shutil
import tempfile
import uuid
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps
from django.conf import settings
from django.utils import timezone

from .image_quality import image_dimensions
from .m6_predictor import m6_best_predictor
from .ensemble import LABELS, METHOD
from .mask_utils import calculate_mask_metrics, confidence_to_png_bytes, mask_to_png_bytes

# 模型推理层：拆分前置位，调用方仍从本模块导入这些名字
from .deeplab_service import (  # noqa: F401
    DeepLabV3PlusService,
    check_model_path,
    deeplabv3plus_service,
    describe_prediction_failure,
    post_process_mask,
    prediction_provenance,
    resolve_existing_model_path,
    tta_predict,
)

logger = logging.getLogger(__name__)

# 以下是新增的业务服务类，用于业务逻辑处理


class BaseService:
    """
    基础服务类，提供通用功能
    """
    @classmethod
    def get_model(cls, model_name):
        """
        获取指定的模型类
        
        Args:
            model_name: 模型名称
            
        Returns:
            Model: Django模型类
        """
        from django.apps import apps
        return apps.get_model('predict', model_name)


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
        from .oss_service import upload_file_to_oss, check_oss_configured
        from .storage_utils import build_preview_storage_key
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


class SegmentationService(BaseService):
    """
    分割服务类，处理图像分割相关的业务逻辑
    """
    
    @staticmethod
    def create_segmentation_result(original_image, result_image_path, result_data, segmentation_type):
        """
        创建分割结果记录
        
        Args:
            original_image: 原始图像对象
            result_image_path: 结果图像路径
            result_data: 分割结果数据
            segmentation_type: 分割类型 ('first' 或 'second')
            
        Returns:
            SegmentationResult对象
        """
        from .storage_utils import save_storage_bytes
        import uuid
        
        SegmentationResult = SegmentationService.get_model('SegmentationResult')
        
        # 保存结果图像到当前配置的存储后端
        result_storage_key = f"segmentations/{uuid.uuid4()}.png"
        with open(result_image_path, 'rb') as f:
            result_data_bytes = f.read()
        result_storage_key = save_storage_bytes(
            result_storage_key,
            result_data_bytes,
            error_message="分割结果保存失败",
        )
        
        # 创建分割结果记录
        description = ""
        if result_data is not None:
            try:
                import json
                description = json.dumps(result_data, ensure_ascii=False)
            except Exception:
                description = str(result_data)
        
        # 继承原始图片的拥有者
        owner = original_image.owner if original_image and hasattr(original_image, 'owner') else None
        
        result = SegmentationResult.objects.create(
            name=f"{original_image.name}_segmentation",
            original_image=original_image,
            oss_key=result_storage_key,
            description=description,
            segmentation_type=segmentation_type,
            owner=owner
        )
        
        return result
    
    @staticmethod
    def get_segmentations_by_image(image_id):
        """
        获取指定图像的所有分割结果
        
        Args:
            image_id: 图像ID
            
        Returns:
            SegmentationResult查询集
        """
        SegmentationResult = SegmentationService.get_model('SegmentationResult')
        return SegmentationResult.objects.filter(original_image_id=image_id)
    
    @staticmethod
    def get_segmentation_results(segmentation_type=None, original_image_id=None, parent_segmentation_id=None, user=None):
        SegmentationResult = SegmentationService.get_model('SegmentationResult')
        qs = SegmentationResult.objects.all()
        
        # 权限过滤：只能查看自己拥有的图片的分割结果，或者共享给自己的
        # 目前简化为：如果图片的owner是自己
        if user and not user.is_superuser:
            qs = qs.filter(original_image__owner=user)
            
        if segmentation_type:
            qs = qs.filter(segmentation_type=segmentation_type)
        if original_image_id:
            qs = qs.filter(original_image_id=original_image_id)
        if parent_segmentation_id:
            qs = qs.filter(parent_segmentation_id=parent_segmentation_id)
        return qs.order_by('-created_time')
    
    @staticmethod
    def delete_segmentation_result(segmentation):
        segmentation.delete()


class PredictionService(BaseService):
    """
    预测服务类，处理PPD预测相关的业务逻辑
    """
    
    @staticmethod
    def create_prediction_result(segmentation_result, prediction_value, result_image_path, model_info):
        """
        创建预测结果记录
        
        Args:
            segmentation_result: 分割结果对象
            prediction_value: 预测值
            result_image_path: 结果图像路径
            model_info: 模型信息
            
        Returns:
            PredictionResult对象
        """
        from .storage_utils import save_storage_bytes
        import uuid
        
        PredictionResult = PredictionService.get_model('PredictionResult')
        
        # 保存结果图像到当前配置的存储后端
        result_storage_key = f"predictions/{uuid.uuid4()}.png"
        with open(result_image_path, 'rb') as f:
            result_data_bytes = f.read()
        result_storage_key = save_storage_bytes(
            result_storage_key,
            result_data_bytes,
            error_message="预测结果保存失败",
        )
        
        # 创建预测结果记录
        model_type = model_info
        if isinstance(model_info, dict):
            model_type = model_info.get('model_type') or model_info.get('model') or 'YOLOv11'
        result = PredictionResult.objects.create(
            segmentation=segmentation_result,
            ppd_value=prediction_value,
            result_image=result_storage_key,
            model_type=str(model_type)
        )
        
        return result

    @staticmethod
    def _parse_prediction_params(params=None):
        params = params or {}
        advanced = {**params, **(params.get('parameters') if isinstance(params.get('parameters'), dict) else {})}

        def read_hw(*values, default=None):
            for value in values:
                if value in (None, '', []):
                    continue
                return value
            return default

        def read_bool(*values, default=False):
            for value in values:
                if value is None:
                    continue
                if isinstance(value, bool):
                    return value
                if isinstance(value, str):
                    return value.strip().lower() in ('1', 'true', 'yes', 'on')
                return bool(value)
            return default

        model_name = str(advanced.get('single_model_type') or advanced.get('modelType') or 'resnet101')
        use_ensemble = model_name == 'ensemble' or read_bool(
            advanced.get('use_ensemble'), advanced.get('predictionMode') == 'ensemble')
        if use_ensemble:
            model_name = 'ensemble'
        return {
            'confidence': float(advanced.get('confidenceThreshold', params.get('confidence', 0.5))),
            'use_ensemble': use_ensemble,
            'ensemble_method': METHOD if use_ensemble else None,
            'single_model_type': model_name,
            'model_label': LABELS.get(model_name, model_name),
            'min_area': int(advanced.get('minArea', params.get('min_area', 100))),
            'morph_kernel_size': int(advanced.get('morphKernelSize', params.get('morph_kernel_size', 5))),
            'morph_iterations': int(advanced.get('morphIterations', params.get('morph_iterations', 1))),
            'use_post_processing': read_bool(
                advanced.get('usePostProcessing'),
                params.get('use_post_processing'),
                default=True
            ),
            'use_tta': read_bool(
                advanced.get('useTTA'),
                params.get('use_tta'),
                default=False
            ),
            'overlap': float(params.get('overlap', 0.2)),
            'algorithm': params.get('algorithm'),
            'patch_size': read_hw(
                advanced.get('patchSize'),
                params.get('patch_size'),
                default=(512, 512)
            ),
            'stride': read_hw(
                advanced.get('stride'),
                params.get('stride'),
                default=(256, 256)
            ),
            'overlay_opacity': float(
                advanced.get('overlayOpacity', params.get('overlay_opacity', 0.45))
            ),
            'save_probability': read_bool(
                advanced.get('saveProbability'),
                params.get('save_probability'),
                default=False
            ),
            'stage1_confidence': float(
                advanced.get('stage1Confidence', params.get('stage1_confidence', min(float(advanced.get('confidenceThreshold', params.get('confidence', 0.5))), 0.25)))
            ),
            'stage2_confidence': float(
                advanced.get('stage2Confidence', params.get('stage2_confidence', min(float(advanced.get('confidenceThreshold', params.get('confidence', 0.5))), 0.25)))
            ),
            'roi_padding': float(
                advanced.get('roiPadding', params.get('roi_padding', 0.10))
            ),
            'fallback_roi_padding': float(
                advanced.get('fallbackRoiPadding', params.get('fallback_roi_padding', 0.70))
            ),
            'expected_count': int(
                advanced.get('expectedCount', params.get('expected_count', 0))
            ),
            'stage_box_iou': float(
                advanced.get('stageBoxIou', params.get('stage_box_iou', 0.50))
            ),
        }

    @staticmethod
    def _save_mask_image(mask_array, image_name, work_dir):
        mask_filename = f"{Path(str(image_name)).stem}_m6_mask.png"
        mask_path = os.path.join(work_dir, mask_filename)
        mask_uint8 = mask_array.astype(np.uint8) * 255
        ok, encoded = cv2.imencode('.png', mask_uint8)
        if not ok:
            raise RuntimeError(f"Unable to encode M6 mask for {image_name}")
        encoded.tofile(mask_path)
        return mask_path

    @staticmethod
    def _store_mask_array(mask_array, prefix):
        """Persist a binary mask through the configured local/OSS storage backend."""
        if mask_array is None:
            return None
        from .storage_utils import save_storage_bytes
        return save_storage_bytes(
            f'{prefix}/{uuid.uuid4()}.png',
            mask_to_png_bytes(mask_array),
            error_message='预测掩码保存失败',
        )

    @staticmethod
    def _store_confidence_map(confidence_map, prefix='prediction_confidence'):
        """Persist a quantized confidence map without affecting the binary prediction result."""
        if confidence_map is None:
            return None
        from .storage_utils import save_storage_bytes
        return save_storage_bytes(
            f'{prefix}/{uuid.uuid4()}.png',
            confidence_to_png_bytes(confidence_map),
            error_message='预测置信度图保存失败',
        )

    @staticmethod
    def _run_m6_prediction(local_image_path, prediction_params, work_dir):
        m6_result = m6_best_predictor.predict(
            image_path=local_image_path,
            confidence_threshold=prediction_params['confidence'],
            min_area=prediction_params['min_area'],
            morph_kernel_size=prediction_params['morph_kernel_size'],
            morph_iterations=prediction_params['morph_iterations'],
            patch_size=prediction_params.get('patch_size'),
            stride=prediction_params.get('stride'),
            overlay_opacity=prediction_params.get('overlay_opacity', 0.45),
        )

        image_name = os.path.basename(str(local_image_path))
        mask_path = PredictionService._save_mask_image(
            mask_array=m6_result['mask'],
            image_name=image_name,
            work_dir=work_dir,
        )
        height, width = m6_result['mask'].shape[:2]
        image_array = np.asarray(ImageOps.exif_transpose(Image.open(local_image_path)).convert('RGB'))
        cassava_mask = deeplabv3plus_service.get_cassava_area_mask(image_array)
        if cassava_mask.shape != m6_result['mask'].shape:
            cassava_mask = np.asarray(Image.fromarray(cassava_mask).resize(
                m6_result['mask'].shape[::-1], Image.Resampling.NEAREST
            ))
        cassava_mask, rotten_mask, cassava_pixels, rotten_pixels, ppd_percent = calculate_mask_metrics(
            cassava_mask, m6_result['mask']
        )

        return {
            'success': True,
            'original_image': local_image_path,
            'segments_count': 1,
            'predictions_count': 1,
            'predictions': [{
                'ppd': ppd_percent,
                'overlay_image': m6_result['overlay_image'],
                'cassava_mask': cassava_mask,
                'rotten_mask': rotten_mask,
                'segment_info': {
                    'seg1_id': None,
                    'seg2_id': 'm6_full_image',
                    'seg2_image_path': mask_path,
                }
            }],
            'average_ppd': ppd_percent,
            'cassava_mask': cassava_mask,
            'rotten_mask': rotten_mask,
            'confidence_map': m6_result.get('disease_prob'),
            'seg1_results': [],
            'seg2_results': [{
                'id': 'm6_full_image',
                'image_path': mask_path,
                'bbox': [0, 0, width, height],
                'confidence': 1.0,
                'area': int(np.count_nonzero(m6_result['mask'])),
                'parent_id': None,
            }]
        }

    @staticmethod
    def _resolve_local_image_path(image, work_dir):
        from django.conf import settings
        from .oss_service import check_oss_configured, get_file_from_oss

        if not image or not image.oss_key:
            return None

        if check_oss_configured():
            file_data = get_file_from_oss(image.oss_key)
            if not file_data:
                return None

            temp_file_path = os.path.join(
                work_dir,
                f"temp_{image.id}_{os.path.basename(str(image.oss_key))}"
            )
            with open(temp_file_path, 'wb') as file_obj:
                file_obj.write(file_data)
            return temp_file_path

        full_path = os.path.join(settings.MEDIA_ROOT, str(image.oss_key))
        if os.path.exists(full_path):
            return full_path
        return None

    @staticmethod
    def _store_overlay_image(overlay_image):
        from .storage_utils import save_storage_bytes

        overlay_key = f"predictions/{uuid.uuid4()}.jpg"
        image_buffer = BytesIO()
        overlay_image.save(image_buffer, format='JPEG')
        overlay_bytes = image_buffer.getvalue()

        try:
            return save_storage_bytes(
                overlay_key,
                overlay_bytes,
                error_message="预测可视化保存失败",
            )
        except Exception as exc:
            logger.error(f"预测可视化保存失败: {exc}")
            return None

    @staticmethod
    def _create_prediction_result_for_image(image, result, prediction_params, processing_task=None, owner=None):
        PredictionResult = PredictionService.get_model('PredictionResult')

        seg1_map = {}
        for seg1_data in result.get("seg1_results", []):
            seg1_path = seg1_data.get("image_path")
            if not seg1_path or not os.path.exists(seg1_path):
                logger.warning(f"第一次分割结果文件不存在: {seg1_path}")
                continue

            seg1_obj = SegmentationService.create_segmentation_result(
                original_image=image,
                result_image_path=seg1_path,
                result_data={
                    "bbox": seg1_data.get("bbox"),
                    "confidence": seg1_data.get("confidence")
                },
                segmentation_type='first'
            )
            seg1_map[seg1_data.get("id")] = seg1_obj

        vis_images = {}
        seg2_results_list = result.get("seg2_results", [])

        for idx, seg2_data in enumerate(seg2_results_list):
            seg2_path = seg2_data.get("image_path")
            if not seg2_path or not os.path.exists(seg2_path):
                logger.warning(f"第二次分割结果文件不存在: {seg2_path}")
                continue

            seg2_obj = SegmentationService.create_segmentation_result(
                original_image=image,
                result_image_path=seg2_path,
                result_data={
                    "bbox": seg2_data.get("bbox"),
                    "confidence": seg2_data.get("confidence"),
                    "area": seg2_data.get("area")
                },
                segmentation_type='second'
            )

            parent_seg = seg1_map.get(seg2_data.get("parent_id"))
            if parent_seg:
                seg2_obj.parent_segmentation = parent_seg
                seg2_obj.save()

            vis_images[f"cut2_{idx + 1}"] = str(seg2_obj.oss_key)

        if result.get('disagreement_mask') is not None:
            vis_images['disagreement'] = PredictionService._store_mask_array(
                result['disagreement_mask'], 'prediction_masks/disagreement')
        for name, mask in (result.get('member_masks') or {}).items():
            vis_images['member_' + name] = PredictionService._store_mask_array(mask, 'prediction_masks/' + name)
        sub_ppd_values = []
        predictions = result.get("predictions", [])
        main_result_image = None
        cassava_mask_key = PredictionService._store_mask_array(
            result.get('cassava_mask'), 'prediction_masks/cassava'
        )
        rotten_mask_key = PredictionService._store_mask_array(
            result.get('rotten_mask'), 'prediction_masks/rotten'
        )
        confidence_map_key = PredictionService._store_confidence_map(result.get('confidence_map'))

        for idx, pred_data in enumerate(predictions):
            ppd = pred_data.get("ppd")
            overlay_image = pred_data.get("overlay_image")
            if ppd is not None:
                sub_ppd_values.append(ppd)

            if overlay_image is None:
                continue

            overlay_key = PredictionService._store_overlay_image(overlay_image)
            if not overlay_key:
                continue

            if idx == 0:
                main_result_image = overlay_key
            vis_images[f"pred_{idx + 1}"] = overlay_key

        if not main_result_image:
            main_result_image = image.oss_key

        result_owner = owner or getattr(image, 'owner', None)
        return PredictionResult.objects.create(
            original_image=image,
            ppd_value=result.get("average_ppd", 0),
            ppd_unit='percent',
            error_code="PARTIAL_RESULT" if result.get("warning") else None,
            error_message=result.get("warning"),
            cassava_mask_key=cassava_mask_key,
            rotten_mask_key=rotten_mask_key,
            confidence_map_key=confidence_map_key,
            sub_ppd_values=sub_ppd_values,
            result_image=main_result_image,
            oss_key=main_result_image,
            vis_images=vis_images,
            processing_task=processing_task,
            model_type=prediction_params.get('model_label', 'YOLOv11'),
            is_ensemble=prediction_params.get('use_ensemble', False),
            ensemble_method=prediction_params.get('ensemble_method'),
            ensemble_details=result.get('ensemble_details') or {},
            confidence_threshold=prediction_params.get('confidence', 0.5),
            min_area=prediction_params.get('min_area', 100),
            morph_kernel_size=prediction_params.get('morph_kernel_size', 5),
            morph_iterations=prediction_params.get('morph_iterations', 1),
            single_model_type=prediction_params.get('single_model_type', 'resnet101'),
            split_count=len(seg2_results_list),
            algorithm=prediction_params.get('algorithm'),
            overlap=prediction_params.get('overlap', 0.2),
            owner=result_owner
        )

    @staticmethod
    def run_predictions_for_images(
        image_ids,
        params=None,
        owner=None,
        processing_task=None,
        stop_check=None,
        progress_callback=None
    ):
        CassavaImage = PredictionService.get_model('CassavaImage')
        normalized_ids = []
        for image_id in image_ids or []:
            try:
                parsed_id = int(image_id)
            except (TypeError, ValueError):
                continue
            if parsed_id > 0:
                normalized_ids.append(parsed_id)

        images_by_id = {
            image.id: image for image in CassavaImage.objects.filter(id__in=normalized_ids)
        }
        images = [images_by_id[image_id] for image_id in normalized_ids if image_id in images_by_id]

        prediction_params = PredictionService._parse_prediction_params(params)
        results = []
        errors = []
        # 提交到开始执行之间被删除/失去权限的图片不会出现在查询结果里，显式记录，避免任务“静默少图”
        missing_ids = [image_id for image_id in normalized_ids if image_id not in images_by_id]
        for missing_id in missing_ids:
            errors.append({'image_id': missing_id, 'message': f'图片已被删除或无权访问（ID {missing_id}）'})
        processed_count = 0
        requested_count = len(normalized_ids)

        if not images:
            errors.append({'image_id': None, 'message': '没有可处理的图片'})
            return {
                'results': [],
                'errors': errors,
                'processed_count': 0,
                'requested_count': requested_count,
            }

        work_dir = tempfile.mkdtemp()
        try:
            total_images = len(images)
            for image in images:
                if callable(stop_check) and stop_check():
                    return {
                        'results': results,
                        'errors': errors,
                        'processed_count': processed_count,
                        'requested_count': requested_count,
                        'cancelled': True,
                    }

                try:
                    local_image_path = PredictionService._resolve_local_image_path(image, work_dir)
                    if not local_image_path:
                        errors.append({'image_id': image.id, 'message': f'无法获取图片文件: {image.name}'})
                        continue

                    prediction_result = deeplabv3plus_service.integrated_prediction(
                        local_image_path,
                        work_dir,
                        confidence_threshold=prediction_params['confidence'],
                        min_area=prediction_params['min_area'],
                        morph_kernel_size=prediction_params['morph_kernel_size'],
                        morph_iterations=prediction_params['morph_iterations'],
                        use_ensemble=prediction_params['use_ensemble'],
                        ensemble_method=prediction_params.get('ensemble_method') or METHOD,
                        single_model_type=prediction_params['single_model_type'],
                        patch_size=prediction_params.get('patch_size', (512, 512)),
                        stride=prediction_params.get('stride', (256, 256)),
                        overlay_opacity=prediction_params.get('overlay_opacity', 0.45),
                        stage1_confidence=prediction_params.get('stage1_confidence'),
                        stage2_confidence=prediction_params.get('stage2_confidence'),
                        roi_padding=prediction_params.get('roi_padding', 0.10),
                        fallback_roi_padding=prediction_params.get('fallback_roi_padding', 0.70),
                        expected_count=prediction_params.get('expected_count', 0),
                        stage_box_iou=prediction_params.get('stage_box_iou', 0.50),
                        use_post_processing=prediction_params['use_post_processing'],
                        use_tta=prediction_params['use_tta']
                    )

                    if "error" in prediction_result:
                        message = prediction_result.get('error') or '预测失败'
                        logger.error(f"预测失败 {image.name}: {message}")
                        errors.append({'image_id': image.id, 'message': str(message)})
                        continue

                    created_result = PredictionService._create_prediction_result_for_image(
                        image=image,
                        result=prediction_result,
                        prediction_params=prediction_params,
                        processing_task=processing_task,
                        owner=owner
                    )
                    results.append(created_result)
                except Exception as exc:
                    logger.error(f"处理图片 {image.id} 出错: {exc}", exc_info=True)
                    errors.append({'image_id': image.id, 'message': str(exc)})
                finally:
                    processed_count += 1
                    if callable(progress_callback):
                        progress_callback(processed_count, total_images)
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

        return {
            'results': results,
            'errors': errors,
            'processed_count': processed_count,
            'requested_count': requested_count,
        }
    
    @staticmethod
    def get_prediction_results(model_type=None, min_ppd=None, max_ppd=None, is_ensemble=None, segmentation_id=None, user=None):
        PredictionResult = PredictionService.get_model('PredictionResult')
        qs = PredictionResult.objects.all()
        
        # 权限过滤
        if user and not user.is_superuser:
            # 预测结果关联的原始图片的owner是当前用户
            # 或者关联的任务的owner是当前用户
            from django.db.models import Q
            qs = qs.filter(
                Q(original_image__owner=user) | 
                Q(processing_task__owner=user)
            )
        
        if model_type:
            qs = qs.filter(model_type=model_type)
        if min_ppd is not None:
            qs = qs.filter(ppd_value__gte=min_ppd)
        if max_ppd is not None:
            qs = qs.filter(ppd_value__lte=max_ppd)
        if is_ensemble is not None:
            if isinstance(is_ensemble, str):
                is_ensemble_value = is_ensemble.lower() in ['1', 'true', 'yes']
            else:
                is_ensemble_value = bool(is_ensemble)
            qs = qs.filter(is_ensemble=is_ensemble_value)
        if segmentation_id:
            qs = qs.filter(segmentation_id=segmentation_id)
        return qs.order_by('-prediction_time')
    
    @staticmethod
    def delete_prediction_result(prediction):
        prediction.delete()


class TaskService(BaseService):
    """
    任务服务类，处理后台任务相关的业务逻辑
    """
    
    @staticmethod
    def create_task(user, task_name, task_type, extra_params=None):
        """
        创建新任务
        
        Args:
            user: 用户对象
            task_name: 任务名称
            task_type: 任务类型
            extra_params: 额外参数
            
        Returns:
            ProcessingTask对象
        """
        from datetime import datetime
        
        ProcessingTask = TaskService.get_model('ProcessingTask')
        
        task = ProcessingTask.objects.create(
            name=f"{task_name}_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            type=task_type,
            status="pending" if task_type == "prediction" else "running",
            progress=0,
            owner=user if user and user.is_authenticated else None,
            **(extra_params or {})
        )
        
        return task
    
    @staticmethod
    def update_task_status(task_id, status, progress=None, error=None):
        """
        更新任务状态
        
        Args:
            task_id: 任务ID
            status: 新状态
            progress: 进度百分比
            error: 错误信息
            
        Returns:
            bool: 是否更新成功
        """
        ProcessingTask = TaskService.get_model('ProcessingTask')
        try:
            task = ProcessingTask.objects.get(id=task_id)
            task.status = status
            if progress is not None:
                task.progress = progress
            if error:
                task.error = error
            task.save()
            return True
        except ProcessingTask.DoesNotExist:
            return False
    
    @staticmethod
    def get_user_tasks(user, limit=None):
        """
        获取用户的任务列表
        
        Args:
            user: 用户对象
            limit: 返回数量限制
            
        Returns:
            ProcessingTask查询集
        """
        ProcessingTask = TaskService.get_model('ProcessingTask')
        queryset = ProcessingTask.objects.filter(owner_id=user.id).order_by('-created_time')
        if limit:
            return queryset[:limit]
        return queryset
    
    @staticmethod
    def get_tasks():
        ProcessingTask = TaskService.get_model('ProcessingTask')
        return ProcessingTask.objects.all().order_by('-created_time')
    
    @staticmethod
    def cancel_task(task):
        if task.status in {'pending', 'running'}:
            task.status = 'cancelled'
            task.save()
            return {'success': True}
        return {'success': False, 'message': '任务当前状态不可取消'}
    
    @staticmethod
    def delete_task(task):
        task.delete()

    @staticmethod
    def execute_prediction_task(task_id, params=None):
        """
        执行预测任务（后台运行）
        """
        from django.db import close_old_connections, transaction
        
        ProcessingTask = TaskService.get_model('ProcessingTask')
        CassavaImage = TaskService.get_model('CassavaImage')
        
        close_old_connections()

        try:
            with transaction.atomic():
                claimed = ProcessingTask.objects.filter(
                    id=task_id,
                    status='pending',
                ).update(status='running', progress=0, error=None)
                task = ProcessingTask.objects.get(id=task_id)
                if not claimed:
                    if task.status == 'cancelled':
                        return {"cancelled": True}
                    return {"skipped": True, "status": task.status}
        except ProcessingTask.DoesNotExist:
            return {"error": "任务不存在"}
            
        try:
            task.refresh_from_db(fields=['status'])
            if task.status == 'cancelled':
                return {"cancelled": True}

            params = {
                'single_model_type': task.single_model_type or 'resnet101',
                'confidence': task.threshold if task.threshold is not None else 0.5,
                'min_area': task.min_size if task.min_size is not None else 100,
                'algorithm': task.algorithm,
                'overlap': task.overlap if task.overlap is not None else 0.2,
                **dict(params or task.parameters or {}),
            }
            
            resolved = PredictionService._parse_prediction_params(params)
            task.parameters = {**(task.parameters or {}), '_execution': {
                'protocol': 'cassava-web-20261018', 'model': resolved['single_model_type'],
                'parameters': resolved, 'weights': prediction_provenance(resolved['single_model_type']),
                'started_at': timezone.now().isoformat(),
            }}
            task.save(update_fields=['parameters', 'updated_time'])

            image_ids = []
            if task.image_ids:
                image_ids = list(task.image_ids)
            elif task.folder_ids:
                image_ids = list(
                    CassavaImage.objects.filter(folder_id__in=task.folder_ids).values_list('id', flat=True)
                )

            if not image_ids:
                task.status = 'failed'
                task.error = "没有待处理的图片"
                task.save()
                return {"error": "没有待处理的图片"}

            def stop_check():
                task.refresh_from_db(fields=['status'])
                return task.status == 'cancelled'

            def progress_callback(processed_count, total_count):
                progress = int((processed_count / total_count) * 100) if total_count else 0
                task.progress = progress
                task.save(update_fields=['progress', 'updated_time'])

            execution = PredictionService.run_predictions_for_images(
                image_ids=image_ids,
                params=params,
                owner=task.owner if getattr(task, 'owner_id', None) else None,
                processing_task=task,
                stop_check=stop_check,
                progress_callback=progress_callback
            )

            if execution.get('cancelled'):
                return {"cancelled": True, "processed": execution.get('processed_count', 0)}

            if not execution.get('results'):
                task.status = 'failed'
                task.error = '; '.join(
                    error.get('message', '预测失败') for error in execution.get('errors', [])[:3]
                ) or '预测失败'
                task.save()
                return {"error": task.error}

            task.status = 'completed'
            task.progress = 100
            # 部分图片失败时仍算完成，但把失败数量和原因写进 error，便于前端提示“部分成功”
            failure_count = len(execution.get('errors', []))
            if failure_count:
                preview = '；'.join(
                    str(error.get('message', '预测失败')) for error in execution.get('errors', [])[:3]
                )
                task.error = f"{failure_count} 张图片未生成结果：{preview}"
            else:
                task.error = None
            task.save()
            return {
                "success": True,
                "processed": execution.get('processed_count', 0),
                "result_count": len(execution.get('results', [])),
                "failed_count": failure_count,
                "errors": execution.get('errors', []),
            }
            
        except Exception as e:
            failure_text = describe_prediction_failure(e)
            try:
                task.status = 'failed'
                task.error = failure_text
                execution_meta = dict((task.parameters or {}).get('_execution') or {})
                execution_meta.update({
                    'error_code': e.__class__.__name__,
                    'error_detail': str(e)[:500],
                    'failed_at': timezone.now().isoformat(),
                })
                task.parameters = {**(task.parameters or {}), '_execution': execution_meta}
                task.save(update_fields=['status', 'error', 'parameters', 'updated_time'])
            except Exception:
                pass
            logger.error(f"任务执行失败: {e}", exc_info=True)
            return {"error": failure_text}


class FolderService(BaseService):
    """
    文件夹服务类，处理文件夹相关的业务逻辑
    """
    
    @staticmethod
    def get_user_folders(user):
        """
        获取用户的文件夹列表（包括自己拥有的和分享给自己的）
        """
        Folder = FolderService.get_model('Folder')
        if user and user.is_authenticated:
            # 使用ShareService获取可访问的资源过滤条件
            share_service = ShareService()
            q_filter = share_service.get_accessible_resources(user, 'folder')
            return Folder.objects.filter(q_filter).order_by('-created_at')
        return Folder.objects.none()
    
    @staticmethod
    def create_folder(user, name, description=""):
        """
        创建新文件夹
        
        Args:
            user: 用户对象
            name: 文件夹名称
            description: 描述
            
        Returns:
            Folder对象
        """
        Folder = FolderService.get_model('Folder')
        folder = Folder.objects.create(
            name=name,
            description=description,
            owner=user if user and user.is_authenticated else None
        )
        return folder
    
    @staticmethod
    def delete_folder(folder):
        """
        删除文件夹
        """
        from django.db import transaction
        CassavaImage = ImageService.get_model('CassavaImage')
        with transaction.atomic():
            CassavaImage.objects.filter(folder=folder).update(folder=None)
            folder.delete()
        return True
    
    @staticmethod
    def add_images_to_folder(folder, image_ids, user=None):
        """
        将图像添加到文件夹
        
        Args:
            folder: 文件夹实例
            image_ids: 图像ID列表
            user: 用户对象
            
        Returns:
            dict: 结果信息
        """
        from django.db import transaction
        
        CassavaImage = ImageService.get_model('CassavaImage')
        
        with transaction.atomic():
            updated_count = CassavaImage.objects.filter(
                id__in=image_ids
            ).update(folder=folder)
        return {
            "updated_count": updated_count
        }
    
    @staticmethod
    def remove_images_from_folder(folder, image_ids):
        """
        将图像从文件夹移除
        
        Args:
            folder: 文件夹实例
            image_ids: 图像ID列表
            
        Returns:
            dict: 结果信息
        """
        from django.db import transaction
        CassavaImage = ImageService.get_model('CassavaImage')
        with transaction.atomic():
            updated_count = CassavaImage.objects.filter(
                id__in=image_ids,
                folder=folder
            ).update(folder=None)
        return {
            "updated_count": updated_count
        }


class AuditService(BaseService):
    """
    审计日志服务类
    """
    @staticmethod
    def log_action(user, action, resource_type, resource_id, details=None, success=True, request=None):
        """
        记录操作日志
        """
        AuditLog = AuditService.get_model('AuditLog')
        
        ip_address = None
        if request:
            x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
            if x_forwarded_for:
                ip_address = x_forwarded_for.split(',')[0]
            else:
                ip_address = request.META.get('REMOTE_ADDR')
        
        try:
            AuditLog.objects.create(
                user=user if user and user.is_authenticated else None,
                username=user.username if user and user.is_authenticated else 'Anonymous',
                action=action,
                resource=resource_type,
                resource_id=str(resource_id) if resource_id else None,
                details=details,
                success=success,
                ip_address=ip_address
            )
        except Exception as e:
            logger.error(f"记录审计日志失败: {e}")


class ShareService(BaseService):
    """
    资源共享服务类
    """
    
    @staticmethod
    def share_resource(owner, resource_type, resource_id, shared_with_username, permission='view', expires_at=None):
        """
        分享资源
        """
        from django.contrib.auth.models import User
        from django.utils import timezone
        
        ResourceShare = ShareService.get_model('ResourceShare')
        
        # 1. 验证被分享用户是否存在
        try:
            shared_with = User.objects.get(username=shared_with_username)
        except User.DoesNotExist:
            return None, "目标用户不存在"
            
        if owner.id == shared_with.id:
            return None, "不能分享给自己"
            
        # 2. 验证资源是否存在且属于当前用户
        if resource_type == 'image':
            Model = ShareService.get_model('CassavaImage')
        elif resource_type == 'folder':
            Model = ShareService.get_model('Folder')
        else:
            return None, "不支持的资源类型"
            
        try:
            resource = Model.objects.get(id=resource_id)
            if (not getattr(owner, 'is_superuser', False)) and resource.owner != owner:
                return None, "您没有权限分享此资源"
        except Model.DoesNotExist:
            return None, "资源不存在"
            
        # 3. 创建或更新分享记录
        share, created = ResourceShare.objects.update_or_create(
            resource_type=resource_type,
            resource_id=resource_id,
            shared_with=shared_with,
            defaults={
                'shared_by': owner,
                'permission': permission,
                'expires_at': expires_at
            }
        )
        
        # 清除缓存
        from django.core.cache import cache
        cache_key = f"user_shared_ids:{shared_with.id}:{resource_type}"
        cache.delete(cache_key)
        
        # 记录审计日志
        AuditService.log_action(
            user=owner,
            action='SHARE_RESOURCE',
            resource_type=resource_type,
            resource_id=resource_id,
            details={
                'shared_with': shared_with.username,
                'permission': permission,
                'expires_at': str(expires_at) if expires_at else None
            }
        )
        
        return share, None

    @staticmethod
    def revoke_share(owner, share_id):
        """
        撤销分享
        """
        ResourceShare = ShareService.get_model('ResourceShare')
        try:
            share = ResourceShare.objects.get(id=share_id)
            # 只有资源所有者或分享者可以撤销
            if share.shared_by != owner:
                return False, "无权撤销此分享"
            
            # 清除缓存
            from django.core.cache import cache
            cache_key = f"user_shared_ids:{share.shared_with.id}:{share.resource_type}"
            cache.delete(cache_key)

            # 记录审计日志
            AuditService.log_action(
                user=owner,
                action='REVOKE_SHARE',
                resource_type=share.resource_type,
                resource_id=share.resource_id,
                details={
                    'shared_with': share.shared_with.username,
                    'permission': share.permission
                }
            )
            
            share.delete()
            return True, None
        except ResourceShare.DoesNotExist:
            return False, "分享记录不存在"

    @staticmethod
    def get_my_shares(user):
        """
        获取我分享出去的资源
        """
        ResourceShare = ShareService.get_model('ResourceShare')
        return ResourceShare.objects.filter(shared_by=user).order_by('-created_at')

    @staticmethod
    def get_shared_with_me(user):
        """
        获取分享给我的资源
        """
        ResourceShare = ShareService.get_model('ResourceShare')
        from django.utils import timezone
        from django.db.models import Q
        
        now = timezone.now()
        return ResourceShare.objects.filter(
            shared_with=user
        ).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=now)
        ).order_by('-created_at')

    @staticmethod
    def get_accessible_resources(user, resource_type):
        """
        获取用户有权访问的所有资源ID列表（包括自己的和分享给自己的）
        """
        from django.db.models import Q
        from django.utils import timezone
        from django.core.cache import cache
        
        # 尝试从缓存获取分享给该用户的资源ID列表
        cache_key = f"user_shared_ids:{user.id}:{resource_type}"
        shared_ids = cache.get(cache_key)
        
        if shared_ids is None:
            ResourceShare = ShareService.get_model('ResourceShare')
            now = timezone.now()
            
            # 1. 分享给我的资源ID
            shared_ids = list(ResourceShare.objects.filter(
                shared_with=user,
                resource_type=resource_type
            ).filter(
                Q(expires_at__isnull=True) | Q(expires_at__gt=now)
            ).values_list('resource_id', flat=True))
            
            # 缓存结果，有效期5分钟
            cache.set(cache_key, shared_ids, 300)
        
        # 2. 返回查询条件
        return Q(owner=user) | Q(id__in=shared_ids)

    @staticmethod
    def check_permission(user, resource_type, resource, required_permission):
        """
        检查用户对资源是否有指定权限
        
        Args:
            user: 用户对象
            resource_type: 资源类型 ('image' or 'folder')
            resource: 资源对象
            required_permission: 需要的权限 ('view', 'edit', 'manage')
            
        Returns:
            bool: 是否有权限
        """
        # 1. 如果是所有者，拥有所有权限
        if resource.owner == user:
            return True
            
        # 2. 如果是超级管理员，拥有所有权限
        if user.is_superuser:
            return True
            
        # 3. 检查分享权限
        ResourceShare = ShareService.get_model('ResourceShare')
        from django.utils import timezone
        from django.db.models import Q
        
        now = timezone.now()
        
        # 获取该用户对此资源的有效分享
        shares = ResourceShare.objects.filter(
            shared_with=user,
            resource_type=resource_type,
            resource_id=resource.id
        ).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=now)
        )
        
        if not shares.exists():
            return False
            
        # 检查权限级别
        # 权限级别：manage > edit > view
        permission_levels = {'view': 1, 'edit': 2, 'manage': 3}
        required_level = permission_levels.get(required_permission, 1)
        
        for share in shares:
            share_level = permission_levels.get(share.permission, 1)
            if share_level >= required_level:
                return True
                
        return False
