from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from analytics.models import VisitorLog

class Command(BaseCommand):
    help = 'Cleans up visitor logs older than a specified number of days'

    def add_arguments(self, parser):
        parser.add_argument(
            '--days',
            type=int,
            default=30,
            help='Number of days to keep logs (default: 30)',
        )

    def handle(self, *args, **options):
        days = options['days']
        cutoff_date = timezone.now() - timedelta(days=days)
        
        count, _ = VisitorLog.objects.filter(created_at__lt=cutoff_date).delete()
        
        self.stdout.write(
            self.style.SUCCESS(f'Successfully deleted {count} visitor logs older than {days} days')
        )
