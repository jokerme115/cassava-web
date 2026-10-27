from abc import ABC, abstractmethod
from django.utils import timezone
from .models import ResourceShare, SystemSetting

class BasePolicy(ABC):
    """
    Abstract base class for permission policies.
    """
    @abstractmethod
    def check(self, request, view, obj=None) -> bool:
        pass

class OwnershipPolicy(BasePolicy):
    """
    Checks if the user is the owner of the object.
    """
    def check(self, request, view, obj=None) -> bool:
        if obj is None:
            return True # Skip if no object
        
        # Check standard 'owner' field
        if hasattr(obj, 'owner'):
            return obj.owner == request.user
            
        return False

class SharedResourcePolicy(BasePolicy):
    """
    Checks if the object has been shared with the user.
    """
    def check(self, request, view, obj=None) -> bool:
        if obj is None:
            return True
            
        if not request.user.is_authenticated:
            return False

        # Map model class to resource type string
        model_name = obj.__class__.__name__
        resource_type_map = {
            'CassavaImage': 'image',
            'Folder': 'folder'
        }
        
        resource_type = resource_type_map.get(model_name)
        if not resource_type:
            return False
            
        # Check ResourceShare table
        # Determine required permission level based on method
        required_level = 'view'
        if request.method in ['PUT', 'PATCH']:
            required_level = 'edit'
        elif request.method in ['DELETE']:
            required_level = 'manage'
            
        # Level hierarchy: manage > edit > view
        valid_levels = ['manage']
        if required_level == 'edit':
            valid_levels.append('edit')
        if required_level == 'view':
            valid_levels.extend(['edit', 'view'])
            
        return ResourceShare.objects.filter(
            shared_with=request.user,
            resource_type=resource_type,
            resource_id=obj.id,
            permission__in=valid_levels,
            expires_at__gt=timezone.now()
        ).exists()

class GuestPolicy(BasePolicy):
    """
    Handles guest access limitations.
    """
    def check(self, request, view, obj=None) -> bool:
        # If user is authenticated, skip guest checks
        if request.user.is_authenticated:
            return True

        from .permissions import is_miniapp_request
        is_miniapp = is_miniapp_request(request)
            
        # Check global switch
        setting = SystemSetting.get_solo()
        if not is_miniapp and not setting.enable_guest_access:
            return False
            
        allow_guest = getattr(view, 'allow_guest', False)
        if not allow_guest:
            return False
            
        # Method check
        from rest_framework import permissions
        if request.method not in permissions.SAFE_METHODS:
            # The miniapp token is scoped to explicitly declared actions. It is
            # never a general-purpose RBAC bypass for model viewsets.
            action = getattr(view, 'action', None)
            miniapp_actions = set(getattr(view, 'miniapp_actions', ()))
            if is_miniapp and action in miniapp_actions:
                return True

            # Exception for guest prediction task creation.
            if view.__class__.__name__ == 'ProcessingTaskViewSet' and request.method == 'POST':
                task_type = request.data.get('type')
                if task_type == 'prediction':
                    return True
            return False
            
        # Object level check for guests (WhiteList)
        if obj:
            # Check GuestAccessibleResource
            from .models import GuestAccessibleResource
            model_name = obj.__class__.__name__
            resource_type_map = {'CassavaImage': 'image', 'Folder': 'folder'}
            r_type = resource_type_map.get(model_name)
            resource_id = getattr(obj, 'id', None)

            if model_name == 'SegmentationResult':
                r_type = 'image'
                resource_id = getattr(obj, 'original_image_id', None)
            elif model_name == 'PredictionResult':
                r_type = 'image'
                resource_id = getattr(obj, 'original_image_id', None)
                if not resource_id:
                    segmentation = getattr(obj, 'segmentation', None)
                    resource_id = getattr(segmentation, 'original_image_id', None)
            
            if r_type:
                return GuestAccessibleResource.objects.filter(
                    resource_type=r_type,
                    resource_id=resource_id,
                    is_active=True
                ).exists()
                
        return True

class RBACPolicy(BasePolicy):
    """
    Standard Role-Based Access Control.
    """
    def check(self, request, view, obj=None) -> bool:
        if not request.user.is_authenticated:
            return False
            
        from .permissions import user_has_permission
        
        # Dynamic Action Mapping
        perms_map = getattr(view, 'perms_map', {})
        action = getattr(view, 'action', None)
        method = request.method.lower()
        
        required_perm = None
        if action and action in perms_map:
            required_perm = perms_map[action]
        elif method in perms_map:
            required_perm = perms_map[method]
            
        if required_perm:
            return user_has_permission(request.user, required_perm)
            
        # Static View Permissions
        required_permissions = getattr(view, 'required_permissions', [])
        if required_permissions:
            return any(user_has_permission(request.user, p) for p in required_permissions)
            
        permission_codename = getattr(view, 'permission_codename', None)
        if permission_codename:
            return user_has_permission(request.user, permission_codename)
            
        return True

class PermissionEngine:
    """
    Central engine to evaluate all policies.
    """
    def __init__(self):
        self.policies = [
            GuestPolicy(),
            RBACPolicy(), # Checks if user has 'permission' to do action
            # Ownership and Sharing are usually "OR" conditions combined with RBAC "AND"
            # Logic: (RBAC_Allow) AND (Owner OR Shared OR Global_Access)
            # But wait, usually RBAC says "Can View Images". 
            # Then Object check says "Which images?".
            # For has_object_permission, we need to pass if ANY of the object policies pass.
        ]
        self.object_policies = [
            OwnershipPolicy(),
            SharedResourcePolicy()
        ]

    def check_permission(self, request, view):
        # 1. Guest Check (Fail fast)
        if not request.user.is_authenticated:
            return GuestPolicy().check(request, view)

        # 2. Superuser
        if request.user.is_superuser:
            return True

        # 3. RBAC Check
        return RBACPolicy().check(request, view)

    def check_object_permission(self, request, view, obj):
        # 1. Basic permission check must pass first
        if not self.check_permission(request, view):
            return False
            
        if request.user.is_superuser:
            return True

        # 2. If guest, GuestPolicy handles object check too
        if not request.user.is_authenticated:
            return GuestPolicy().check(request, view, obj)

        # 3. For authenticated users, check ownership OR sharing
        # If RBAC allowed it, we still need to ensure they have access to THIS specific object.
        # Unless the RBAC permission implies "All Objects" (e.g. View All Images), but our system seems to imply ownership.
        
        # Check if user has "Global View" permission? 
        # Assuming current system defaults to "Own Data" isolation.
        
        for policy in self.object_policies:
            if policy.check(request, view, obj):
                return True
                
        return False
