"""FolderService —— 批次6 从 services.py 拆出。"""

from .base import BaseService
from .image import ImageService
from .share import ShareService

import logging

logger = logging.getLogger(__name__)

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
