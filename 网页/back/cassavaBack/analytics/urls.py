from django.urls import path
from .views import VisitorStatsView, VisitorLogListView, PublicStatsView, VisitorIPStatsView

urlpatterns = [
    path('stats/', VisitorStatsView.as_view(), name='visitor-stats'),
    path('logs/', VisitorLogListView.as_view(), name='visitor-logs'),
    path('ip-stats/', VisitorIPStatsView.as_view(), name='visitor-ip-stats'),
    path('public-stats/', PublicStatsView.as_view(), name='public-stats'),
]
