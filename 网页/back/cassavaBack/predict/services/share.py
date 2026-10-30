"""ShareService —— 批次6 从 services.py 拆出。"""

from .audit import AuditService
from .base import BaseService
from django.utils import timezone

import logging

logger = logging.getLogger(__name__)

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
