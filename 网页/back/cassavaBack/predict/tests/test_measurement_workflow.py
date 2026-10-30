from io import BytesIO
from unittest.mock import patch
from zipfile import ZipFile
import csv
import json

import numpy as np
from PIL import Image
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.test import SimpleTestCase

from predict.m6_predictor import M6BestPredictor, _post_process_mask
from predict.services import DeepLabV3PlusService, PredictionService, TaskService
from predict.models import ProcessingTask, PredictionResult
from predict.tests.test_prediction_corrections import PredictionCorrectionApiTest


class PredictionContractTests(SimpleTestCase):
    def test_m6_tta_runs_three_aligned_predictions_without_stride_gaps(self):
        import torch
        predictor = M6BestPredictor()
        predictor.device = torch.device('cpu')
        calls = []

        def model(patch):
            calls.append(patch.shape)
            return torch.stack((patch[:, 0], patch[:, 0] + 1), dim=1)

        probabilities = predictor._sliding_window_predict(model, torch.ones(3, 16, 16), (16, 16), (32, 32), use_tta=True)
        self.assertEqual(len(calls), 3)
        self.assertTrue(np.all(probabilities > .7))

    def test_m6_postprocessing_can_be_disabled_for_small_lesions(self):
        predictor = M6BestPredictor()
        probability = np.zeros((16, 16), dtype=np.float32)
        probability[4:6, 4:6] = .9
        with patch.object(predictor, '_checkpoint_path'), patch.object(predictor, '_build_model'), patch(
            'predict.m6_predictor._imread_unicode', return_value=np.zeros((16, 16, 3), np.uint8)
        ), patch.object(predictor, '_sliding_window_predict', return_value=probability):
            raw = predictor.predict('unused.png', use_post_processing=False)
            filtered = predictor.predict('unused.png', use_post_processing=True)
        self.assertEqual(int(raw['mask'].sum()), 4)
        self.assertEqual(int(filtered['mask'].sum()), 0)

    def test_flat_and_nested_advanced_params_are_identical(self):
        advanced = {'confidenceThreshold': .91, 'minArea': 7, 'morphKernelSize': 0,
                    'usePostProcessing': False, 'useTTA': True, 'expectedCount': 0,
                    'patchSize': [256, 256], 'stride': [128, 128], 'single_model_type': 'm6_best'}
        flat = PredictionService._parse_prediction_params(advanced)
        nested = PredictionService._parse_prediction_params({'parameters': advanced})
        self.assertEqual(flat, nested)
        self.assertEqual((flat['confidence'], flat['min_area'], flat['single_model_type']), (.91, 7, 'm6_best'))
        self.assertFalse(flat['use_post_processing'])
        self.assertTrue(flat['use_tta'])

    def test_rgb_array_and_pil_use_same_area_mask(self):
        rgb = np.zeros((100, 100, 3), np.uint8)
        rgb[20:80, 30:70] = [220, 180, 90]
        service = DeepLabV3PlusService()
        np.testing.assert_array_equal(service.get_cassava_area_mask(rgb), service.get_cassava_area_mask(Image.fromarray(rgb)))

    def test_uniform_background_is_not_reported_as_cassava_area(self):
        mask = DeepLabV3PlusService().get_cassava_area_mask(np.full((100, 100, 3), 120, np.uint8))
        self.assertEqual(int(mask.sum()), 0)

    def test_postprocessing_preserves_holes_when_smoothing_is_disabled(self):
        mask = np.zeros((30, 30), np.uint8)
        mask[5:25, 5:25] = 1
        mask[10:20, 10:20] = 0
        np.testing.assert_array_equal(_post_process_mask(mask, 0, 0, 0), mask)


