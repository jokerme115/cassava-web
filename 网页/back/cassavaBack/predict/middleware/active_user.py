from django.utils import timezone
from django.core.cache import cache
from predict.models import UserProfile

class UpdateLastActivityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if request.user.is_authenticated:
            # Update last activity every 5 minutes to avoid too many DB writes
            # We can use cache to debounce
            user_id = request.user.id
            cache_key = f'last_seen_{user_id}'
            
            if not cache.get(cache_key):
                # Update DB
                try:
                    # Check if profile exists
                    if hasattr(request.user, 'profile'):
                        request.user.profile.last_activity = timezone.now()
                        request.user.profile.save(update_fields=['last_activity'])
                    else:
                        # Optional: Create profile if it doesn't exist
                        UserProfile.objects.create(user=request.user, last_activity=timezone.now())
                    
                    # Set cache for 5 minutes
                    cache.set(cache_key, True, 300)
                except Exception:
                    # Log error silently
                    pass

        return response
