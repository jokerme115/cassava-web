import hashlib
import shutil
import tempfile
from unittest.mock import patch, MagicMock
from io import BytesIO
from pathlib import Path
from PIL import Image
from django.test import override_settings
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase
from predict.models import CassavaImage, Folder, ProcessingTask, PredictionResult, PredictionCorrection, ImportJob
from predict.import_pipeline import claim_next_job, archive_entries, item_path, report_progress
from predict.services.image import ImageService
from predict.recycling import recycle


def photo(color='white', capture=False):
    buffer = BytesIO(); image = Image.new('RGB', (40, 30), color)
    exif = image.getexif()
    if capture: exif[36867] = '2026:10:29 12:34:56'
    image.save(buffer, format='JPEG', exif=exif)
    return buffer.getvalue()


class WebUpgradeTest(APITestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='cassava-upgrade-')
        self.override = override_settings(MEDIA_ROOT=self.root, IMPORT_STAGING_ROOT=Path(self.root)/'staging')
        self.override.enable()
        self.user = User.objects.create_superuser('upgrade', 'test@example.test', 'test-password')
        self.client.force_authenticate(self.user)

    def tearDown(self):
        self.override.disable(); shutil.rmtree(self.root)

    def test_compact_import_list_exposes_acknowledged_bytes_and_source_name(self):
        job = self.client.post('/api/imports/', {'files': [{'path': '中文资料.zip', 'size': 10}]}, format='json').data
        item = job['items'][0]
        reply = self.client.post(f'/api/imports/{job["id"]}/items/{item["id"]}/chunk/',
            {'offset': 0, 'chunk': SimpleUploadedFile('chunk', b'abcd')}, format='multipart')
        self.assertEqual(reply.status_code, 200)
        compact = self.client.get('/api/imports/').data[0]
        self.assertEqual(compact['items'], [])
        self.assertEqual(compact['transfer']['bytes_received'], 4)
        self.assertEqual(compact['transfer']['bytes_total'], 10)
        self.assertTrue(compact['transfer']['has_archive'])
        self.assertEqual(compact['transfer']['files'][0]['relative_path'], '中文资料.zip')
        self.assertIsNotNone(compact['heartbeat'])

    def test_upload_interruption_survives_reload_and_next_chunk_clears_it(self):
        job = self.client.post('/api/imports/', {'files': [{'path': 'a.zip', 'size': 4}]}, format='json').data
        self.client.post(f'/api/imports/{job["id"]}/pause/', {'reason': '网络连接中断'}, format='json')
        self.assertEqual(self.client.get('/api/imports/').data[0]['error'], '网络连接中断')
        item = job['items'][0]
        self.client.post(f'/api/imports/{job["id"]}/items/{item["id"]}/chunk/',
            {'offset': 0, 'chunk': SimpleUploadedFile('chunk', b'abcd')}, format='multipart')
        self.assertEqual(self.client.get('/api/imports/').data[0]['error'], '')

    def test_other_account_cannot_pause_an_import(self):
        job = self.client.post('/api/imports/', {'files': [{'path': 'a.zip', 'size': 1}]}, format='json').data
        other = User.objects.create_superuser('other-import', password='test-pass')
        self.client.force_authenticate(other)
        reply = self.client.post(f'/api/imports/{job["id"]}/pause/', {'reason': 'x'}, format='json')
        self.assertEqual(reply.status_code, 404)

    def test_worker_reports_scan_extract_and_import_without_counting_archive_as_image(self):
        job = self.client.post('/api/imports/', {'files': [{'path': '中文.zip', 'size': 3}]}, format='json').data
        self.client.post(f'/api/imports/{job["id"]}/items/{job["items"][0]["id"]}/chunk/',
            {'offset': 0, 'chunk': SimpleUploadedFile('chunk', b'zip')}, format='multipart')
        with patch('predict.import_views.report_progress', wraps=report_progress) as verify:
            self.assertEqual(self.client.post(f'/api/imports/{job["id"]}/finalize/').status_code, 200)
            self.assertEqual(verify.call_args.args[1], 'verifying')
        process = MagicMock()
        process.stdout = BytesIO(photo());process.wait.return_value = 0;process.poll.return_value = 0
        with patch('predict.import_pipeline.archive_entries', return_value=[('第1天/a.jpg', len(photo()))]), \
             patch('predict.import_pipeline.subprocess.Popen', return_value=process), \
             patch('predict.import_pipeline.report_progress', wraps=report_progress) as progress:
            claim_next_job()
        self.assertTrue({'scanning', 'extracting', 'importing'}.issubset({c.args[1] for c in progress.call_args_list}))
        reply = self.client.get('/api/imports/').data[0]
        self.assertEqual(reply['state'], 'completed')
        self.assertEqual(reply['summary']['success'], 1)
        self.assertEqual(reply['transfer']['bytes_total'], 3)
        self.assertEqual(reply['transfer']['total_files'], 1)
        self.assertEqual(reply['progress']['completed'], 1)

    def test_cancelled_import_is_not_relabelled_by_late_progress(self):
        job = self.client.post('/api/imports/', {'files': [{'path': 'a.zip', 'size': 1}]}, format='json').data
        obj = ImportJob.objects.get(pk=job['id'])
        self.client.post(f'/api/imports/{job["id"]}/cancel/')
        report_progress(obj, 'extracting', 'a.jpg', 1, 3)
        obj.refresh_from_db()
        self.assertEqual(obj.state, 'cancelled')
        self.assertNotIn('progress', obj.summary)

    def test_bad_archive_is_failed_instead_of_claiming_partial_success(self):
        job = self.client.post('/api/imports/', {'files': [{'path': 'bad.zip', 'size': 3}]}, format='json').data
        self.client.post(f'/api/imports/{job["id"]}/items/{job["items"][0]["id"]}/chunk/',
            {'offset': 0, 'chunk': SimpleUploadedFile('chunk', b'bad')}, format='multipart')
        self.client.post(f'/api/imports/{job["id"]}/finalize/')
        with patch('predict.import_pipeline.archive_entries', side_effect=ValueError('压缩包已损坏')):
            claim_next_job()
        reply = self.client.get('/api/imports/').data[0]
        self.assertEqual(reply['state'], 'failed')
        self.assertEqual(reply['items'][0]['error'], '压缩包已损坏')
        self.assertEqual(ProcessingTask.objects.get(pk=job['task_id']).status, 'failed')

    def test_dedup_is_exactly_one_folder_and_same_name_different_bytes_is_retained(self):
        a = Folder.objects.create(owner=self.user, name='a')
        b = Folder.objects.create(owner=self.user, parent=a, name='b')
        original, error = ImageService.upload_image(SimpleUploadedFile('same.jpg', photo(capture=True)), a.pk, user=self.user)
        self.assertIsNone(error); self.assertEqual(original.capture_time_source, 'exif')
        duplicate, error = ImageService.upload_image(SimpleUploadedFile('different-name.jpg', photo(capture=True)), a.pk, user=self.user)
        self.assertIsNone(duplicate); self.assertEqual(error[0], 'DUPLICATE_CONTENT')
        cross, error = ImageService.upload_image(SimpleUploadedFile('same.jpg', photo(capture=True)), b.pk, user=self.user)
        self.assertIsNone(error); self.assertIsNotNone(cross)
        different, error = ImageService.upload_image(SimpleUploadedFile('same.jpg', photo('red')), a.pk, user=self.user)
        self.assertIsNone(error); self.assertNotEqual(different.name, original.name)

    def test_recycle_preserves_prediction_and_restores_same_id(self):
        image = CassavaImage.objects.create(owner=self.user, name='photo', oss_key='missing')
        result = PredictionResult.objects.create(owner=self.user, original_image=image, ppd_value=1, ppd_unit='percent')
        self.assertEqual(self.client.delete(f'/api/images/{image.pk}/').status_code, 204)
        self.assertFalse(CassavaImage.objects.filter(pk=image.pk).exists())
        self.assertTrue(PredictionResult.objects.filter(pk=result.pk).exists())
        self.assertEqual(self.client.get('/api/images/', {'trash': 1}).data['count'], 1)
        self.assertEqual(self.client.post(f'/api/images/{image.pk}/restore/').status_code, 200)
        self.assertTrue(CassavaImage.objects.filter(pk=image.pk).exists())

    def test_recycled_task_keeps_historical_link_and_predictions_readable(self):
        task = ProcessingTask.objects.create(owner=self.user, name='历史任务', type='prediction', status='completed')
        result = PredictionResult.objects.create(owner=self.user, processing_task=task, ppd_value=1, ppd_unit='percent')
        recycle(task, self.user)
        self.assertEqual(self.client.get(f'/api/tasks/{task.pk}/').status_code, 200)
        self.assertEqual(self.client.get('/api/tasks/').data['count'], 0)
        self.assertEqual(self.client.get('/api/predictions/', {'task_id': task.pk}).data['count'], 1)
        self.assertTrue(PredictionResult.objects.filter(pk=result.pk).exists())

    def test_folder_recycle_does_not_restore_older_individual_trash(self):
        folder = Folder.objects.create(owner=self.user, name='folder')
        old = CassavaImage.objects.create(owner=self.user, folder=folder, name='old', oss_key='missing')
        active = CassavaImage.objects.create(owner=self.user, folder=folder, name='active', oss_key='missing')
        recycle(old, self.user); recycle(folder, self.user)
        self.client.post(f'/api/folders/{folder.pk}/restore/')
        self.assertTrue(CassavaImage.objects.filter(pk=active.pk).exists())
        self.assertFalse(CassavaImage.objects.filter(pk=old.pk).exists())

    def test_permanent_clear_requires_confirmation_and_reports_history_impact(self):
        image = CassavaImage.objects.create(owner=self.user, name='qa-only', oss_key='missing')
        result = PredictionResult.objects.create(owner=self.user, original_image=image, ppd_value=1, ppd_unit='percent')
        PredictionCorrection.objects.create(prediction=result, owner=self.user, version=1, width=1, height=1,
            cassava_mask_key='a', rotten_mask_key='b', ppd_percent=2)
        recycle(image, self.user)
        impact = self.client.get(f'/api/images/{image.pk}/deletion-impact/').data
        self.assertEqual(impact, {'images': 1, 'predictions': 1, 'corrections': 1})
        self.assertEqual(self.client.post(f'/api/images/{image.pk}/purge/').status_code, 400)
        self.assertTrue(PredictionResult.objects.filter(pk=result.pk).exists())
        confirmed = self.client.post(f'/api/images/{image.pk}/purge/', {'confirm': 'PERMANENT_DELETE'}, format='json')
        self.assertEqual(confirmed.status_code, 200)
        self.assertFalse(CassavaImage.all_objects.filter(pk=image.pk).exists())

    def test_chunk_resume_and_partial_failure_are_durable(self):
        good = photo(capture=True); bad = b'not-an-image'
        response = self.client.post('/api/imports/', {'files': [{'path': '样本/第1天/a.jpg', 'size': len(good)}, {'path': '样本/bad.jpg', 'size': len(bad)}],
            'options': {'mode': 'new', 'name': '样本', 'source_kind': 'folder'}}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        job = response.data
        self.assertEqual(Folder.objects.get(pk=job['destination_folder']).name, '样本')
        for entry, content in zip(job['items'], [good, bad]):
            half = len(content)//2
            for offset, chunk in [(0, content[:half]), (half, content[half:])]:
                answer = self.client.post(f'/api/imports/{job["id"]}/items/{entry["id"]}/chunk/',
                    {'offset': offset, 'chunk': SimpleUploadedFile('chunk', chunk)}, format='multipart')
                self.assertEqual(answer.status_code, 200, answer.data)
            collision = self.client.post(f'/api/imports/{job["id"]}/items/{entry["id"]}/chunk/',
                {'offset': 0, 'chunk': SimpleUploadedFile('chunk', b'x')}, format='multipart')
            self.assertEqual(collision.status_code, 409)
        self.assertEqual(self.client.post(f'/api/imports/{job["id"]}/finalize/').status_code, 200)
        self.assertTrue(claim_next_job())
        stored = ImportJob.objects.get(pk=job['id'])
        self.assertEqual(stored.state, 'partial'); self.assertEqual(stored.summary['success'], 1); self.assertEqual(stored.summary['failed'], 1)
        image = CassavaImage.objects.get()
        self.assertEqual(image.folder.name, '第1天'); self.assertEqual(image.folder.parent.name, '样本')
        self.assertEqual(image.content_sha256, hashlib.sha256(good).hexdigest())

    def test_import_permissions_and_size_guard(self):
        other = User.objects.create_user('other')
        private = Folder.objects.create(owner=other, name='private')
        answer = self.client.post('/api/imports/', {'files': [{'path': 'a.jpg', 'size': 1}], 'target_folder': private.pk}, format='json')
        self.assertEqual(answer.status_code, 400)
        answer = self.client.post('/api/imports/', {'files': [{'path': '../a.jpg', 'size': 1}]}, format='json')
        self.assertEqual(answer.status_code, 400)
        answer = self.client.post('/api/imports/', {'files': [{'path': 'a.zip', 'size': 6*1024**3}]}, format='json')
        self.assertEqual(answer.status_code, 400)

    def test_manual_capture_time_records_provenance_without_changing_resolution(self):
        image, error = ImageService.upload_image(SimpleUploadedFile('no-exif.jpg', photo()), user=self.user)
        self.assertIsNone(error)
        self.assertIsNone(image.capture_time)
        answer = self.client.post('/api/images/capture-metadata/', {'image_ids': [image.pk], 'capture_time': '2026-10-29T10:30:00+08:00'}, format='json')
        self.assertEqual(answer.status_code, 200, answer.data)
        image.refresh_from_db()
        self.assertEqual(image.capture_time_source, 'manual')
        self.assertEqual(len(image.capture_time_history), 1)
        self.assertEqual((image.pixel_width, image.pixel_height), (40, 30))

    def test_completed_review_is_version_bound(self):
        result = PredictionResult.objects.create(owner=self.user, ppd_value=1, ppd_unit='percent')
        self.assertEqual(self.client.post(f'/api/predictions/{result.pk}/review/', {'version': 0}, format='json').status_code, 200)
        self.assertEqual(self.client.get(f'/api/predictions/{result.pk}/').data['measurement']['review_status'], 'reviewed')
        PredictionCorrection.objects.create(prediction=result, owner=self.user, version=1, width=1, height=1,
            cassava_mask_key='a', rotten_mask_key='b', ppd_percent=2)
        self.assertEqual(self.client.get(f'/api/predictions/{result.pk}/').data['measurement']['review_status'], 'unreviewed')
        self.assertEqual(self.client.post(f'/api/predictions/{result.pk}/review/', {'version': 0}, format='json').status_code, 409)

    def test_task_cancel_also_cancels_durable_import_and_list_is_compact(self):
        from predict.services.task import TaskService
        response = self.client.post('/api/imports/', {'files': [{'path': 'a.jpg', 'size': 1}]}, format='json')
        job_id = response.data['id']
        detailed = self.client.get(f'/api/imports/{job_id}/').data
        self.assertIn('chunk_hashes', detailed['items'][0])
        compact = self.client.get('/api/imports/').data
        self.assertEqual(compact[0]['items'], [])
        TaskService.cancel_task(ProcessingTask.objects.get(pk=response.data['task_id']))
        self.assertEqual(ImportJob.objects.get(pk=job_id).state, 'cancelled')

    def test_restore_name_conflict_preserves_both_image_identities(self):
        original = CassavaImage.objects.create(owner=self.user, name='same.jpg', oss_key='original')
        recycle(original, self.user)
        other = CassavaImage.objects.create(owner=self.user, name='same.jpg', oss_key='other')
        self.assertEqual(self.client.post(f'/api/images/{original.pk}/restore/').status_code, 200)
        original.refresh_from_db()
        self.assertNotEqual(original.name, other.name)
        self.assertEqual(CassavaImage.objects.count(), 2)

    def test_search_pagination_and_selection_have_the_same_scope(self):
        CassavaImage.objects.bulk_create([CassavaImage(owner=self.user, name=f'分页-{i:03d}', oss_key=f'image-{i}') for i in range(153)])
        page = self.client.get('/api/images/', {'search': '分页-', 'page': 2, 'page_size': 100}).data
        self.assertEqual(page['count'], 153)
        self.assertEqual(len(page['results']), 53)
        selection = self.client.get('/api/images/selection/', {'search': '分页-'}).data
        self.assertEqual(len(selection['image_ids']), 153)

    def test_task_search_summary_and_pagination_share_scope(self):
        ProcessingTask.objects.bulk_create([ProcessingTask(owner=self.user, name=f'匹配-{i}', type='upload', status='completed') for i in range(35)])
        ProcessingTask.objects.create(owner=self.user, name='其他任务', type='upload', status='failed')
        params = {'search': '匹配-', 'status': 'completed', 'page_size': 30, 'page': 2}
        page = self.client.get('/api/tasks/', params).data
        self.assertEqual(page['count'], 35)
        self.assertEqual(len(page['results']), 5)
        summary = self.client.get('/api/tasks/summary/', params).data
        self.assertEqual(summary['total'], 35)
        self.assertEqual(summary['completed'], 35)

    def test_result_list_summary_and_export_share_scope(self):
        for i, ppd in enumerate([1, 5, 8]):
            image = CassavaImage.objects.create(owner=self.user, name=f'case-{i}', oss_key='missing')
            PredictionResult.objects.create(owner=self.user, original_image=image, ppd_value=ppd, ppd_unit='percent')
        params = {'status': 'high'}
        self.assertEqual(self.client.get('/api/predictions/', params).data['count'], 1)
        summary = self.client.get('/api/predictions/summary/', params).data
        self.assertEqual(summary['total'], 1); self.assertEqual(summary['avg'], 8)
        exported = self.client.get('/api/predictions/export/', {**params, 'file_type': 'csv'})
        self.assertEqual(exported['X-Export-Count'], '1')
