from rest_framework import viewsets, status, permissions
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.decorators import action
from rest_framework.response import Response
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from .models import Permission, Role, UserRole, UserPermission, AuditLog, GuestAccessibleResource, PermissionTemplate
from .serializers import (
    PermissionSerializer, RoleSerializer, UserRoleSerializer, 
    UserPermissionSerializer, UserSerializer, PermissionHierarchySerializer,
    UserDetailSerializer, RoleDetailSerializer, AuditLogSerializer, SimpleUserSerializer,
    GuestAccessibleResourceSerializer, PermissionTemplateSerializer
)
from .permissions import HasPermission, get_user_permissions, get_user_roles, get_permission_hierarchy, user_has_permission, user_has_role

class GuestResourceViewSet(viewsets.ModelViewSet):
    """访客资源白名单管理视图集"""
    queryset = GuestAccessibleResource.objects.all()
    serializer_class = GuestAccessibleResourceSerializer
    permission_classes = [HasPermission]
    required_permissions = ['view_guest_config'] # Assume this permission exists or will be created/mapped
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
        
        # Log audit
        AuditLog.objects.create(
            user=self.request.user,
            action='CREATE',
            resource='GuestAccessibleResource',
            details=f"Added {serializer.validated_data.get('resource_type')} {serializer.validated_data.get('resource_id')} to guest whitelist",
            success=True
        )

    def perform_destroy(self, instance):
        # Log audit
        AuditLog.objects.create(
            user=self.request.user,
            action='DELETE',
            resource='GuestAccessibleResource',
            resource_id=str(instance.id),
            details=f"Removed {instance.resource_type} {instance.resource_id} from guest whitelist",
            success=True
        )
        instance.delete()

    @action(detail=False, methods=['post'])
    def toggle_resource(self, request):
        """Toggle guest access for a resource"""
        resource_type = request.data.get('resource_type')
        resource_id = request.data.get('resource_id')
        enabled = request.data.get('enabled') # boolean
        
        if not resource_type or not resource_id:
             return Response({'error': 'Missing parameters'}, status=status.HTTP_400_BAD_REQUEST)
             
        if enabled:
            obj, created = GuestAccessibleResource.objects.get_or_create(
                resource_type=resource_type,
                resource_id=resource_id,
                defaults={'created_by': request.user}
            )
            if not obj.is_active:
                obj.is_active = True
                obj.save()
            
            if created:
                AuditLog.objects.create(
                    user=request.user,
                    action='CREATE',
                    resource='GuestAccessibleResource',
                    details=f"Added {resource_type} {resource_id} to guest whitelist",
                    success=True
                )
            return Response({'status': 'added'})
        else:
            GuestAccessibleResource.objects.filter(
                resource_type=resource_type, 
                resource_id=resource_id
            ).delete()
            
            AuditLog.objects.create(
                user=request.user,
                action='DELETE',
                resource='GuestAccessibleResource',
                details=f"Removed {resource_type} {resource_id} from guest whitelist",
                success=True
            )
            return Response({'status': 'removed'})

class PermissionViewSet(viewsets.ModelViewSet):
    """权限管理视图集"""
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    permission_classes = [HasPermission]
    perms_map = {
        'list': 'view_permission',
        'retrieve': 'view_permission',
        'create': 'add_permission',
        'update': 'change_permission',
        'partial_update': 'change_permission',
        'destroy': 'delete_permission',
        'categories': 'view_permission',
        'hierarchy': 'view_permission'
    }

    @action(detail=False, methods=['get'])
    def categories(self, request):
        """获取权限类别列表"""
        categories = Permission.objects.values_list('category', flat=True).distinct()
        return Response(list(categories))

    @action(detail=False, methods=['get'])
    def hierarchy(self, request):
        """获取权限层级结构"""
        hierarchy = get_permission_hierarchy()
        serializer = PermissionHierarchySerializer(hierarchy)
        return Response(serializer.data)

