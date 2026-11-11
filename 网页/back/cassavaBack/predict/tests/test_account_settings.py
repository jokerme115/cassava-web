from django.contrib.auth.models import User
from rest_framework.test import APITestCase
from predict.models import Permission, Role, UserRole, UserPermission, AuditLog
from predict.permissions import get_user_permissions


class AccountSettingsTests(APITestCase):
    def setUp(self):
        self.root = User.objects.create_superuser('settings-root', password='strong-test-pass')
        self.member = User.objects.create_user('settings-member', password='strong-test-pass')
        self.read = Permission.objects.create(name='查看图片', codename='view_image')
        self.upload = Permission.objects.create(name='上传图片', codename='upload_image')
        self.role = Role.objects.create(name='实验员')
        self.role.permissions.set([self.read])
        UserRole.objects.create(user=self.member, role=self.role)
        self.client.force_authenticate(self.root)

    def test_role_detail_returns_actual_selection_and_member_count(self):
        reply = self.client.get(f'/api/permissions/roles/{self.role.pk}/')
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(reply.data['permission_ids'], [self.read.pk])
        self.assertEqual(reply.data['user_count'], 1)

    def test_role_update_replaces_complete_selection_and_applies_immediately(self):
        self.assertIn('view_image', get_user_permissions(self.member))
        reply = self.client.patch(f'/api/permissions/roles/{self.role.pk}/', {'name': '实验员', 'permission_ids': [self.upload.pk]}, format='json')
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(get_user_permissions(self.member), ['upload_image'])
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get('/api/images/').status_code, 403)

    def test_invalid_permission_does_not_partially_rename_role(self):
        reply = self.client.patch(f'/api/permissions/roles/{self.role.pk}/', {'name': '错误更名', 'permission_ids': [999999]}, format='json')
        self.assertEqual(reply.status_code, 400)
        self.role.refresh_from_db()
        self.assertEqual(self.role.name, '实验员')

    def test_disable_role_removes_access_immediately(self):
        get_user_permissions(self.member)
        self.client.patch(f'/api/permissions/roles/{self.role.pk}/', {'is_active': False}, format='json')
        self.assertEqual(get_user_permissions(self.member), [])

    def test_role_with_members_cannot_be_deleted(self):
        self.assertEqual(self.client.delete(f'/api/permissions/roles/{self.role.pk}/').status_code, 400)
        self.assertTrue(UserRole.objects.filter(user=self.member, role=self.role).exists())

    def test_user_role_assignment_returns_names_and_updates_members(self):
        second = Role.objects.create(name='复检员')
        reply = self.client.patch(f'/api/permissions/users/{self.member.pk}/', {'role_ids': [second.pk]}, format='json')
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(reply.data['role_names'], ['复检员'])
        self.assertEqual(self.client.get(f'/api/permissions/roles/{second.pk}/').data['user_count'], 1)
        self.assertEqual(self.client.get(f'/api/permissions/roles/{self.role.pk}/').data['user_count'], 0)

    def test_bad_role_id_does_not_save_other_user_fields(self):
        reply = self.client.patch(f'/api/permissions/users/{self.member.pk}/', {'email': 'bad@example.test', 'role_ids': [999999]}, format='json')
        self.assertEqual(reply.status_code, 400)
        self.member.refresh_from_db()
        self.assertEqual(self.member.email, '')

    def test_permission_search_and_actual_binding(self):
        Permission.objects.create(name='未接入', codename='unused_custom_code')
        data = self.client.get('/api/permissions/permissions/?search=upload_image').data
        self.assertEqual(data['count'], 1)
        self.assertTrue(data['results'][0]['is_bound'])
        data = self.client.get('/api/permissions/permissions/?search=unused_custom_code').data
        self.assertFalse(data['results'][0]['is_bound'])

    def test_explicit_deny_overrides_role_and_inherit_restores_it(self):
        endpoint = '/api/permissions/user-permissions/update_permissions/'
        reply = self.client.post(endpoint, {'user_id': self.member.pk, 'permission_ids': [self.upload.pk], 'revoked_permission_ids': [self.read.pk]}, format='json')
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(get_user_permissions(self.member), ['upload_image'])
        reply = self.client.get(f'/api/permissions/user-permissions/get_permissions/?user_id={self.member.pk}')
        self.assertEqual(reply.data['revoked_permission_ids'], [self.read.pk])
        self.client.post(endpoint, {'user_id': self.member.pk, 'permission_ids': [], 'revoked_permission_ids': []}, format='json')
        self.assertEqual(get_user_permissions(self.member), ['view_image'])

    def test_bad_overrides_leave_existing_authorization_untouched(self):
        UserPermission.objects.create(user=self.member, permission=self.upload, action='grant')
        reply = self.client.post('/api/permissions/user-permissions/update_permissions/', {'user_id': self.member.pk, 'permission_ids': [999999]}, format='json')
        self.assertEqual(reply.status_code, 400)
        self.assertTrue(UserPermission.objects.filter(user=self.member, permission=self.upload, action='grant').exists())

    def test_delegated_manager_can_edit_object_without_owner_field(self):
        for code in ['change_role', 'assign_role_permissions']:
            self.role.permissions.add(Permission.objects.create(name=code, codename=code))
        self.client.force_authenticate(self.member)
        second = Role.objects.create(name='待编辑')
        reply = self.client.patch(f'/api/permissions/roles/{second.pk}/', {'description': '可编辑', 'permission_ids': [self.read.pk]}, format='json')
        self.assertEqual(reply.status_code, 200)

    def test_role_edit_permission_does_not_imply_permission_assignment(self):
        self.role.permissions.add(Permission.objects.create(name='编辑角色', codename='change_role'))
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.patch(f'/api/permissions/roles/{self.role.pk}/', {'permission_ids': [self.upload.pk]}, format='json').status_code, 400)

    def test_normal_user_cannot_use_management_endpoints(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get('/api/permissions/users/').status_code, 403)
        self.assertEqual(self.client.patch(f'/api/permissions/roles/{self.role.pk}/', {'name': '越权'}, format='json').status_code, 403)

    def test_user_manager_cannot_escalate_to_superuser(self):
        self.role.permissions.add(Permission.objects.create(name='编辑用户', codename='change_user'))
        self.client.force_authenticate(self.member)
        reply = self.client.patch(f'/api/permissions/users/{self.member.pk}/', {'is_superuser': True}, format='json')
        self.assertEqual(reply.status_code, 400)

    def test_preferences_persist_and_are_isolated(self):
        self.client.force_authenticate(self.member)
        reply = self.client.post('/api/auth/profile/update/', {'preferences': {'editorTheme': 'dark', 'brushSize': 31}}, format='json')
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(self.client.get('/api/auth/user/').data['profile']['preferences']['brushSize'], 31)
        self.assertEqual(self.root.profile.preferences, {})

    def test_invalid_preferences_do_not_partially_save_profile(self):
        self.client.force_authenticate(self.member)
        reply = self.client.post('/api/auth/profile/update/', {'email': 'changed@example.test', 'preferences': {'brushSize': 999}}, format='json')
        self.assertEqual(reply.status_code, 400)
        self.member.refresh_from_db()
        self.assertEqual(self.member.email, '')

    def test_cannot_disable_own_root_account(self):
        self.assertEqual(self.client.patch(f'/api/permissions/users/{self.root.pk}/', {'is_active': False}, format='json').status_code, 400)

    def test_management_pagination_honors_requested_page_size(self):
        Permission.objects.bulk_create([Permission(name=f'p{i}', codename=f'catalog_{i}') for i in range(30)])
        data = self.client.get('/api/permissions/permissions/?page_size=24').data
        self.assertEqual(len(data['results']), 24)
        self.assertEqual(data['count'], 32)
        self.assertEqual(len(self.client.get('/api/permissions/permissions/?page_size=24&page=2').data['results']), 8)

    def test_create_user_with_roles_and_duplicate_username_error(self):
        payload = {'username': 'new-scientist', 'password': 'Safe-Research-2026!', 'role_ids': [self.role.pk]}
        reply = self.client.post('/api/permissions/users/', payload, format='json')
        self.assertEqual(reply.status_code, 201)
        self.assertEqual(reply.data['roles'], [self.role.pk])
        self.assertNotIn('password', reply.data)
        self.assertEqual(self.client.post('/api/permissions/users/', payload, format='json').status_code, 400)

    def test_audit_filter_and_pagination(self):
        AuditLog.objects.bulk_create([AuditLog(user=self.root, action='UPDATE', resource='Role', resource_id=str(i), details='test', success=True) for i in range(30)])
        AuditLog.objects.create(user=self.root, action='CREATE', resource='User', success=True)
        reply = self.client.get('/api/permissions/audit-logs/?action=UPDATE&resourceType=Role&page_size=24&page=2')
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(reply.data['count'], 30)
        self.assertEqual(len(reply.data['results']), 6)
