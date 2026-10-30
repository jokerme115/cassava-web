from rest_framework.views import APIView
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from django.utils import timezone
from django.db.models import Count, Q, Max
from django.db.models.functions import TruncDate
from django.db import DatabaseError, OperationalError
from datetime import timedelta
import logging
from .models import VisitorLog
from .serializers import VisitorLogSerializer
from predict.models import ProcessingTask, CassavaImage

logger = logging.getLogger(__name__)

class PublicStatsView(APIView):
    """
    Public API to retrieve system-wide statistics for the homepage.
    No authentication required.
    """
    permission_classes = []
    authentication_classes = []

    def get(self, request):
        try:
            # 1. Prediction Usage Count (Total tasks of type 'prediction')
            prediction_usage_count = ProcessingTask.objects.filter(type='prediction').count()
            
            # 2. Total Images Predicted (Unique images with prediction results)
            images_predicted_count = CassavaImage.objects.filter(prediction_results__isnull=False).distinct().count()

            # 3. Total Visit Count
            visit_count = VisitorLog.objects.count()

            return Response({
                'prediction_usage_count': prediction_usage_count,
                'images_predicted_count': images_predicted_count,
                'visit_count': visit_count
            })
        except (DatabaseError, OperationalError) as e:
            logger.error(f"Database error in PublicStatsView: {e}")
            # Return 0s or handle gracefully so frontend doesn't crash
            return Response({
                'prediction_usage_count': 0,
                'images_predicted_count': 0,
                'visit_count': 0
            })

class IsSuperUser(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.is_superuser

class StandardResultsSetPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100

class VisitorLogListView(ListAPIView):
    permission_classes = [IsSuperUser]
    serializer_class = VisitorLogSerializer
    pagination_class = StandardResultsSetPagination
    queryset = VisitorLog.objects.all().order_by('-created_at')

    def get_queryset(self):
        qs = super().get_queryset()
        days_param = self.request.query_params.get('days')
        if days_param:
            try:
                days = int(days_param)
                start_date = timezone.now() - timedelta(days=days)
                qs = qs.filter(created_at__gte=start_date)
            except ValueError:
                pass
        return qs

class VisitorIPStatsView(APIView):
    permission_classes = [IsSuperUser]
    pagination_class = StandardResultsSetPagination

    def get(self, request):
        days_param = request.query_params.get('days', 30)
        try:
            days = int(days_param)
        except ValueError:
            days = 30
            
        start_date = timezone.now() - timedelta(days=days)
        
        # Group by IP
        qs = VisitorLog.objects.filter(created_at__gte=start_date).values('ip_address').annotate(
            visit_count=Count('id'),
            last_seen=Max('created_at'),
            guest_visits=Count('id', filter=Q(is_guest=True)),
            registered_visits=Count('id', filter=Q(is_guest=False))
        ).order_by('-visit_count')

        # Pagination
        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(qs, request)
        if page is not None:
            return paginator.get_paginated_response(page)
            
        return Response(qs)

class VisitorStatsView(APIView):
    permission_classes = [IsSuperUser]

    def get(self, request):
        now = timezone.now()
        today = now.date()
        days_param = request.query_params.get('days', 30)
        try:
            days = int(days_param)
        except ValueError:
            days = 30
            
        start_date = now - timedelta(days=days)

        # Base QuerySet
        qs = VisitorLog.objects.filter(created_at__gte=start_date)

        # 1. Daily Trend (Line Chart)
        # Group by date
        daily_stats = qs.annotate(date=TruncDate('created_at')).values('date').annotate(
            total_visits=Count('id'),
            unique_visitors=Count('session_key', distinct=True),
            registered_visits=Count('id', filter=Q(is_guest=False)),
            guest_visits=Count('id', filter=Q(is_guest=True))
        ).order_by('date')

        # 2. Pie Chart Data (Registered vs Guest)
        total_registered = qs.filter(is_guest=False).count()
        total_guest = qs.filter(is_guest=True).count()

        # 3. New vs Returning (Approximation based on Session Key in this period)
        # This is a bit heavy, so we might skip or simplify.
        # Simplified: Just return Registered vs Guest as "User Type" distribution.
        
        # 4. Summary Cards
        today_qs = VisitorLog.objects.filter(created_at__date=today)
        today_visits = today_qs.count()
        today_unique = today_qs.values('session_key').distinct().count()
        
        # Format data for ECharts
        dates = []
        visits = []
        uniques = []
        registered = []
        guests = []
        
        for item in daily_stats:
            dates.append(item['date'].strftime('%Y-%m-%d'))
            visits.append(item['total_visits'])
            uniques.append(item['unique_visitors'])
            registered.append(item['registered_visits'])
            guests.append(item['guest_visits'])

        return Response({
            'chart_data': {
                'dates': dates,
                'visits': visits,
                'uniques': uniques,
                'registered': registered,
                'guests': guests
            },
            'pie_data': [
                {'name': 'Registered', 'value': total_registered},
                {'name': 'Guest', 'value': total_guest}
            ],
            'summary': {
                'today_visits': today_visits,
                'today_unique': today_unique,
                'total_visits_period': qs.count(),
                'unique_visitors_period': qs.values('session_key').distinct().count()
            }
        })
