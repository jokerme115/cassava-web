import io
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient

from predict.models import CassavaImage, SystemSetting
from predict.permissions import grant_permission_to_user
from predict.services import ImageService

REAL_IMAGE_OPEN = Image.open


class MpoUploadViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user('uploader', 'uploader@example.com', 'pass1')
        SystemSetting.get_solo()

        from predict.models import Permission

        Permission.objects.create(codename='view_image', name='View Image', category='image')
        Permission.objects.create(codename='upload_image', name='Upload Image', category='image')
        grant_permission_to_user(self.user, 'view_image')
        grant_permission_to_user(self.user, 'upload_image')

    @patch('predict.views.ImageService._normalize_uploaded_image_bytes')
    def test_upload_files_accepts_mpo_after_normalization(self, mock_normalize):
        self.client.force_authenticate(user=self.user)

        jpeg_buffer = io.BytesIO()
        Image.new('RGB', (8, 8), (255, 0, 0)).save(jpeg_buffer, format='JPEG')
        jpeg_bytes = jpeg_buffer.getvalue()
        mock_normalize.return_value = {
            'content': jpeg_bytes,
            'image': Image.open(io.BytesIO(jpeg_bytes)),
            'format': 'JPEG',
            'converted': True,
            'suggested_extension': '.jpg',
        }

        fake_mpo_file = SimpleUploadedFile('stereo.jpg', b'fake-mpo-content', content_type='image/jpeg')
        response = self.client.post('/api/images/upload-files/', {'files': [fake_mpo_file]}, format='multipart')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(CassavaImage.objects.count(), 1)
        self.assertEqual(CassavaImage.objects.first().size, len(jpeg_bytes))


class ImageServiceNormalizationTests(TestCase):
    class _VerifiedMpoImage:
        format = 'MPO'

        def verify(self):
            return None

    @patch('predict.services.image.Image.open')
    def test_normalize_uploaded_image_bytes_converts_mpo_to_jpeg(self, mock_image_open):
        jpeg_buffer = io.BytesIO()
        Image.new('RGB', (10, 10), (0, 128, 255)).save(jpeg_buffer, format='JPEG')
        source_bytes = jpeg_buffer.getvalue()
        real_image = REAL_IMAGE_OPEN(io.BytesIO(source_bytes))

        mock_image_open.side_effect = [self._VerifiedMpoImage(), real_image]

        normalized = ImageService._normalize_uploaded_image_bytes(source_bytes)

        self.assertTrue(normalized['converted'])
        self.assertEqual(normalized['format'], 'JPEG')
        self.assertEqual(normalized['suggested_extension'], '.jpg')

        converted = REAL_IMAGE_OPEN(io.BytesIO(normalized['content']))
        self.assertEqual(converted.format, 'JPEG')
