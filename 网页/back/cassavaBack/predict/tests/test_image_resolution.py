from io import BytesIO
import tempfile
from zipfile import ZipFile

from PIL import Image
from django.contrib.auth.models import User
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APITestCase
from django.core.management import call_command
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from predict.image_quality import resolution_info, image_dimensions
from predict.models import CassavaImage


class ResolutionRuleTests(SimpleTestCase):
    def test_screening_boundaries_and_unknown_are_distinct(self):
        for width, height, expected in [(1024, 512, False), (512, 1024, False),
                (1023, 700, True), (2000, 511, True), (None, None, None)]:
            self.assertIs(resolution_info(width, height)['low_resolution'], expected)

    def test_original_dimensions_follow_exif_orientation(self):
        buffer = BytesIO(); exif = Image.Exif(); exif[274] = 6
        Image.new('RGB', (1200, 600)).save(buffer, format='JPEG', exif=exif)
        self.assertEqual(image_dimensions(buffer.getvalue()), (600, 1200))


class ResolutionUploadTests(APITestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.directory = tempfile.TemporaryDirectory(prefix='cassava-resolution-')
        cls.settings_override = override_settings(MEDIA_ROOT=cls.directory.name)
        cls.settings_override.enable()

    @classmethod
    def tearDownClass(cls):
        cls.settings_override.disable()
        cls.directory.cleanup()
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_superuser('resolution-admin', password='test')
        self.client.force_authenticate(self.user)

    def image_bytes(self, size):
        buffer = BytesIO(); Image.new('RGB', size).save(buffer, format='PNG')
        return buffer.getvalue()

    def test_low_resolution_upload_is_allowed_and_label_survives_list_reload(self):
        file = SimpleUploadedFile('low.png', self.image_bytes((791, 442)), content_type='image/png')
        response = self.client.post('/api/images/upload-files/', {'files': [file]}, format='multipart')
        self.assertEqual(response.status_code, 201)
        image = CassavaImage.objects.get()
        self.assertEqual((image.pixel_width, image.pixel_height), (791, 442))
        self.assertIs(response.data[0]['resolution']['low_resolution'], True)
        detail = self.client.get(f'/api/images/{image.id}/')
        self.assertIs(detail.data['resolution']['low_resolution'], True)

    def test_high_resolution_uses_original_dimensions_not_600px_preview(self):
        file = SimpleUploadedFile('high.png', self.image_bytes((1600, 900)), content_type='image/png')
        response = self.client.post('/api/images/upload-files/', {'files': [file]}, format='multipart')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data[0]['pixel_width'], 1600)
        self.assertFalse(response.data[0]['resolution']['low_resolution'])

    def test_zip_upload_returns_low_resolution_advice_and_persists_dimensions(self):
        buffer = BytesIO()
        with ZipFile(buffer, 'w') as archive:
            archive.writestr('low.png', self.image_bytes((320, 240)))
            archive.writestr('high.png', self.image_bytes((1600, 900)))
        response = self.client.post('/api/images/upload-batch/', {
            'file': SimpleUploadedFile('images.zip', buffer.getvalue(), content_type='application/zip')}, format='multipart')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 2)
        self.assertEqual([item['name'] for item in response.data['resolution_warnings']], ['low.png'])
        self.assertEqual(CassavaImage.objects.get(name='low.png').pixel_width, 320)

    def test_backfill_reads_original_and_leaves_unknown_missing_files_unlabelled(self):
        key = default_storage.save('originals/old.png', ContentFile(self.image_bytes((791, 442))))
        known = CassavaImage.objects.create(name='old', oss_key=key, owner=self.user)
        missing = CassavaImage.objects.create(name='missing', oss_key='not-here.png', owner=self.user)
        call_command('backfill_image_dimensions', stdout=BytesIOText(), stderr=BytesIOText())
        known.refresh_from_db(); missing.refresh_from_db()
        self.assertEqual((known.pixel_width, known.pixel_height), (791, 442))
        self.assertIsNone(missing.pixel_width)
        self.assertIsNone(self.client.get(f'/api/images/{missing.id}/').data['resolution']['low_resolution'])


class BytesIOText:
    def write(self, value):
        return len(value)

    def flush(self):
        pass
