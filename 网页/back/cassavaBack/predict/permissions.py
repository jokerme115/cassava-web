"""
权限管理模块

提供基于角色和自定义权限的访问控制机制
"""

from django.apps import apps
from django.utils import timezone
from django.db import IntegrityError
from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, APIException
import hashlib
import secrets
import logging
from django.conf import settings

logger = logging.getLogger(__name__)

def is_miniapp_request(request):
    expected = getattr(settings, 'MINIAPP_ACCESS_TOKEN', '') or ''
    if not expected:
        return False
    token = request.headers.get('X-Miniapp-Token')
    if not token:
        return False
    return secrets.compare_digest(token, expected)

def get_guest_token(request):
    """
    获取或生成访客标识
    1. 尝试从Cookie获取
    2. 兼容从 Header 获取（前端跨域时 cookie 可能不可用）
    2. 如果没有Cookie，生成基于IP+UA+时间戳的哈希
    """
    token = request.COOKIES.get('guest_token')
    if token:
        return token

    header_token = request.headers.get('X-Guest-Token')
    if header_token and isinstance(header_token, str):
        header_token = header_token.strip()
        if 1 <= len(header_token) <= 64:
            return header_token
    
    # 生成新Token
    ip = request.META.get('REMOTE_ADDR', 'unknown')
    ua = request.META.get('HTTP_USER_AGENT', 'unknown')
    # 使用当前时间戳作为Salt，确保每次生成都不同（如果想要基于指纹则不加时间戳）
    # 用户要求：基于IP+UserAgent+时间戳哈希
    timestamp = str(timezone.now().timestamp())
    raw_str = f"{ip}|{ua}|{timestamp}"
    return hashlib.md5(raw_str.encode()).hexdigest()

def get_permission_model():
    return apps.get_model('predict', 'Permission')

def get_role_model():
    return apps.get_model('predict', 'Role')

def get_user_role_model():
    return apps.get_model('predict', 'UserRole')

def get_user_permission_model():
    return apps.get_model('predict', 'UserPermission')


class HasPermission(permissions.BasePermission):
    """
    自定义权限类，检查用户是否具有特定权限
    支持访客访问控制
    集成 PermissionEngine 进行多策略检查
    """
    
    def has_permission(self, request, view):
        from .policies import PermissionEngine
        
        try:
            engine = PermissionEngine()
            return engine.check_permission(request, view)
        except Exception as e:
            # Circuit Breaker / Fail Safe
            # Log error and decide policy. 
            # For security, usually Fail Closed (deny access).
            logger.error(f"Permission Check Failed: {str(e)}", exc_info=True)
            # In production, we might want to alert admin
            return False

    def has_object_permission(self, request, view, obj):
        from .policies import PermissionEngine
        
        try:
            engine = PermissionEngine()
            return engine.check_object_permission(request, view, obj)
        except Exception as e:
            logger.error(f"Object Permission Check Failed: {str(e)}", exc_info=True)
            return False
            
    # Legacy methods for compatibility if called directly
    def check_guest_permission(self, request, view):
        from .policies import GuestPolicy
        return GuestPolicy().check(request, view)


class IsRootUser(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)


def user_has_permission(user, permission_codename):
    """
    检查用户是否具有特定权限
    
    Args:
        user: Django User对象
        permission_codename: 权限代码
        
    Returns:
        bool: 用户是否具有该权限
    """
    # 如果用户未认证，直接返回False
    if not user.is_authenticated:
        return False
        
    # 利用缓存获取用户权限列表
    user_perms = get_user_permissions(user)
    return permission_codename in user_perms


def user_has_permissions(user, permission_codenames, operator='and'):
    """
    检查用户是否具有多个权限
    
    Args:
        user: Django User对象
        permission_codenames: 权限代码列表
        operator: 'and' 表示需要全部权限，'or' 表示只需要一个权限
        
    Returns:
        bool: 用户是否具有指定权限
    """
    if operator == 'and':
        return all(user_has_permission(user, codename) for codename in permission_codenames)
    elif operator == 'or':
        return any(user_has_permission(user, codename) for codename in permission_codenames)
    else:
        raise ValueError("operator参数必须是'and'或'or'")


from django.core.cache import cache

def _get_user_cache_key(user):
    return f"user_perms_{user.id}"

def _clear_user_permission_cache(user):
    if user:
        cache.delete(_get_user_cache_key(user))

def get_user_permissions(user):
    """
    获取用户的所有权限代码列表
    
    Args:
        user: Django User对象
        
    Returns:
        list: 权限代码列表
    """
    if user.is_superuser:
        Permission = get_permission_model()
        return list(Permission.objects.values_list('codename', flat=True))

    cache_key = _get_user_cache_key(user)
    cached_perms = cache.get(cache_key)
    if cached_perms is not None:
        return cached_perms

    Permission = get_permission_model()
    UserRole = get_user_role_model()
    UserPermission = get_user_permission_model()
    
    # 获取用户的角色权限
    user_roles = UserRole.objects.filter(user=user, role__is_active=True).select_related('role')
    role_ids = [user_role.role.id for user_role in user_roles]
    
    role_permissions = []
    if role_ids:
        role_permissions = list(Permission.objects.filter(
            roles__id__in=role_ids
        ).values_list('codename', flat=True).distinct())

    # 获取用户的自定义权限
    custom_permissions = UserPermission.objects.filter(user=user).select_related('permission')
    
    # 处理自定义权限：添加被明确授予的权限，移除被明确撤销的权限
    granted_permissions = []
    revoked_permissions = []
    
    for custom_perm in custom_permissions:
        if custom_perm.action == 'grant':
            granted_permissions.append(custom_perm.permission.codename)
        elif custom_perm.action == 'revoke':
            revoked_permissions.append(custom_perm.permission.codename)
    
    # 合并角色权限和自定义权限
    all_permissions = set(role_permissions + granted_permissions)
    
    # 移除被撤销的权限
    final_permissions = list(all_permissions - set(revoked_permissions))
    
    # Cache for 1 hour
    cache.set(cache_key, final_permissions, 3600)

    return final_permissions