class RoleViewSet(viewsets.ModelViewSet):
    """角色管理视图集"""
    queryset = Role.objects.all().order_by('id')
    serializer_class = RoleSerializer
    permission_classes = [HasPermission]
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ['name', 'description']
    ordering_fields = ['id', 'name']
    perms_map = {
        'list': 'view_role',
        'retrieve': 'view_role',
        'create': 'add_role',
        'update': 'change_role',
        'partial_update': 'change_role',
        'destroy': 'delete_role',
        'assign_permissions': 'assign_role_permissions',
        'remove_permissions': 'assign_role_permissions',
        'users': 'view_role'
    }

    @action(detail=True, methods=['post'])
    def assign_permissions(self, request, pk=None):
        """为角色分配权限"""
        role = self.get_object()
        permission_ids = request.data.get('permission_ids', [])
        
        if not isinstance(permission_ids, list):
            return Response({'error': 'permission_ids 必须是列表'}, status=status.HTTP_400_BAD_REQUEST)
        
        permissions = Permission.objects.filter(id__in=permission_ids)
        role.permissions.set(permissions)
        
        return Response({'message': '权限分配成功'})

    @action(detail=True, methods=['post'])
    def remove_permissions(self, request, pk=None):
        """从角色移除权限"""
        role = self.get_object()
        permission_ids = request.data.get('permission_ids', [])
        
        if not isinstance(permission_ids, list):
            return Response({'error': 'permission_ids 必须是列表'}, status=status.HTTP_400_BAD_REQUEST)
        
        permissions = Permission.objects.filter(id__in=permission_ids)
        role.permissions.remove(*permissions)
        
        return Response({'message': '权限移除成功'})

    @action(detail=True, methods=['get'])
    def users(self, request, pk=None):
        """获取拥有该角色的用户列表"""
        role = self.get_object()
        user_roles = UserRole.objects.filter(role=role).select_related('user')
        users = [user_role.user for user_role in user_roles]
        serializer = UserSerializer(users, many=True)
        return Response(serializer.data)

