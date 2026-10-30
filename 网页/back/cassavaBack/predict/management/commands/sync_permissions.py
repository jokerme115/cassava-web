from django.core.management.base import BaseCommand
from django.db import transaction
from predict.models import Permission, Role
from predict.config.permission_definitions import PERMISSIONS, ROLES

class Command(BaseCommand):
    help = 'Sync permissions and roles from configuration to database'

    def handle(self, *args, **options):
        self.stdout.write('Starting permission sync...')
        
        try:
            with transaction.atomic():
                # 1. Sync Permissions
                self.sync_permissions()
                
                # 2. Sync Roles
                self.sync_roles()
                
            self.stdout.write(self.style.SUCCESS('Successfully synced permissions and roles'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'Error syncing permissions: {str(e)}'))
            import traceback
            traceback.print_exc()

    def sync_permissions(self):
        self.stdout.write('Syncing permissions...')
        current_codenames = set()
        
        for codename, data in PERMISSIONS.items():
            permission, created = Permission.objects.update_or_create(
                codename=codename,
                defaults={
                    'name': data['name'],
                    'category': data['category'],
                    'description': data['description']
                }
            )
            current_codenames.add(codename)
            if created:
                self.stdout.write(f'Created permission: {codename}')
            else:
                self.stdout.write(f'Updated permission: {codename}')
                
        # Optional: Remove obsolete permissions?
        # For safety, we might not want to auto-delete, but let's log them
        all_perms = Permission.objects.values_list('codename', flat=True)
        obsolete = set(all_perms) - current_codenames
        if obsolete:
            self.stdout.write(self.style.WARNING(f'Found obsolete permissions in DB: {obsolete}'))

    def sync_roles(self):
        self.stdout.write('Syncing roles...')
        
        for role_name, data in ROLES.items():
            role, created = Role.objects.get_or_create(
                name=role_name,
                defaults={'description': data['description']}
            )
            
            # Update description if changed
            if not created and role.description != data['description']:
                role.description = data['description']
                role.save()
            
            # Update permissions
            perms = Permission.objects.filter(codename__in=data['permissions'])
            role.permissions.set(perms)
            
            if created:
                self.stdout.write(f'Created role: {role_name}')
            else:
                self.stdout.write(f'Updated role: {role_name}')