# 已在上方定义了完整的user_has_permission函数，此处删除重复定义

def get_user_roles(user):
    """
    获取用户的所有角色
    
    Args:
        user: Django User对象
        
    Returns:
        list: 角色对象列表
    """
    if not user.is_authenticated:
        return []
        
    UserRole = get_user_role_model()
    user_roles = UserRole.objects.filter(user=user, role__is_active=True).select_related('role')
    return [user_role.role for user_role in user_roles]

def user_has_role(user, role_name):
    """
    检查用户是否具有特定角色
    
    Args:
        user: Django User对象
        role_name: 角色名称
        
    Returns:
        bool: 用户是否具有该角色
    """
    if not user.is_authenticated:
        return False
        
    if user.is_superuser:
        return True
        
    UserRole = get_user_role_model()
    role_exists = UserRole.objects.filter(
        user=user, 
        role__name=role_name, 
        role__is_active=True
    ).exists()
    return role_exists

def get_permission_hierarchy():
    """
    获取权限层级结构，按类别分组
    
    Returns:
        dict: 按类别分组的权限字典
    """
    Permission = get_permission_model()
    permissions = Permission.objects.all().order_by('category', 'name')
    
    hierarchy = {}
    for permission in permissions:
        if permission.category not in hierarchy:
            hierarchy[permission.category] = []
        hierarchy[permission.category].append(permission)
    
    return hierarchy


def assign_role_to_user(user, role):
    """
    为用户分配角色
    
    Args:
        user: Django User对象
        role: Role对象或角色名称
        
    Returns:
        UserRole: 创建的用户角色关联对象
    """
    Role = get_role_model()
    UserRole = get_user_role_model()
    
    if isinstance(role, str):
        role = Role.objects.get(name=role)
    
    user_role, created = UserRole.objects.get_or_create(user=user, role=role)
    
    _clear_user_permission_cache(user)
    
    return user_role


def remove_role_from_user(user, role):
    """
    移除用户的角色
    
    Args:
        user: Django User对象
        role: Role对象或角色名称
    """
    Role = get_role_model()
    UserRole = get_user_role_model()
    
    if isinstance(role, str):
        role = Role.objects.get(name=role)
    
    UserRole.objects.filter(user=user, role=role).delete()
    _clear_user_permission_cache(user)


def grant_permission_to_user(user, permission):
    """
    为用户授予特定权限
    
    Args:
        user: Django User对象
        permission: Permission对象或权限代码
        
    Returns:
        UserPermission: 创建的用户权限对象
    """
    Permission = get_permission_model()
    UserPermission = get_user_permission_model()
    
    if isinstance(permission, str):
        permission = Permission.objects.get(codename=permission)
    
    user_permission, created = UserPermission.objects.get_or_create(
        user=user, 
        permission=permission,
        defaults={'action': 'grant'}
    )
    
    if not created and user_permission.action != 'grant':
        user_permission.action = 'grant'
        user_permission.save()
    
    _clear_user_permission_cache(user)
    
    return user_permission


def revoke_permission_from_user(user, permission):
    """
    撤销用户的特定权限
    
    Args:
        user: Django User对象
        permission: Permission对象或权限代码
        
    Returns:
        UserPermission: 创建的用户权限对象
    """
    Permission = get_permission_model()
    UserPermission = get_user_permission_model()
    
    if isinstance(permission, str):
        permission = Permission.objects.get(codename=permission)
    
    user_permission, created = UserPermission.objects.get_or_create(
        user=user, 
        permission=permission,
        defaults={'action': 'revoke'}
    )
    
    if not created and user_permission.action != 'revoke':
        user_permission.action = 'revoke'
        user_permission.save()
    
    _clear_user_permission_cache(user)
    
    return user_permission


def create_role_with_permissions(role_name, permission_codenames, description=""):
    """
    创建角色并分配权限
    
    Args:
        role_name: 角色名称
        permission_codenames: 权限代码列表
        description: 角色描述
        
    Returns:
        Role: 创建的角色对象
    """
    Role = get_role_model()
    Permission = get_permission_model()
    
    role, created = Role.objects.get_or_create(
        name=role_name,
        defaults={'description': description}
    )
    
    if not created:
        # 如果角色已存在，清除现有权限
        role.permissions.clear()
    
    # 添加权限
    permissions = Permission.objects.filter(codename__in=permission_codenames)
    role.permissions.set(permissions)
    
    return role


def initialize_default_permissions():
    """
    初始化系统默认权限
    DEPRECATED: Use 'python manage.py sync_permissions' instead.
    Kept for backward compatibility.
    """
    try:
        from .management.commands.sync_permissions import Command
        cmd = Command()
        # Mock stdout/stderr to avoid print spam if needed, or just let it print
        # Simple wrapper
        cmd.handle()
    except Exception as e:
        logger.exception("初始化默认权限失败: %s", e)
        import traceback
        traceback.print_exc()
