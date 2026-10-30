from .models import VisitorLog

class VisitorTrackingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        
        # Filter out static files, media, admin calls to avoid noise
        if request.path.startswith('/static/') or \
           request.path.startswith('/media/') or \
           request.path.startswith('/admin/') or \
           request.path.startswith('/api/status/') or \
           request.path.endswith('favicon.ico') or \
           request.path.endswith('manifest.json') or \
           request.path.endswith('robots.txt'):
            return response
            
        # Ignore OPTIONS requests (preflight)
        if request.method == 'OPTIONS':
            return response

        ip = self.get_client_ip(request)
        user = request.user if request.user.is_authenticated else None
        
        # Ensure session exists
        if not request.session.session_key:
            try:
                request.session.save()
            except Exception:
                pass # Fail silently if session backend issues
            
        VisitorLog.objects.create(
            user=user,
            ip_address=ip,
            path=request.path,
            method=request.method,
            user_agent=request.META.get('HTTP_USER_AGENT', ''),
            is_guest=user is None,
            session_key=request.session.session_key
        )
        
        return response

    def get_client_ip(self, request):
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip
