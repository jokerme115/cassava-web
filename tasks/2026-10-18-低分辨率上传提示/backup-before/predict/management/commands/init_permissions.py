from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from predict.models import Permission, Role, UserRole
from predict import views, permission_views
from rest_framework import viewsets
import inspect

class Command(BaseCommand):
    help = 'Auto-discover permissions from ViewSets and initialize system roles'

    def handle(self, *args, **options):
        self.stdout.write('Starting permission auto-discovery...')
        
        discovered_permissions = set()
        
        # 1. Scan ViewSets
        view_modules = [views, permission_views]
        
        for module in view_modules:
            for name, obj in inspect.getmembers(module):
                if inspect.isclass(obj) and issubclass(obj, viewsets.GenericViewSet) and obj.__module__ == module.__name__:
                    self.stdout.write(f'Scanning {name}...')
                    
                    # Check perms_map
                    perms_map = getattr(obj, 'perms_map', {})
                    for action, perm_code in perms_map.items():
                        if perm_code:
                            discovered_permissions.add(perm_code)
                            
                    # Check permission_codename (legacy/simple)
                    perm_code = getattr(obj, 'permission_codename', None)
                    if perm_code:
                        discovered_permissions.add(perm_code)
                        
                    # Check required_permissions
                    req_perms = getattr(obj, 'required_permissions', [])
                    for p in req_perms:
                        discovered_permissions.add(p)

        # 2. Create Permissions
        self.stdout.write(f'Found {len(discovered_permissions)} unique permission codes.')
        
        # Define categories and human-readable names for known permissions
        # This acts as a knowledge base to enrich the auto-discovered permissions
        permission_meta = {
            # Image
            'view_image': {'name': 'View Image', 'category': 'Image Management', 'desc': 'View images'},
            'upload_image': {'name': 'Upload Image', 'category': 'Image Management', 'desc': 'Upload new images'},
            'delete_image': {'name': 'Delete Image', 'category': 'Image Management', 'desc': 'Delete images'},
            'edit_image': {'name': 'Edit Image', 'category': 'Image Management', 'desc': 'Edit image details'},
            
            # Folder
            'view_folder': {'name': 'View Folder', 'category': 'Folder Management', 'desc': 'View folders'},
            'create_folder': {'name': 'Create Folder', 'category': 'Folder Management', 'desc': 'Create new folders'},
            'delete_folder': {'name': 'Delete Folder', 'category': 'Folder Management', 'desc': 'Delete folders'},
            'edit_folder': {'name': 'Edit Folder', 'category': 'Folder Management', 'desc': 'Edit folder details'},
            
            # Task
            'view_task': {'name': 'View Task', 'category': 'Task Management', 'desc': 'View processing tasks'},
            'create_task': {'name': 'Create Task', 'category': 'Task Management', 'desc': 'Create new tasks'},
            'cancel_task': {'name': 'Cancel Task', 'category': 'Task Management', 'desc': 'Cancel running tasks'},
            'delete_task': {'name': 'Delete Task', 'category': 'Task Management', 'desc': 'Delete tasks'},
            
            # Prediction
            'view_prediction': {'name': 'View Prediction', 'category': 'Prediction', 'desc': 'View prediction results'},
            'delete_prediction': {'name': 'Delete Prediction', 'category': 'Prediction', 'desc': 'Delete prediction results'},
            'create_prediction': {'name': 'Create Prediction', 'category': 'Prediction', 'desc': 'Run new predictions'},
            'export_prediction': {'name': 'Export Prediction', 'category': 'Prediction', 'desc': 'Export results'},
            
            # Segmentation
            'view_segmentation': {'name': 'View Segmentation', 'category': 'Prediction', 'desc': 'View segmentation results'},
            'delete_segmentation': {'name': 'Delete Segmentation', 'category': 'Prediction', 'desc': 'Delete segmentation results'},
            
            # Tag
            'view_tag': {'name': 'View Tag', 'category': 'Image Management', 'desc': 'View tags'},
            'create_tag': {'name': 'Create Tag', 'category': 'Image Management', 'desc': 'Create new tags'},
            'delete_tag': {'name': 'Delete Tag', 'category': 'Image Management', 'desc': 'Delete tags'},
            
            # User & Role & Permission (System)
            'view_user': {'name': 'View User', 'category': 'System Management', 'desc': 'View system users'},
            'add_user': {'name': 'Add User', 'category': 'System Management', 'desc': 'Create new users'},
            'change_user': {'name': 'Edit User', 'category': 'System Management', 'desc': 'Edit user details'},
            'delete_user': {'name': 'Delete User', 'category': 'System Management', 'desc': 'Delete users'},
            
            'view_role': {'name': 'View Role', 'category': 'System Management', 'desc': 'View roles'},
            'add_role': {'name': 'Add Role', 'category': 'System Management', 'desc': 'Create new roles'},
            'change_role': {'name': 'Edit Role', 'category': 'System Management', 'desc': 'Edit role details'},
            'delete_role': {'name': 'Delete Role', 'category': 'System Management', 'desc': 'Delete roles'},
            'assign_role_permissions': {'name': 'Assign Role Permissions', 'category': 'System Management', 'desc': 'Manage role permissions'},
            
            'view_permission': {'name': 'View Permission', 'category': 'System Management', 'desc': 'View system permissions'},
            'add_permission': {'name': 'Add Permission', 'category': 'System Management', 'desc': 'Add new custom permissions'},
            'change_permission': {'name': 'Edit Permission', 'category': 'System Management', 'desc': 'Edit permissions'},
            'delete_permission': {'name': 'Delete Permission', 'category': 'System Management', 'desc': 'Delete permissions'},
            
            'view_userrole': {'name': 'View User Roles', 'category': 'System Management', 'desc': 'View user role assignments'},
            'assign_user_roles': {'name': 'Assign User Roles', 'category': 'System Management', 'desc': 'Assign roles to users'},
            
            'view_userpermission': {'name': 'View User Permissions', 'category': 'System Management', 'desc': 'View user specific permissions'},
            'view_audit_log': {'name': 'View Audit Logs', 'category': 'System Management', 'desc': 'View system audit logs'},
        }
        
        created_count = 0
        updated_count = 0
        
        for codename in discovered_permissions:
            meta = permission_meta.get(codename, {
                'name': codename.replace('_', ' ').title(), 
                'category': 'Other', 
                'desc': f'Permission to {codename}'
            })
            
            perm, created = Permission.objects.update_or_create(
                codename=codename,
                defaults={
                    'name': meta['name'],
                    'category': meta['category'],
                    'description': meta['desc']
                }
            )
            if created:
                created_count += 1
            else:
                updated_count += 1
                
        self.stdout.write(self.style.SUCCESS(f'Permissions: {created_count} created, {updated_count} updated.'))

        # 3. Initialize Default Roles
        self.init_roles()
        
    def init_roles(self):
        self.stdout.write('Initializing default roles...')
        
        # Admin
        admin_role, _ = Role.objects.get_or_create(
            name='Administrator',
            defaults={'description': 'System Administrator with full access (except user creation restricted)'}
        )
        # Give all permissions except maybe some restricted ones if needed
        # For now, give all discovered permissions
        all_perms = Permission.objects.all()
        admin_role.permissions.set(all_perms)
        
        # User
        user_role, _ = Role.objects.get_or_create(
            name='User',
            defaults={'description': 'Standard User with view and upload access'}
        )
        user_perms = Permission.objects.filter(codename__in=[
            'view_image', 'upload_image', 'view_folder', 'view_task', 
            'view_prediction', 'view_tag', 'view_segmentation', 'create_task'
        ])
        user_role.permissions.set(user_perms)
        
        # Viewer (Guest-like but authenticated)
        viewer_role, _ = Role.objects.get_or_create(
            name='Viewer',
            defaults={'description': 'Read-only access'}
        )
        viewer_perms = Permission.objects.filter(codename__startswith='view_')
        viewer_role.permissions.set(viewer_perms)
        
        self.stdout.write(self.style.SUCCESS('Roles initialized.'))
        
        # 4. Assign 'User' role to users without roles
        users = User.objects.filter(is_superuser=False)
        count = 0
        for user in users:
            if not user.user_roles.exists():
                UserRole.objects.create(user=user, role=user_role)
                count += 1
        
        if count > 0:
            self.stdout.write(self.style.SUCCESS(f'Assigned "User" role to {count} users.'))
