from datetime import timedelta

from django.contrib.auth.models import User
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from predict.models import LoginSession

LOGIN_URL = '/api/auth/login/'
LOGOUT_URL = '/api/auth/logout/'


class MultiSessionLoginTests(APITestCase):
    """多端登录：同一账号可同时保持多个会话，互不踢下线。"""

    def setUp(self):
        self.user = User.objects.create_user(username='sess_user', password='sess-pass-123')

    def login(self):
        response = self.client.post(
            LOGIN_URL,
            {'username': 'sess_user', 'password': 'sess-pass-123'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.data['token']

    def auth(self, token):
        return {'HTTP_AUTHORIZATION': f'Token {token}'}

    def test_two_logins_keep_both_sessions_valid(self):
        first = self.login()
        second = self.login()
        self.assertNotEqual(first, second)
        self.assertEqual(LoginSession.objects.filter(user=self.user).count(), 2)
        # 两个令牌都能通过认证（登出接口要求已认证）
        for token in (first, second):
            response = self.client.post(LOGOUT_URL, **self.auth(token))
            self.assertEqual(response.status_code, 200, response.data)

    def test_logout_only_revokes_current_session(self):
        first = self.login()
        second = self.login()
        self.client.post(LOGOUT_URL, **self.auth(first))
        self.assertFalse(LoginSession.objects.filter(key=first).exists())
        self.assertTrue(LoginSession.objects.filter(key=second).exists())
        # 仍保留的会话可继续访问
        response = self.client.get('/api/images/', **self.auth(second))
        self.assertIn(response.status_code, (200, 403))

    @override_settings(MAX_SESSIONS_PER_USER=3)
    def test_oldest_sessions_pruned_beyond_limit(self):
        tokens = [self.login() for _ in range(5)]
        remaining = set(LoginSession.objects.filter(user=self.user).values_list('key', flat=True))
        self.assertEqual(len(remaining), 3)
        # 保留的是最近 3 次登录
        self.assertEqual(remaining, set(tokens[-3:]))

    def test_login_returns_same_shape_as_before(self):
        response = self.client.post(
            LOGIN_URL,
            {'username': 'sess_user', 'password': 'sess-pass-123'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['success'])
        self.assertEqual(len(response.data['token']), 40)
        self.assertEqual(response.data['user']['username'], 'sess_user')

    def test_new_login_does_not_inherit_old_profile_timeout(self):
        from predict.models import UserProfile
        profile, _ = UserProfile.objects.get_or_create(user=self.user)
        profile.last_activity = timezone.now() - timedelta(days=1)
        profile.save(update_fields=['last_activity'])
        token = self.login()
        response = self.client.post(LOGOUT_URL, **self.auth(token))
        self.assertEqual(response.status_code, 200, response.data)

    @override_settings(TOKEN_EXPIRE_SECONDS=1800)
    def test_idle_session_expires_without_killing_other_devices(self):
        idle = self.login()
        active = self.login()
        LoginSession.objects.filter(key=idle).update(
            last_seen=timezone.now() - timedelta(seconds=1801)
        )
        expired = self.client.post(LOGOUT_URL, **self.auth(idle))
        self.assertEqual(expired.status_code, 401)
        self.assertFalse(LoginSession.objects.filter(key=idle).exists())

        still_ok = self.client.get('/api/images/', **self.auth(active))
        self.assertIn(still_ok.status_code, (200, 403))
