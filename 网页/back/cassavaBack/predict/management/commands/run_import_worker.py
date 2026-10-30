import time
from django.core.management.base import BaseCommand
from django.db import close_old_connections
from predict.import_pipeline import claim_next_job


class Command(BaseCommand):
    help = 'Process durable import jobs, independently from CPU prediction.'

    def add_arguments(self, parser):
        parser.add_argument('--once', action='store_true')

    def handle(self, *args, **options):
        self.stdout.write('Import worker ready')
        while True:
            close_old_connections()
            processed = claim_next_job()
            if options['once']:
                return
            if not processed:
                time.sleep(1)
