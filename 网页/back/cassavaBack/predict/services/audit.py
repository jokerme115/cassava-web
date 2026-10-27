"""AuditService —— 批次6 从 services.py 拆出。"""

from .base import BaseService

import logging

logger = logging.getLogger(__name__)

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
