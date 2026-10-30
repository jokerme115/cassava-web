"""
权限装饰器模块

提供用于视图函数和类的权限检查装饰器
"""

from functools import wraps
from django.core.exceptions import PermissionDenied
from django.contrib.auth.decorators import login_required
from rest_framework.response import Response
from rest_framework import status
from .permissions import user_has_permission


def permission_required(codename):
    """
    权限检查装饰器
    
    Args:
        codename (str): 权限代码
        
    Returns:
        function: 装饰器函数
    """
    def decorator(view_func):
        @wraps(view_func)
        def wrapped_view(request, *args, **kwargs):
            # 检查用户是否已认证
            if not request.user.is_authenticated:
                return Response(
                    {'error': '用户未认证'}, 
                    status=status.HTTP_401_UNAUTHORIZED
                )
            
            # 检查用户是否具有指定权限
            if not user_has_permission(request.user, codename):
                return Response(
                    {'error': '权限不足'}, 
                    status=status.HTTP_403_FORBIDDEN
                )
            
            # 调用原始视图函数
            return view_func(request, *args, **kwargs)
        return wrapped_view
    return decorator


def class_permission_required(codename):
    """
    类视图权限检查装饰器
    
    Args:
        codename (str): 权限代码
        
    Returns:
        function: 装饰器函数
    """
    def decorator(view_class):
        # 为类视图的所有方法添加权限检查
        for method_name in ['get', 'post', 'put', 'patch', 'delete']:
            if hasattr(view_class, method_name):
                method = getattr(view_class, method_name)
                setattr(view_class, method_name, permission_required(codename)(method))
        return view_class
    return decorator