class UserRoleViewSet(viewsets.ModelViewSet):
    """用户角色关联管理视图集"""
    queryset = UserRole.objects.all()
    serializer_class = UserRoleSerializer
    permission_classes = [HasPermission]
    perms_map = {
        'list': 'view_userrole',
        'retrieve': 'view_userrole',
        'create': 'assign_user_roles', # Usually managed via custom actions, but standard create also implies assignment
        'update': 'assign_user_roles',
        'partial_update': 'assign_user_roles',
        'destroy': 'assign_user_roles',
        'assign_role': 'assign_user_roles',
        'remove_role': 'assign_user_roles'
    }

    @action(detail=False, methods=['post'])
    def assign_role(self, request):
        """为用户分配角色"""
        user_id = request.data.get('user_id')
        role_id = request.data.get('role_id')
        
        if not user_id or not role_id:
            return Response({'error': 'user_id 和 role_id 不能为空'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            user = User.objects.get(id=user_id)
            role = Role.objects.get(id=role_id)
            
            UserRole.objects.get_or_create(user=user, role=role)
            return Response({'message': '角色分配成功'})
        except (User.DoesNotExist, Role.DoesNotExist):
            return Response({'error': '用户或角色不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['post'])
    def remove_role(self, request):
        """移除用户的角色"""
        user_id = request.data.get('user_id')
        role_id = request.data.get('role_id')
        
        if not user_id or not role_id:
            return Response({'error': 'user_id 和 role_id 不能为空'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            user = User.objects.get(id=user_id)
            role = Role.objects.get(id=role_id)
            
            UserRole.objects.filter(user=user, role=role).delete()
            return Response({'message': '角色移除成功'})
        except (User.DoesNotExist, Role.DoesNotExist):
            return Response({'error': '用户或角色不存在'}, status=status.HTTP_404_NOT_FOUND)


class UserPermissionViewSet(viewsets.ModelViewSet):
    """用户权限管理视图集"""
    queryset = UserPermission.objects.all()
    serializer_class = UserPermissionSerializer
    permission_classes = [HasPermission]
    perms_map = {
        'list': 'view_userpermission',
        'retrieve': 'view_userpermission',
        'create': 'change_permission', # Assigning permission to user
        'update': 'change_permission',
        'partial_update': 'change_permission',
        'destroy': 'change_permission',
        'user_permissions': None, # Authenticated user can see their own
        'user_roles': None, # Authenticated user can see their own
        'retrieve_user_permissions': 'view_userpermission',
        'update_permissions': 'change_permission', # Batch update
        'grant_permission': 'change_permission',
        'revoke_permission': 'change_permission'
    }

    @action(detail=False, methods=['get'])
    def user_permissions(self, request):
        """获取当前用户的权限列表"""
        if not request.user.is_authenticated:
            return Response({'error': '用户未登录'}, status=status.HTTP_401_UNAUTHORIZED)
        
        permissions = get_user_permissions(request.user)
        return Response({'permissions': permissions})

    @action(detail=False, methods=['get'])
    def user_roles(self, request):
        """获取当前用户的角色列表"""
        if not request.user.is_authenticated:
            return Response({'error': '用户未登录'}, status=status.HTTP_401_UNAUTHORIZED)
        
        roles = get_user_roles(request.user)
        serializer = RoleSerializer(roles, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='get_permissions')
    def retrieve_user_permissions(self, request):
        """获取指定用户的权限列表（管理员用）"""
        user_id = request.query_params.get('user_id')
        if not user_id:
            return Response({'error': 'user_id 不能为空'}, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            user = User.objects.get(id=user_id)
            permissions = get_user_permissions(user) # 返回的是 code list
            
            # 获取用户直接关联的权限对象
            direct_permissions = UserPermission.objects.filter(user=user, action='grant')
            direct_permission_ids = list(direct_permissions.values_list('permission_id', flat=True))
            
            return Response({
                'all_permissions': permissions, # list of codenames
                'direct_permission_ids': direct_permission_ids # list of ids
            })
        except User.DoesNotExist:
            return Response({'error': '用户不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['post'])
    def update_permissions(self, request):
        """批量更新用户的权限"""
        user_id = request.data.get('user_id')
        permission_ids = request.data.get('permission_ids', []) # List of permission IDs
        
        if not user_id:
            return Response({'error': 'user_id 不能为空'}, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            user = User.objects.get(id=user_id)
            # 更新 user.user_permissions
            # 记录审计日志
            
            permission_ids = [int(pid) for pid in permission_ids]
            old_permissions = list(
                UserPermission.objects.filter(user=user, action='grant').values_list('permission_id', flat=True)
            )
            UserPermission.objects.filter(user=user).exclude(permission_id__in=permission_ids).delete()
            existing_permission_ids = set(
                UserPermission.objects.filter(user=user, action='grant').values_list('permission_id', flat=True)
            )
            for permission_id in permission_ids:
                if permission_id not in existing_permission_ids:
                    UserPermission.objects.create(user=user, permission_id=permission_id, action='grant')
            
            AuditLog.objects.create(
                user=request.user,
                action='UPDATE',
                resource='UserPermission',
                details=f"Updated permissions for user {user.username}. Old: {old_permissions}, New: {permission_ids}",
                success=True
            )
            
            return Response({'message': '权限更新成功'})
        except User.DoesNotExist:
            return Response({'error': '用户不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['post'])
    def grant_permission(self, request):
        """为用户授予权限"""
        user_id = request.data.get('user_id')
        permission_id = request.data.get('permission_id')
        
        if not user_id or not permission_id:
            return Response({'error': 'user_id 和 permission_id 不能为空'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            user = User.objects.get(id=user_id)
            permission = Permission.objects.get(id=permission_id)
            
            UserPermission.objects.update_or_create(
                user=user,
                permission=permission,
                defaults={'action': 'grant'}
            )
            return Response({'message': '权限授予成功'})
        except (User.DoesNotExist, Permission.DoesNotExist):
            return Response({'error': '用户或权限不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['post'])
    def revoke_permission(self, request):
        """撤销用户的权限"""
        user_id = request.data.get('user_id')
        permission_id = request.data.get('permission_id')
        
        if not user_id or not permission_id:
            return Response({'error': 'user_id 和 permission_id 不能为空'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            user = User.objects.get(id=user_id)
            permission = Permission.objects.get(id=permission_id)
            
            UserPermission.objects.update_or_create(
                user=user,
                permission=permission,
                defaults={'action': 'revoke'}
            )
            return Response({'message': '权限撤销成功'})
        except (User.DoesNotExist, Permission.DoesNotExist):
            return Response({'error': '用户或权限不存在'}, status=status.HTTP_404_NOT_FOUND)


class UserManagementViewSet(viewsets.ModelViewSet):
    """用户管理视图集"""
    queryset = User.objects.all().order_by('-date_joined')
    serializer_class = UserSerializer
    permission_classes = [HasPermission]
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ['username', 'email', 'first_name', 'last_name']
    ordering_fields = ['date_joined', 'last_login', 'username', 'is_active']
    perms_map = {
        'list': 'view_user',
        'retrieve': 'view_user',
        'create': 'add_user',
        'update': 'change_user',
        'partial_update': 'change_user',
        'destroy': 'delete_user',
        'detail': 'view_user',
        'assign_role': 'assign_user_roles',
        'remove_role': 'assign_user_roles',
        'roles': 'view_userrole',
        'permissions': None, # Current user
        'has_permission': None, # Current user
        'has_role': None, # Current user
        'guest_stats': 'view_user',
        'search_share_users': None # Handled by get_permissions
    }

    def get_permissions(self):
        """
        根据不同的action返回不同的权限
        """
        if self.action == 'search_share_users':
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    @action(detail=False, methods=['get'])
    def guest_stats(self, request):
        """获取访客统计信息"""
        from .models import GuestUsage
        from django.utils import timezone
        
        today = timezone.now().date()
        
        # 今日访客数
        today_guests = GuestUsage.objects.filter(date=today).count()
        
        # 总访客数 (去重)
        total_guests = GuestUsage.objects.values('guest_token').distinct().count()
        
        return Response({
            'today_count': today_guests,
            'total_count': total_guests
        })

    @action(detail=False, methods=['get'])
    def search_share_users(self, request):
        """
        搜索用户用于分享（仅返回基本信息，无需特殊权限）
        """
        query = request.query_params.get('q', '')
        if not query:
            return Response([])
        
        users = User.objects.filter(username__icontains=query) | User.objects.filter(email__icontains=query)
        # Limit results
        users = users[:20]
        
        serializer = SimpleUserSerializer(users, many=True)
        return Response(serializer.data)

    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Filtering
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            is_active_bool = is_active.lower() == 'true'
            queryset = queryset.filter(is_active=is_active_bool)
            
        role_id = self.request.query_params.get('role_id')
        if role_id:
            # Filter users who have this role
            queryset = queryset.filter(user_roles__role_id=role_id)
            
        is_staff = self.request.query_params.get('is_staff')
        if is_staff is not None:
            is_staff_bool = is_staff.lower() == 'true'
            queryset = queryset.filter(is_staff=is_staff_bool)
            
        return queryset

    def perform_create(self, serializer):
        user = serializer.save()
        AuditLog.objects.create(
            user=self.request.user,
            action='CREATE',
            resource='User',
            resource_id=str(user.id),
            details=f"Created user {user.username}",
            success=True
        )

    def perform_update(self, serializer):
        user = serializer.save()
        AuditLog.objects.create(
            user=self.request.user,
            action='UPDATE',
            resource='User',
            resource_id=str(user.id),
            details=f"Updated user {user.username}",
            success=True
        )

    def destroy(self, request, *args, **kwargs):
        """删除用户"""
        # 权限检查已由 HasPermission 处理 (destroy -> delete_user)
        user = self.get_object()
        if user.is_superuser:
            return Response(
                {'error': '不能删除超级用户'}, 
                status=status.HTTP_403_FORBIDDEN
            )
            
        # Log audit
        AuditLog.objects.create(
            user=request.user,
            action='DELETE',
            resource='User',
            resource_id=str(user.id),
            details=f"Deleted user {user.username}",
            success=True
        )
        
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['get'])
    def detail(self, request, pk=None):
        """获取用户详细信息"""
        try:
            user = self.get_object()
            serializer = UserDetailSerializer(user)
            return Response(serializer.data)
        except User.DoesNotExist:
            return Response({'error': '用户不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['post'])
    def assign_role(self, request, pk=None):
        """为用户分配角色"""
        role_id = request.data.get('role_id')
        if not role_id:
            return Response({'error': 'role_id不能为空'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            user = self.get_object()
            role = Role.objects.get(id=role_id)
            UserRole.objects.get_or_create(user=user, role=role)
            return Response({'message': '角色分配成功'})
        except (User.DoesNotExist, Role.DoesNotExist):
            return Response({'error': '用户或角色不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['post'])
    def remove_role(self, request, pk=None):
        """移除用户的角色"""
        role_id = request.data.get('role_id')
        if not role_id:
            return Response({'error': 'role_id不能为空'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            user = self.get_object()
            role = Role.objects.get(id=role_id)
            UserRole.objects.filter(user=user, role=role).delete()
            
            # Log audit
            AuditLog.objects.create(
                user=request.user,
                action='REMOVE_ROLE',
                resource='UserRole',
                resource_id=str(user.id),
                details=f"Removed role {role.name} from {user.username}",
                success=True
            )
            
            return Response({'message': '角色移除成功'})
        except (User.DoesNotExist, Role.DoesNotExist):
            return Response({'error': '用户或角色不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['get'])
    def roles(self, request, pk=None):
        """获取用户的角色列表"""
        try:
            user = self.get_object()
            roles = Role.objects.filter(user_roles__user=user, is_active=True).distinct()
            serializer = RoleSerializer(roles, many=True)
            return Response(serializer.data)
        except User.DoesNotExist:
            return Response({'error': '用户不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['get'])
    def permissions(self, request):
        """获取当前用户的所有权限"""
        if not request.user.is_authenticated:
            return Response({'error': '用户未登录'}, status=status.HTTP_401_UNAUTHORIZED)
        
        permissions = get_user_permissions(request.user)
        return Response({'permissions': permissions})

    @action(detail=False, methods=['get'])
    def has_permission(self, request):
        """检查当前用户是否具有特定权限"""
        if not request.user.is_authenticated:
            return Response({'error': '用户未登录'}, status=status.HTTP_401_UNAUTHORIZED)
        
        permission_code = request.query_params.get('permission_code')
        if not permission_code:
            return Response(
                {'error': 'permission_code参数不能为空'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        has_perm = user_has_permission(request.user, permission_code)
        return Response({'has_permission': has_perm})

    @action(detail=False, methods=['get'])
    def has_role(self, request):
        """检查当前用户是否具有特定角色"""
        if not request.user.is_authenticated:
            return Response({'error': '用户未登录'}, status=status.HTTP_401_UNAUTHORIZED)
        
        role_name = request.query_params.get('role_name')
        if not role_name:
            return Response(
                {'error': 'role_name参数不能为空'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        has_role = user_has_role(request.user, role_name)
        return Response({'has_role': has_role})

class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """审计日志视图集"""
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    permission_classes = [HasPermission]
    required_permissions = ['view_audit_log']
    
    def get_queryset(self):
        """支持过滤"""
        queryset = super().get_queryset()
        action = self.request.query_params.get('action')
        resource_type = self.request.query_params.get('resourceType')
        resource_id = self.request.query_params.get('resourceId')
        success = self.request.query_params.get('success')
        
        if action:
            queryset = queryset.filter(action=action)
        if resource_type:
            queryset = queryset.filter(resource__icontains=resource_type)
        if resource_id:
            queryset = queryset.filter(resource_id=resource_id)
        if success is not None:
            is_success = success.lower() == 'true'
            queryset = queryset.filter(success=is_success)
            
        return queryset


class PermissionTemplateViewSet(viewsets.ModelViewSet):
    """权限模板管理视图集"""
    queryset = PermissionTemplate.objects.all()
    serializer_class = PermissionTemplateSerializer
    permission_classes = [HasPermission]
    required_permissions = ['view_permission'] # 复用查看权限的权限

    def perform_create(self, serializer):
        template = serializer.save()
        AuditLog.objects.create(
            user=self.request.user,
            action='CREATE',
            resource='PermissionTemplate',
            details=f"Created permission template: {template.name}",
            success=True
        )

    def perform_update(self, serializer):
        template = serializer.save()
        AuditLog.objects.create(
            user=self.request.user,
            action='UPDATE',
            resource='PermissionTemplate',
            details=f"Updated permission template: {template.name}",
            success=True
        )

    def perform_destroy(self, instance):
        AuditLog.objects.create(
            user=self.request.user,
            action='DELETE',
            resource='PermissionTemplate',
            details=f"Deleted permission template: {instance.name}",
            success=True
        )
        instance.delete()

