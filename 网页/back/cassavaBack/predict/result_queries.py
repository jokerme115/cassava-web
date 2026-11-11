"""One server-side result scope for list, summary and export."""
from django.db.models import Q, F, OuterRef, Subquery, Case, When, FloatField, Value, IntegerField
from django.db.models.functions import Coalesce
from .models import PredictionCorrection


def result_scope(queryset, params):
    correction = PredictionCorrection.objects.filter(prediction_id=OuterRef('pk')).order_by('-version')
    valid = Q(error_code__isnull=True) | Q(error_code='')
    value = Coalesce(Subquery(correction.values('ppd_percent')[:1]), Case(
        When(valid & Q(ppd_unit='percent'), then=F('ppd_value')),
        When(valid & Q(ppd_unit='ratio'), then=F('ppd_value') * 100.),
        default=Value(None), output_field=FloatField()))
    queryset = queryset.annotate(_final_ppd=value,
        _latest_version=Coalesce(Subquery(correction.values('version')[:1]), Value(0), output_field=IntegerField()))
    search = str(params.get('search', '')).strip()
    if search:
        queryset = queryset.filter(Q(original_image__name__icontains=search) | Q(original_image__folder__name__icontains=search))
    level = params.get('status', 'all')
    if level == 'high': queryset = queryset.filter(_final_ppd__gte=7)
    elif level == 'medium': queryset = queryset.filter(_final_ppd__gte=4, _final_ppd__lt=7)
    elif level == 'low': queryset = queryset.filter(_final_ppd__lt=4)
    elif level == 'review': queryset = queryset.filter(_final_ppd__isnull=True)
    elif level != 'all':
        from rest_framework.exceptions import ValidationError
        raise ValidationError('无效PPD筛选条件')
    reviewed = params.get('review_status')
    if reviewed == 'reviewed': queryset = queryset.filter(reviewed_version=F('_latest_version'))
    elif reviewed == 'unreviewed': queryset = queryset.exclude(reviewed_version=F('_latest_version'))
    return queryset
