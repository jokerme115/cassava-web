"""BaseService —— 批次6 从 services.py 拆出。"""

import logging

logger = logging.getLogger(__name__)

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
