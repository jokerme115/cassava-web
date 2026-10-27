"""SegmentationService —— 批次6 从 services.py 拆出。"""

from .base import BaseService
import uuid

import logging

logger = logging.getLogger(__name__)

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
        from ..storage_utils import save_storage_bytes
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
