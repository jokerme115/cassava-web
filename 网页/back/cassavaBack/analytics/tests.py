from django.test import TestCase, RequestFactory
from .models import VisitorLog
from .views import PublicStatsView


class PublicStatsTests(TestCase):
    def test_repeated_requests_count_as_one_browser_session(self):
        for path in ('/api/models/', '/api/images/', '/api/analytics/public-stats/'):
            VisitorLog.objects.create(ip_address='127.0.0.1',path=path,method='GET',session_key='same-session')
        VisitorLog.objects.create(ip_address='127.0.0.1',path='/api/models/',method='GET',session_key='another-session')
        VisitorLog.objects.create(ip_address='127.0.0.1',path='/api/models/',method='GET',session_key=None)
        response=PublicStatsView.as_view()(RequestFactory().get('/api/analytics/public-stats/'))
        self.assertEqual(response.data['visit_count'],2)
        self.assertEqual(response.data['visit_count_type'],'browser_sessions')
        self.assertEqual(VisitorLog.objects.count(),5)
