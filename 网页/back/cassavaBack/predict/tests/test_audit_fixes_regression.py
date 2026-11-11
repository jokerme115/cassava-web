import json
from unittest.mock import Mock
from django.test import TestCase
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status
from predict.models import ResourceShare, CassavaImage, ProcessingTask, LoginSession, UserProfile
from predict.policies import SharedResourcePolicy
from predict.services.task import TaskService


class AuditFixesRegressionTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user_a = User.objects.create_user(username='user_a', password='Password123!', email='a@example.com')
        self.user_b = User.objects.create_user(username='user_b', password='Password123!', email='b@example.com')
        self.user_c = User.objects.create_user(username='user_c', password='Password123!', email='c@example.com')
        self.admin = User.objects.create_superuser(username='admin_user', password='Password123!', email='admin@example.com')

        UserProfile.objects.get_or_create(user=self.user_a, defaults={'preferences': {'editorTheme': 'dark'}})
        UserProfile.objects.get_or_create(user=self.user_b, defaults={'preferences': {'editorTheme': 'light'}})
        UserProfile.objects.get_or_create(user=self.user_c, defaults={'preferences': {'editorTheme': 'light'}})
        UserProfile.objects.get_or_create(user=self.admin, defaults={'preferences': {'editorTheme': 'dark'}})

        self.img_a = CassavaImage.objects.create(name='test_a.jpg', owner=self.user_a, size=1024)
        self.img_b = CassavaImage.objects.create(name='test_b.jpg', owner=self.user_b, size=2048)

    def test_sec_01_share_queryset_isolation(self):
        """SEC-01: 普通用户只能查看自己分享或被分享的记录，不能查看他人之间的共享"""
        share_ab = ResourceShare.objects.create(
            resource_type='image',
            resource_id=str(self.img_a.id),
            shared_by=self.user_a,
            shared_with=self.user_b,
            permission='view'
        )
        share_bc = ResourceShare.objects.create(
            resource_type='image',
            resource_id=str(self.img_b.id),
            shared_by=self.user_b,
            shared_with=self.user_c,
            permission='view'
        )

        # user_a should only see share_ab
        self.client.force_authenticate(user=self.user_a)
        res = self.client.get('/api/shares/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        items = res.data.get('results', res.data) if isinstance(res.data, dict) else res.data
        if isinstance(items, dict) and 'items' in items:
            items = items['items']
        ids = [item['id'] for item in items]
        self.assertIn(share_ab.id, ids)
        self.assertNotIn(share_bc.id, ids)

        # admin sees all shares
        self.client.force_authenticate(user=self.admin)
        res_admin = self.client.get('/api/shares/')
        self.assertEqual(res_admin.status_code, status.HTTP_200_OK)
        items_admin = res_admin.data.get('results', res_admin.data) if isinstance(res_admin.data, dict) else res_admin.data
        if isinstance(items_admin, dict) and 'items' in items_admin:
            items_admin = items_admin['items']
        ids_admin = [item['id'] for item in items_admin]
        self.assertIn(share_ab.id, ids_admin)
        self.assertIn(share_bc.id, ids_admin)

    def test_sec_01_share_create_and_revoke_and_update(self):
        """SEC-01: 创建共享需验证资源归属；撤销仅所有者/管理员可执行；禁止直接 update"""
        # User C tries to share User A's image -> should be forbidden/rejected
        self.client.force_authenticate(user=self.user_c)
        res = self.client.post('/api/shares/', {
            'resource_type': 'image',
            'resource_id': str(self.img_a.id),
            'shared_with': self.user_b.id,
            'permission': 'view'
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # User A shares User A's image -> success
        self.client.force_authenticate(user=self.user_a)
        res_ok = self.client.post('/api/shares/', {
            'resource_type': 'image',
            'resource_id': str(self.img_a.id),
            'shared_with_username': self.user_b.username,
            'permission': 'view'
        })
        self.assertEqual(res_ok.status_code, status.HTTP_201_CREATED)
        share_id = res_ok.data['data']['id'] if 'data' in res_ok.data else res_ok.data['id']

        # Disallow PUT/PATCH
        res_put = self.client.put(f'/api/shares/{share_id}/', {'permission': 'manage'})
        self.assertEqual(res_put.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        res_patch = self.client.patch(f'/api/shares/{share_id}/', {'permission': 'manage'})
        self.assertEqual(res_patch.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

        # User C cannot delete User A's share
        self.client.force_authenticate(user=self.user_c)
        res_del = self.client.delete(f'/api/shares/{share_id}/')
        self.assertEqual(res_del.status_code, status.HTTP_400_BAD_REQUEST)

        # User A can delete
        self.client.force_authenticate(user=self.user_a)
        res_del_ok = self.client.delete(f'/api/shares/{share_id}/')
        self.assertEqual(res_del_ok.status_code, status.HTTP_200_OK)
        self.assertFalse(ResourceShare.objects.filter(id=share_id).exists())

    def test_sec_02_and_set_01_login_and_logout(self):
        """SEC-02 & SET-01: 登录返回完整 user profile/preferences；登出吊销 Authorization Bearer Token"""
        profile = self.user_a.profile
        profile.preferences = {'editorTheme': 'dark', 'brushSize': 25}
        profile.save()

        # Login
        res_login = self.client.post('/api/auth/login/', {
            'username': 'user_a',
            'password': 'Password123!'
        })
        self.assertEqual(res_login.status_code, status.HTTP_200_OK)
        user_data = res_login.data.get('user', {})
        self.assertEqual(user_data.get('username'), 'user_a')
        # Check SET-01: profile and preferences are returned
        self.assertIn('profile', user_data)
        self.assertEqual(user_data['profile']['preferences']['brushSize'], 25)

        token_key = res_login.data.get('token')
        self.assertTrue(LoginSession.objects.filter(key=token_key).exists())

        # Logout with Authorization: Bearer <token_key>
        res_logout = self.client.post(
            '/api/auth/logout/',
            HTTP_AUTHORIZATION=f'Bearer {token_key}'
        )
        self.assertEqual(res_logout.status_code, status.HTTP_200_OK)
        # Check SEC-02: token is deleted
        self.assertFalse(LoginSession.objects.filter(key=token_key).exists())

        # Subsequent authenticated request should fail with 401
        res_auth_test = self.client.get(
            '/api/auth/user/',
            HTTP_AUTHORIZATION=f'Bearer {token_key}'
        )
        self.assertEqual(res_auth_test.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_sec_03_permanent_share_policy(self):
        """SEC-03: expires_at 为 None 的永久共享对象能够通过 SharedResourcePolicy 校验"""
        ResourceShare.objects.create(
            resource_type='image',
            resource_id=str(self.img_a.id),
            shared_by=self.user_a,
            shared_with=self.user_b,
            permission='edit',
            expires_at=None
        )
        policy = SharedResourcePolicy()
        req_b = Mock(user=self.user_b, method='GET')
        req_c = Mock(user=self.user_c, method='GET')

        # user_b should be allowed
        self.assertTrue(policy.check(req_b, None, self.img_a))
        # user_c should be disallowed
        self.assertFalse(policy.check(req_c, None, self.img_a))

    def test_task_01_cancelled_task_not_overwritten(self):
        """TASK-01: 任务在取消后，不会被异步执行结果覆盖为 completed 或 failed"""
        task = ProcessingTask.objects.create(
            name='test_cancel_task',
            type='prediction',
            status='cancelled',
            owner=self.user_a,
            parameters={'image_ids': [self.img_a.id]}
        )
        res = TaskService.execute_prediction_task(task.id)
        self.assertTrue(res.get('cancelled'))
        task.refresh_from_db()
        self.assertEqual(task.status, 'cancelled')
