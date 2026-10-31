"""
认证视图模块
"""

from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth import login, logout
from django.contrib.auth.models import User
from django.conf import settings
from django.utils import timezone
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.db import transaction
import logging
from datetime import timedelta
import secrets
import string
from django.middleware.csrf import get_token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework import status
from .serializers import UserSerializer, UserProfileSerializer
from .models import UserProfile, AuditLog, EmailVerificationCode, Role, UserRole, LoginSession


logger = logging.getLogger(__name__)


@api_view(['GET'])
@permission_classes([AllowAny])
def csrf_token(request):
    """
    获取CSRF Token
    """
    token = get_token(request)
    return Response({'csrftoken': token})


@api_view(['POST'])
@permission_classes([AllowAny])
def user_login(request):
    """
    用户登录API - 使用DRF APIView处理
    """
    username = request.data.get('username') or request.data.get('email')
    password = request.data.get('password')
    remember_me = request.data.get('remember_me', False)
    if not isinstance(remember_me, bool):
        return Response({'error': '记住我必须为布尔值'}, status=status.HTTP_400_BAD_REQUEST)
    
    if not username or not password:
        return Response({
            'error': '用户名和密码不能为空'
        }, status=status.HTTP_400_BAD_REQUEST)

    # Throttling Check
    from django.core.cache import cache
    ip = _get_client_ip(request)
    throttle_key = f"login_failed_{ip}_{username}"
    failed_attempts = cache.get(throttle_key, 0)
    logger.info("login_attempt ip=%s failed_attempts=%s", ip, failed_attempts)
    
    if failed_attempts >= 5:
        return Response({
            'error': '登录失败次数过多，请10分钟后再试'
        }, status=status.HTTP_429_TOO_MANY_REQUESTS)
    
    try:
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            user = User.objects.get(email=username)
        if user.check_password(password):
            # 停用账号不得登录（此前只校验密码，停用用户仍能拿到 token）
            if not user.is_active:
                logger.info("login_blocked_inactive user=%s ip=%s", user.username, ip)
                return Response({
                    'error': '账号已停用，请联系管理员',
                    'code': 'account_disabled'
                }, status=status.HTTP_403_FORBIDDEN)

            # Clear throttle on success
            cache.delete(throttle_key)
            
            # 登录用户
            login(request, user)
            remember_seconds = int(getattr(settings, 'REMEMBER_ME_SECONDS', 30 * 24 * 3600))
            request.session.set_expiry(remember_seconds if remember_me else 0)
            
            # 多端登录：每次登录签发新会话，保留最近 MAX_SESSIONS_PER_USER 个。
            # 历史上这里是「登录即删除该用户全部 Token」（单会话），导致 A 端刚登录
            # B 端立刻 401；多人日常同时用手机和电脑时不可接受，故改为按会话签发，
            # 仅裁剪超出上限的最旧会话，避免会话表无限增长。
            max_sessions = max(int(getattr(settings, 'MAX_SESSIONS_PER_USER', 5) or 5), 1)
            with transaction.atomic():
                token = LoginSession.objects.create(user=user, expires_at=(
                    timezone.now() + timedelta(seconds=remember_seconds) if remember_me else None))
                stale_keys = list(
                    LoginSession.objects.filter(user=user)
                    .order_by('-created')
                    .values_list('key', flat=True)[max_sessions:]
                )
                if stale_keys:
                    LoginSession.objects.filter(key__in=stale_keys).delete()
            
            # 返回成功响应
            return Response({
                'success': True,
                'user': {
                    'id': user.id,
                    'username': user.username,
                    'first_name': user.first_name,
                    'is_superuser': user.is_superuser
                },
                'token': token.key
            }, status=status.HTTP_200_OK)
        else:
            # Increment throttle
            cache.set(throttle_key, failed_attempts + 1, 600) # 10 minutes
            return Response({
                'error': '用户名或密码错误'
            }, status=status.HTTP_401_UNAUTHORIZED)
    except User.DoesNotExist:
        # Increment throttle (avoid username enumeration timing attacks ideally, but for now just limit)
        cache.set(throttle_key, failed_attempts + 1, 600)
        return Response({
            'error': '用户名或密码错误'
        }, status=status.HTTP_401_UNAUTHORIZED)
    except Exception:
        logger.exception("login_failed_unexpected ip=%s", ip)
        return Response({
            'error': '登录失败，请稍后重试'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([AllowAny])
@csrf_exempt
def user_logout(request):
    """
    用户登出API
    """
    # 只吊销本次请求所用的会话。多端登录后同一用户可能同时存在多个会话，
    # 早先的 AuthToken.objects.get(user=...) 会抛 MultipleObjectsReturned，
    # 且会把其他设备的会话一起登出。
    if request.user.is_authenticated:
        token = getattr(request, 'auth', None)
        if isinstance(token, LoginSession):
            token.delete()
        
    logout(request)
    return Response({'success': True, 'message': '登出成功'})


@api_view(['POST'])
@permission_classes([AllowAny])
@csrf_exempt
def guest_session(request):
    """
    签发服务端访客标识。前端保存该标识，刷新页面后仍可凭它继续以访客身份访问。
    访客入口关闭（enable_guest_access=False）时拒绝签发。
    """
    from .models import SystemSetting
    if not SystemSetting.get_solo().enable_guest_access:
        return Response({'success': False, 'message': '访客入口已关闭'}, status=status.HTTP_403_FORBIDDEN)
    guest_token = secrets.token_urlsafe(32)  # 43 字符，满足 get_guest_token 的 64 字符上限
    return Response({
        'success': True,
        'guest_token': guest_token,
        'user': {'id': 0, 'username': 'Guest', 'email': '', 'first_name': '', 'is_active': True, 'is_guest': True, 'roles': []},
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def current_user(request):
    """
    获取当前登录用户信息
    """
    if request.user.is_authenticated:
        serializer = UserSerializer(request.user, context={'request': request})
        return Response(serializer.data)
    else:
        return Response({'error': '用户未登录'}, status=status.HTTP_401_UNAUTHORIZED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def update_profile(request):
    """
    更新个人信息
    """
    user = request.user
    
    user_data = {}
    for key in ['email', 'first_name', 'last_name']:
        if key in request.data:
            user_data[key] = request.data.get(key)

    profile_data = {}
    for key in ['avatar', 'employee_id', 'department', 'phone', 'bio', 'theme', 'notification_settings']:
        if key in request.data:
            profile_data[key] = request.data.get(key)

    user_serializer = UserSerializer(user, data=user_data, partial=True, context={'request': request})
    if user_serializer.is_valid():
        user_serializer.save()
    else:
        return Response(user_serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    # Update UserProfile fields
    if hasattr(user, 'profile'):
        profile_serializer = UserProfileSerializer(user.profile, data=profile_data, partial=True, context={'request': request})
        if profile_serializer.is_valid():
            profile_serializer.save()
        else:
            return Response(profile_serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            
    # Log audit
    AuditLog.objects.create(
        user=user,
        action='UPDATE',
        resource='UserProfile',
        resource_id=str(user.id),
        details=str(request.data), # Convert to string to avoid JSON errors if any
        success=True
    )
    
    # Return updated user data
    return Response(UserSerializer(user, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password(request):
    """
    修改密码
    """
    user = request.user
    old_password = request.data.get('old_password')
    new_password = request.data.get('new_password')
    
    if not old_password or not new_password:
        return Response({'error': '请提供旧密码和新密码'}, status=status.HTTP_400_BAD_REQUEST)

    if not user.check_password(old_password):
        return Response({'error': '旧密码错误'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        from django.contrib.auth.password_validation import validate_password
        validate_password(new_password, user)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(new_password)
    user.save()
    sessions = LoginSession.objects.filter(user=user)
    if isinstance(request.auth, LoginSession):
        sessions = sessions.exclude(key=request.auth.key)
    sessions.delete()
    
    # Update session auth hash to keep user logged in
    from django.contrib.auth import update_session_auth_hash
    update_session_auth_hash(request, user)
    
    AuditLog.objects.create(user=user, action='UPDATE', resource='User', details={'field': 'password'})
    
    return Response({'success': True, 'message': '密码修改成功'})


@api_view(['POST'])
@permission_classes([AllowAny])
def user_register(request):
    """
    用户注册API
    """
    try:
        # Check if registration is allowed
        from .models import SystemSetting
        try:
            setting = SystemSetting.get_solo()
            if not setting.allow_registration:
                 return Response({'error': 'System registration is closed.'}, status=status.HTTP_403_FORBIDDEN)
        except Exception:
            pass

        username = request.data.get('username')
        email = request.data.get('email')
        password = request.data.get('password')
        first_name = request.data.get('first_name', '')
        email_code = request.data.get('email_code')
        
        if not email or not password or not email_code:
            return Response({
                'error': '邮箱、验证码和密码不能为空'
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_email(email)
        except ValidationError:
            return Response({
                'error': '邮箱格式不正确'
            }, status=status.HTTP_400_BAD_REQUEST)

        if not username:
            username = email
        
        if User.objects.filter(email=email).exists():
            return Response({
                'error': '邮箱已存在'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if User.objects.filter(username=username).exists():
            return Response({
                'error': '用户名已存在'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Password validation
        try:
            from django.contrib.auth.password_validation import validate_password
            # Create a temporary user object to validate password against (e.g. checks against username)
            temp_user = User(username=username, email=email)
            validate_password(password, user=temp_user)
        except ValidationError as e:
            return Response({
                'error': '; '.join(e.messages)
            }, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        code_record = EmailVerificationCode.objects.filter(
            email=email,
            purpose='register',
            used_at__isnull=True,
            expires_at__gt=now
        ).order_by('-created_at').first()

        if not code_record or code_record.code != email_code:
            return Response({
                'error': '验证码无效或已过期'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        code_record.used_at = now
        code_record.save(update_fields=['used_at'])
        
        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
            first_name=first_name
        )
        
        # Assign default 'User' role
        try:
            default_role = Role.objects.get(name='User')
            UserRole.objects.create(user=user, role=default_role)
        except Role.DoesNotExist:
            # Try to init roles if missing (optional, or just log error)
            logger.warning("Default 'User' role not found; user created without role")
        
        # 生成登录会话（注册即登录，可与其他设备会话并存）
        token = LoginSession.objects.create(user=user)
        
        # 返回成功响应
        return Response({
            'success': True,
            'user': {
                'id': user.id,
                'username': user.username,
                'first_name': user.first_name,
                'is_superuser': user.is_superuser
            },
            'token': token.key
        }, status=status.HTTP_201_CREATED)
        
    except Exception as e:
        return Response({
            'error': f'注册失败: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _generate_email_code(length=6):
    return ''.join(secrets.choice(string.digits) for _ in range(length))


def _get_client_ip(request):
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        return x_forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


@api_view(['POST'])
@permission_classes([AllowAny])
def send_email_code(request):
    email = request.data.get('email')
    purpose = request.data.get('purpose', 'register')

    if not email:
        return Response({'error': '邮箱不能为空'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        validate_email(email)
    except ValidationError:
        return Response({'error': '邮箱格式不正确'}, status=status.HTTP_400_BAD_REQUEST)

    if purpose not in ['register']:
        return Response({'error': '用途不支持'}, status=status.HTTP_400_BAD_REQUEST)

    now = timezone.now()
    resend_seconds = getattr(settings, 'EMAIL_CODE_RESEND_SECONDS', 60)
    latest = EmailVerificationCode.objects.filter(email=email, purpose=purpose).order_by('-created_at').first()
    if latest and latest.created_at + timedelta(seconds=resend_seconds) > now:
        remaining = int((latest.created_at + timedelta(seconds=resend_seconds) - now).total_seconds())
        return Response({'error': '发送过于频繁', 'retry_after': remaining}, status=status.HTTP_429_TOO_MANY_REQUESTS)

    code = _generate_email_code()
    expire_minutes = getattr(settings, 'EMAIL_CODE_EXPIRE_MINUTES', 10)
    expires_at = now + timedelta(minutes=expire_minutes)

    subject = getattr(settings, 'EMAIL_CODE_SUBJECT', '注册验证码')
    template = getattr(settings, 'EMAIL_CODE_TEMPLATE', '你的验证码是 {code}，{minutes} 分钟内有效。')
    message = template.format(code=code, minutes=expire_minutes)

    try:
        send_mail(
            subject=subject,
            message=message,
            from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
            recipient_list=[email],
            fail_silently=False
        )
    except Exception as e:
        return Response({'error': f'验证码发送失败: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    EmailVerificationCode.objects.create(
        email=email,
        code=code,
        purpose=purpose,
        expires_at=expires_at,
        ip_address=_get_client_ip(request)
    )

    return Response({'success': True}, status=status.HTTP_200_OK)
