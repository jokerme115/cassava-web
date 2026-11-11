from pathlib import Path
p=Path('网页/back/cassavaBack/predict/serializers.py')
s=p.read_text(encoding='utf-8')
a=s.index('    def validate_preferences(self, value):',s.index('class UserProfileSerializer'))
b=s.index('    def get_avatar_url',a)
s=s[:a]+'''    preferences_etag = serializers.SerializerMethodField()

    def get_preferences_etag(self, obj):
        from .user_preferences import preferences_etag
        return preferences_etag(obj.preferences)

    def validate_preferences(self, value):
        from .user_preferences import validate_preferences
        return validate_preferences(value)

'''+s[b:]
s=s.replace("'notification_settings', 'preferences']", "'notification_settings', 'preferences', 'preferences_etag']")
p.write_text(s,encoding='utf-8')
p=Path('网页/back/cassavaBack/predict/auth_views.py')
s=p.read_text(encoding='utf-8'); a=s.index('    user = request.user',s.index('def update_profile')); b=s.index('\n\n@api_view',a)
s=s[:a]+'''    from .user_preferences import preferences_etag
    user = request.user
    user_data = {key: request.data[key] for key in ['email', 'first_name', 'last_name'] if key in request.data}
    profile_data = {key: request.data[key] for key in ['avatar', 'employee_id', 'department', 'phone', 'bio', 'theme', 'notification_settings', 'preferences'] if key in request.data}
    with transaction.atomic():
        profile = UserProfile.objects.select_for_update().get(user=user)
        if 'preferences' in profile_data:
            expected = request.data.get('preferences_etag')
            if expected and expected != preferences_etag(profile.preferences):
                return Response({'error': '设置已在其他页面更新，请刷新后再保存', 'code': 'preferences_conflict'}, status=409)
            patch = profile_data['preferences']
            if not isinstance(patch, dict):
                return Response({'error': '偏好设置必须为对象'}, status=400)
            profile_data['preferences'] = {**profile.preferences, **patch}
        user_serializer = UserSerializer(user, data=user_data, partial=True, context={'request': request})
        profile_serializer = UserProfileSerializer(profile, data=profile_data, partial=True, context={'request': request})
        user_serializer.is_valid(raise_exception=True)
        profile_serializer.is_valid(raise_exception=True)
        user_serializer.save()
        profile_serializer.save()
        user._state.fields_cache['profile'] = profile
        AuditLog.objects.create(user=user, action='UPDATE', resource='UserProfile', resource_id=str(user.id), details={'fields': list(user_data) + list(profile_data)}, success=True)
    return Response(UserSerializer(user, context={'request': request}).data)
'''+s[b:]
p.write_text(s,encoding='utf-8')
