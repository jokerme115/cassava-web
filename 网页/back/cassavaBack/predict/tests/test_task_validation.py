"""创建预测任务时的模型参数校验。

背景：以前任何模型名都能创建成功（201），几秒后后台异步失败，前端只看到
「任务执行失败，请重试或联系管理员」，既不知道原因也没法自助修正。
"""

import shutil
import tempfile

from django.conf import settings
from django.contrib.auth.models import User
from django.test import SimpleTestCase, override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from predict.models import CassavaImage, ProcessingTask
from predict.services import describe_prediction_failure


class ProcessingTaskModelValidationTests(APITestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.media_root = tempfile.mkdtemp(prefix='cassava-task-validation-')
        cls.settings_override = override_settings(
            MEDIA_ROOT=cls.media_root, PREDICTION_TASKS_DISABLED=True,
        )
        cls.settings_override.enable()

    @classmethod
    def tearDownClass(cls):
        cls.settings_override.disable()
        shutil.rmtree(cls.media_root, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_superuser('task-validation-admin', password='test-pass')
        self.client.force_authenticate(self.user)
        self.image = CassavaImage.objects.create(
            name='sample.png', oss_key='images/sample.png', owner=self.user,
        )

    def create_task(self, **overrides):
        payload = {
            'name': '校验用例',
            'type': 'prediction',
            'algorithm': 'resnet101',
            'single_model_type': 'resnet101',
            'threshold': 0.5,
            'min_size': 100,
            'split_count': 1,
            'image_ids': [self.image.id],
        }
        payload.update(overrides)
        return self.client.post('/api/tasks/', payload, format='json')

    def test_unknown_model_is_rejected_before_queueing(self):
        response = self.create_task(algorithm='deeplabv3plus_resnet101', single_model_type='deeplabv3plus_resnet101')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        detail = str(response.data)
        self.assertIn('不支持的预测模型', detail)
        self.assertIn('resnet101', detail)
        self.assertEqual(ProcessingTask.objects.count(), 0)

    def test_known_model_without_weights_is_rejected(self):
        if 'resnet50' in getattr(settings, 'AVAILABLE_DEEPLAB_MODEL_KEYS', []):
            self.skipTest('本机已具备 resnet50 权重，无法构造缺失场景')

        response = self.create_task(algorithm='resnet50', single_model_type='resnet50')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('权重文件缺失', str(response.data))
        self.assertEqual(ProcessingTask.objects.count(), 0)

    def test_single_model_type_is_validated_too(self):
        response = self.create_task(single_model_type='随便写的模型')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('single_model_type', str(response.data))

    def test_model_key_is_normalized_to_lowercase(self):
        response = self.create_task(algorithm='ResNet101', single_model_type='ResNet101')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        task = ProcessingTask.objects.get(id=response.data['id'])
        self.assertEqual(task.algorithm, 'resnet101')
        self.assertEqual(task.single_model_type, 'resnet101')

    def test_bogus_model_on_update_is_rejected(self):
        created = self.create_task()
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)

        response = self.client.patch(
            f'/api/tasks/{created.data["id"]}/', {'algorithm': 'nope'}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('不支持的预测模型', str(response.data))


class PredictionFailureMessageTests(SimpleTestCase):
    """失败原因要能说人话，而不是统一一句「请重试或联系管理员」。"""

    def test_unknown_model_error_surfaces_its_own_reason(self):
        text = describe_prediction_failure(ValueError('不支持的预测模型'))

        self.assertIn('不支持的预测模型', text)
        self.assertNotIn('联系管理员', text)

    def test_memory_error_is_translated(self):
        text = describe_prediction_failure(RuntimeError('CUDA out of memory. Tried to allocate 2.00 GiB'))

        self.assertIn('内存不足', text)
        self.assertIn('减少单次提交的图片数量', text)

    def test_missing_file_is_explained(self):
        text = describe_prediction_failure(FileNotFoundError('images/1/a.jpg'))

        self.assertIn('找不到所需的文件', text)

    def test_unknown_exception_keeps_class_name_and_message(self):
        text = describe_prediction_failure(KeyError('ppd_unit'))

        self.assertIn('KeyError', text)
        self.assertIn('ppd_unit', text)
