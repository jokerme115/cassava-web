"""
URL configuration for cassavaBack project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.decorators.csrf import csrf_exempt
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.utils import timezone

# 添加一个健康检查API
@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    return Response({"status": "ok"})

# 添加系统状态API
@api_view(['GET'])
@permission_classes([AllowAny])
def api_status(request):
    from predict.models import CassavaImage, ProcessingTask
    return Response({
        "status": "connected",
        "version": "1.0.0",
        "server_time": timezone.now().isoformat(),
        "image_count": CassavaImage.objects.count(),
        "task_count": ProcessingTask.objects.count()
    })

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('predict.urls')),
    path('api/analytics/', include('analytics.urls')),
    path('health/', health_check, name='health_check'),
    path('api/status/', api_status, name='api_status'),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
