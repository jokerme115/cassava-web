from django.core.management.base import BaseCommand
from django.db.models import Q
from predict.image_quality import image_dimensions
from predict.models import CassavaImage
from predict.storage_utils import read_storage_bytes


class Command(BaseCommand):
    help = 'Fill missing original-image dimensions without changing source images or other fields.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        missing = Q(pixel_width__isnull=True) | Q(pixel_height__isnull=True)
        updated = skipped = 0
        for image in CassavaImage.objects.filter(missing).iterator():
            try:
                width, height = image_dimensions(read_storage_bytes(image.oss_key))
                if not options['dry_run']:
                    CassavaImage.objects.filter(missing, id=image.id).update(pixel_width=width, pixel_height=height)
                updated += 1
            except Exception as exc:
                skipped += 1
                self.stderr.write(f'Image {image.id}: original unavailable ({type(exc).__name__})')
        self.stdout.write(f'dimensions={updated}, unavailable={skipped}, dry_run={options["dry_run"]}')
