from rest_framework import serializers
from .models import VisitorLog

class VisitorLogSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True, default='Guest')
    
    class Meta:
        model = VisitorLog
        fields = ['id', 'ip_address', 'path', 'method', 'user_agent', 'created_at', 'is_guest', 'username']
