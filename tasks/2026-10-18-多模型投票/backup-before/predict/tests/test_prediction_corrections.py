import numpy as np
import shutil
import tempfile
from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from io import BytesIO
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from predict.mask_utils import calculate_mask_metrics, confidence_to_png_bytes, mask_to_png_bytes
from predict.models import CassavaImage, PredictionCorrection, PredictionResult, SystemSetting


class PredictionCorrectionMetricTest(SimpleTestCase):
    def test_rotten_mask_is_clipped_to_cassava_and_returns_percentage(self):
        cassava = np.zeros((4, 4), dtype=np.uint8)
        cassava[1:3, 1:3] = 1
        rotten = np.ones((4, 4), dtype=np.uint8)

        cassava_result, rotten_result, cassava_pixels, rotten_pixels, ppd_percent = calculate_mask_metrics(
            cassava, rotten
        )

        self.assertEqual(cassava_pixels, 4)
        self.assertEqual(rotten_pixels, 4)
        self.assertEqual(ppd_percent, 100.0)
        self.assertEqual(int(rotten_result.sum()), 4)
        self.assertEqual(int(cassava_result.sum()), 4)

    def test_empty_cassava_returns_zero_without_division_error(self):
        empty = np.zeros((3, 3), dtype=np.uint8)
        _, _, cassava_pixels, rotten_pixels, ppd_percent = calculate_mask_metrics(empty, empty)

        self.assertEqual(cassava_pixels, 0)
        self.assertEqual(rotten_pixels, 0)
        self.assertEqual(ppd_percent, 0.0)

    def test_mismatched_masks_are_rejected(self):
        with self.assertRaises(ValueError):
            calculate_mask_metrics(np.zeros((2, 2)), np.zeros((3, 3)))

    def test_confidence_map_is_saved_as_readable_grayscale_png(self):
        payload = confidence_to_png_bytes(np.array([[0.0, 0.5], [1.0, 0.25]], dtype=np.float32))
        image = Image.open(BytesIO(payload)).convert('L')
        values = np.asarray(image)
        self.assertEqual(values.shape, (2, 2))
        self.assertLessEqual(abs(int(values[0, 1]) - 128), 1)
        self.assertEqual(int(values[1, 0]), 255)


class PredictionCorrectionApiTest(APITestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.media_root = tempfile.mkdtemp(prefix='cassava-correction-tests-')
        cls.settings_override = override_settings(MEDIA_ROOT=cls.media_root)
        cls.settings_override.enable()

    @classmethod
    def tearDownClass(cls):
        cls.settings_override.disable()
        shutil.rmtree(cls.media_root, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_superuser('correction-admin', password='test-pass')
        self.client.force_authenticate(self.user)
        self.image = CassavaImage.objects.create(name='sample.png', oss_key='images/sample.png', owner=self.user)
        base_cassava = np.ones((4, 5), dtype=np.uint8)
        base_rotten = np.zeros((4, 5), dtype=np.uint8)
        cassava_key = default_storage.save(
            'prediction_masks/cassava/base.png', ContentFile(mask_to_png_bytes(base_cassava))
        )
        rotten_key = default_storage.save(
            'prediction_masks/rotten/base.png', ContentFile(mask_to_png_bytes(base_rotten))
        )
        self.prediction = PredictionResult.objects.create(
            result_image='predictions/sample.png', ppd_value=0, ppd_unit='percent',
            original_image=self.image, cassava_mask_key=cassava_key,
            rotten_mask_key=rotten_key, owner=self.user,
        )

    @staticmethod
    def upload(name, mask):
        return SimpleUploadedFile(name, mask_to_png_bytes(mask), content_type='image/png')

    def test_save_correction_clips_rotten_mask_and_preserves_model_result(self):
        cassava = np.zeros((4, 5), dtype=np.uint8)
        cassava[:, :3] = 1
        rotten = np.ones((4, 5), dtype=np.uint8)
        response = self.client.post(
            f'/api/predictions/{self.prediction.id}/corrections/',
            {'cassava_mask': self.upload('cassava.png', cassava), 'rotten_mask': self.upload('rotten.png', rotten)},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        correction = PredictionCorrection.objects.get(prediction=self.prediction)
        self.assertEqual((correction.version, correction.cassava_pixels, correction.rotten_pixels), (1, 12, 12))
        self.assertEqual(correction.ppd_percent, 100)
        self.prediction.refresh_from_db()
        self.assertEqual(self.prediction.ppd_value, 0)

    def test_empty_cassava_mask_is_rejected(self):
        empty = np.zeros((4, 5), dtype=np.uint8)
        response = self.client.post(
            f'/api/predictions/{self.prediction.id}/corrections/',
            {'cassava_mask': self.upload('cassava.png', empty), 'rotten_mask': self.upload('rotten.png', empty)},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(PredictionCorrection.objects.exists())

    def test_mask_dimensions_must_match_model_mask(self):
        wrong = np.ones((3, 3), dtype=np.uint8)
        response = self.client.post(
            f'/api/predictions/{self.prediction.id}/corrections/',
            {'cassava_mask': self.upload('cassava.png', wrong), 'rotten_mask': self.upload('rotten.png', wrong)},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class GuestPredictionSecurityTest(APITestCase):
    def setUp(self):
        setting = SystemSetting.get_solo()
        setting.enable_guest_access = True
        setting.save(update_fields=['enable_guest_access'])
        self.image = CassavaImage.objects.create(name='private.png', oss_key='images/private.png')
        self.prediction = PredictionResult.objects.create(
            result_image='predictions/private.png', ppd_value=5, original_image=self.image
        )

    def test_empty_whitelist_does_not_expose_predictions(self):
        response = self.client.get('/api/predictions/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 0)

    @override_settings(MINIAPP_ACCESS_TOKEN='miniapp-secret')
    def test_miniapp_token_cannot_delete_unlisted_image(self):
        response = self.client.delete(
            f'/api/images/{self.image.id}/', HTTP_X_MINIAPP_TOKEN='miniapp-secret'
        )
        self.assertIn(response.status_code, {
            status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND,
        })
        self.assertTrue(CassavaImage.objects.filter(pk=self.image.pk).exists())
