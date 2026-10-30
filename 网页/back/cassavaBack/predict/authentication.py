from rest_framework.authentication import TokenAuthentication
from rest_framework import exceptions
from django.utils import timezone
from django.conf import settings
from django.core.cache import cache
from .models import UserProfile, LoginSession

class ExpiringTokenAuthentication(TokenAuthentication):
    """
    支持超时的Token认证
    
    如果是Token认证请求，检查无操作时长。
    如果超过阈值，则使Token失效。
    """

    # 使用可多端并存的登录会话模型（DRF Token 的 user 是一对一，无法同时在线）
    model = LoginSession

    def authenticate_credentials(self, key):
        try:
            token = self.get_model().objects.select_related('user').get(key=key)
        except self.get_model().DoesNotExist:
            raise exceptions.AuthenticationFailed('无效的Token')

        if not token.user.is_active:
            raise exceptions.AuthenticationFailed('用户账号已禁用')

        # 检查超时
        # 默认30分钟 (1800秒)
        expire_seconds = getattr(settings, 'TOKEN_EXPIRE_SECONDS', 1800)
        
        # 获取最后活跃时间
        # 多端会话下按「本会话」计时：优先取本次登录会话的 last_seen，
        # 这样手机闲置超时只失效该会话，不会顺带把正在使用的电脑踢下线。
        last_activity = getattr(token, 'last_seen', None) or token.created

        # 检查是否过期
        now = timezone.now()
        if (now - last_activity).total_seconds() > expire_seconds:
            token.delete()
            raise exceptions.AuthenticationFailed('会话已超时，请重新登录')
            
        # 更新活跃时间
        # 使用Cache防抖，避免每次请求都写数据库
        user_id = token.user.id
        cache_key = f'last_seen_update_{user_id}_{token.key}'
        if not cache.get(cache_key):
            try:
                token.last_seen = now
                token.save(update_fields=['last_seen'])

                # 更新UserProfile
                if hasattr(token.user, 'profile'):
                    token.user.profile.last_activity = now
                    token.user.profile.save(update_fields=['last_activity'])
                
                # 设置缓存 (例如 1 分钟内不再更新DB)
                cache.set(cache_key, True, 60)
            except Exception:
                pass

        return (token.user, token)