class MeasurementWorkflowTests(PredictionCorrectionApiTest):
    def setUp(self):
        super().setUp()
        buffer = BytesIO()
        Image.new('RGB', (5, 4), 'white').save(buffer, format='PNG')
        key = default_storage.save('images/sample.png', ContentFile(buffer.getvalue()))
        self.image.oss_key = key
        self.image.save(update_fields=['oss_key'])

    def download(self, file_type, **params):
        response = self.client.get('/api/predictions/export/', {'file_type': file_type, **params})
        self.assertEqual(response.status_code, 200)
        content = b''.join(response.streaming_content)
        count = int(response['X-Export-Count'])
        response.close()
        return content, count

    def correct_zero(self, base_version='0'):
        cassava = np.ones((4, 5), np.uint8)
        rotten = np.zeros((4, 5), np.uint8)
        return self.client.post(f'/api/predictions/{self.prediction.id}/corrections/', {
            'cassava_mask': self.upload('cassava.png', cassava),
            'rotten_mask': self.upload('rotten.png', rotten), 'base_version': base_version,
            'note': '复核病变为空'}, format='multipart')

    def test_zero_correction_survives_serialization_and_export(self):
        self.assertEqual(self.correct_zero().status_code, 201)
        data = self.client.get(f'/api/predictions/{self.prediction.id}/').data
        data = data.get('data', data)
        self.assertEqual(data['measurement']['final_ppd'], 0)
        self.assertEqual(data['latest_correction']['version'], 1)
        content, count = self.download('csv')
        row = list(csv.DictReader(content.decode('utf-8-sig').splitlines()))[0]
        self.assertEqual((count, float(row['最终PPD(%)']), row['校正版本']), (1, 0, '1'))

    def test_stale_correction_is_rejected(self):
        self.assertEqual(self.correct_zero().status_code, 201)
        self.assertEqual(self.correct_zero('0').status_code, 409)
        self.assertEqual(self.prediction.corrections.count(), 1)

    def test_overlay_honors_photo_orientation(self):
        image = Image.new('RGB', (5, 4), 'red')
        for y in range(2, 4):
            for x in range(5):
                image.putpixel((x, y), (0, 0, 255))
        exif = image.getexif()
        exif[274] = 3
        buffer = BytesIO()
        image.save(buffer, format='PNG', exif=exif)
        self.image.oss_key = default_storage.save('images/oriented.png', ContentFile(buffer.getvalue()))
        self.image.save(update_fields=['oss_key'])
        response = self.client.get(f'/api/predictions/{self.prediction.id}/overlay/')
        self.assertEqual(response.status_code, 200)
        pixel = Image.open(BytesIO(response.content)).convert('RGB').getpixel((0, 0))
        self.assertGreater(pixel[2], pixel[0])

    def test_export_includes_more_than_one_page_and_scopes_task(self):
        task = ProcessingTask.objects.create(name='export-task', type='prediction', owner=self.user)
        PredictionResult.objects.bulk_create([
            PredictionResult(original_image=self.image, owner=self.user, result_image='sample.png',
                             ppd_value=0, ppd_unit='percent', processing_task=task,
                             cassava_mask_key=self.prediction.cassava_mask_key,
                             rotten_mask_key=self.prediction.rotten_mask_key) for _ in range(101)
        ])
        _, count = self.download('csv', task_id=task.id)
        self.assertEqual(count, 101)

    def test_export_cannot_include_other_users_results(self):
        from django.contrib.auth.models import User
        outsider = User.objects.create_user('outsider')
        self.client.force_authenticate(outsider)
        response = self.client.get('/api/predictions/export/', {'file_type': 'csv'})
        self.assertIn(response.status_code, (400, 403))

    def test_portable_zip_contains_final_masks_overlay_and_workbook(self):
        self.assertEqual(self.correct_zero().status_code, 201)
        content, count = self.download('zip')
        with ZipFile(BytesIO(content)) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            item = manifest['results'][0]
            self.assertEqual(count, manifest['count'])
            self.assertFalse(item['errors'])
            self.assertEqual(item['final_ppd'], 0)
            Image.open(BytesIO(archive.read(item['files']['final_overlay.png']))).verify()
            with ZipFile(BytesIO(archive.read('results.xlsx'))) as workbook:
                self.assertIn('xl/worksheets/sheet2.xml', workbook.namelist())

    def test_task_executor_merges_selected_model_into_flat_parameters(self):
        task = ProcessingTask.objects.create(name='M6 task', type='prediction', status='pending',
            owner=self.user, image_ids=[self.image.id], single_model_type='m6_best',
            parameters={'confidenceThreshold': .81, 'useTTA': True})
        with patch('predict.services.prediction_provenance', return_value=[]), patch.object(PredictionService, 'run_predictions_for_images', return_value={
            'results': [self.prediction], 'errors': [], 'processed_count': 1}) as run:
            TaskService.execute_prediction_task(task.id)
        parsed = PredictionService._parse_prediction_params(run.call_args.kwargs['params'])
        self.assertEqual(parsed['single_model_type'], 'm6_best')
        self.assertEqual(parsed['confidence'], .81)
        task.refresh_from_db()
        self.assertEqual(task.parameters['_execution']['model'], 'm6_best')
