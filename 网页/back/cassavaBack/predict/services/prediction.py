"""PredictionService —— 批次6 从 services.py 拆出。"""

from ..deeplab_service import deeplabv3plus_service
from ..model_registry import LABELS
from ..ensemble import METHOD
from ..m6_predictor import m6_best_predictor
from ..mask_utils import calculate_mask_metrics
from ..mask_utils import confidence_to_png_bytes
from ..mask_utils import mask_to_png_bytes
from .base import BaseService
from .segmentation import SegmentationService
from PIL import Image
from PIL import ImageOps
from django.conf import settings
from io import BytesIO
from pathlib import Path
import cv2
import numpy as np
import os
import shutil
import tempfile
import uuid

import logging

logger = logging.getLogger(__name__)

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
        from ..storage_utils import save_storage_bytes
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

        model_name = str(advanced.get('single_model_type') or advanced.get('modelType') or 'pbt_c512')
        use_ensemble = model_name == 'ensemble' or read_bool(
            advanced.get('use_ensemble'), advanced.get('predictionMode') == 'ensemble')
        if use_ensemble:
            model_name = 'ensemble'
        parsed = {
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

        from ..model_registry import MODERN_KEYS
        if model_name in MODERN_KEYS:
            parsed.update(confidence=.5, min_area=0, morph_kernel_size=0, morph_iterations=0,
                use_post_processing=False, use_tta=False, stage1_confidence=.5, stage2_confidence=.5)
        return parsed

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
        from ..storage_utils import save_storage_bytes
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
        from ..storage_utils import save_storage_bytes
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
        from ..oss_service import check_oss_configured, get_file_from_oss

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
        from ..storage_utils import save_storage_bytes

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
            is_ensemble=prediction_params.get('use_ensemble', False) or prediction_params.get('single_model_type', '').startswith('pbt_'),
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

                    from ..model_registry import MODERN_KEYS
                    if prediction_params['single_model_type'] in MODERN_KEYS:
                        from ..modern_predictor import run_pipeline
                        prediction_result = run_pipeline(local_image_path, work_dir, prediction_params['single_model_type'], stop_check)
                    else:
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
