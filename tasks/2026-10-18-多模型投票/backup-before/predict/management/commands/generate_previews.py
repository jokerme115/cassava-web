from django.core.management.base import BaseCommand
from django.db.models import Q
from predict.models import CassavaImage
from predict.oss_service import check_oss_configured, get_file_from_oss, upload_file_to_oss
from predict.storage_utils import build_preview_storage_key
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from PIL import Image
import io

class Command(BaseCommand):
    help = 'Generate previews for existing images that do not have one'

    def handle(self, *args, **options):
        images = CassavaImage.objects.filter(Q(preview_oss_key__isnull=True) | Q(preview_oss_key=''))
        total = images.count()
        self.stdout.write(f"Found {total} images without preview.")
        
        count = 0
        for image in images:
            try:
                # Get image content
                content = None
                if check_oss_configured() and image.oss_key:
                     content = get_file_from_oss(image.oss_key)
                elif image.oss_key:
                     if default_storage.exists(image.oss_key):
                         with default_storage.open(image.oss_key) as f:
                             content = f.read()
                
                if not content:
                    self.stdout.write(self.style.WARNING(f"Could not read content for image {image.id}: {image.name}"))
                    continue

                # Generate Preview
                img = Image.open(io.BytesIO(content))
                if img.mode in ('RGBA', 'P'):
                    img = img.convert('RGB')
                
                max_size = (600, 600)
                img.thumbnail(max_size)
                
                thumb_io = io.BytesIO()
                img.save(thumb_io, format='JPEG', quality=60)
                thumb_content = thumb_io.getvalue()
                
                preview_path = build_preview_storage_key(folder=image.folder)
                
                # Save
                if check_oss_configured():
                    upload_file_to_oss(preview_path, thumb_content)
                    image.preview_oss_key = preview_path
                else:
                    saved_path = default_storage.save(preview_path, ContentFile(thumb_content))
                    image.preview_oss_key = saved_path
                
                image.save()
                count += 1
                if count % 10 == 0:
                    self.stdout.write(f"Processed {count}/{total}")
                    
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"Error processing image {image.id}: {e}"))
        
        self.stdout.write(self.style.SUCCESS(f"Successfully generated previews for {count} images."))
