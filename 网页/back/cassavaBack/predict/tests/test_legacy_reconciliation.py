import json
import tempfile
from io import StringIO
from pathlib import Path
from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from predict.models import PredictionResult
from predict.measurement import measurement_info


class LegacyReconciliationTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('legacy-test')
        self.result = PredictionResult.objects.create(owner=self.user, ppd_value=5,
            ppd_unit='unknown', result_image='legacy.jpg', sub_ppd_values=[4, 6])

    def run_reconciliation(self, apply=False, changed=False):
        obj = self.result
        fields = ('id', 'ppd_value', 'sub_ppd_values', 'owner_id', 'original_image_id',
                  'processing_task_id', 'oss_key', 'single_model_type')
        row = {f: getattr(obj, f) for f in fields}
        row['result_image'] = str(obj.result_image)
        if changed:
            row['ppd_value'] = 9
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'baseline.json'
            path.write_text(json.dumps({'results': [row], 'tasks': [], 'source_commit': 'frozen-legacy'}))
            call_command('reconcile_legacy_measurements', str(path), *(['--apply'] if apply else []), stdout=StringIO())
        obj.refresh_from_db()

    def test_dry_run_does_not_write(self):
        self.run_reconciliation()
        self.assertEqual(self.result.ppd_unit, 'unknown')
        self.assertEqual(self.result.ensemble_details, {})

    def test_verified_slice_mean_keeps_raw_number_and_protocol(self):
        self.run_reconciliation(apply=True)
        self.assertEqual(self.result.ppd_value, 5)
        self.assertEqual(self.result.sub_ppd_values, [4, 6])
        info = measurement_info(self.result)
        self.assertEqual(info['final_ppd'], 5)
        self.assertEqual(info['protocol'], 'legacy_slice_mean')

    def test_missing_slice_evidence_does_not_guess_unit(self):
        self.result.sub_ppd_values = []
        self.result.save()
        self.run_reconciliation(apply=True)
        info = measurement_info(self.result)
        self.assertIsNone(info['final_ppd'])
        self.assertEqual(info['legacy_raw_value'], 5)
        self.assertEqual(info['protocol'], 'legacy_unverified')

    def test_changed_source_aborts(self):
        with self.assertRaises(CommandError):
            self.run_reconciliation(apply=True, changed=True)
        self.result.refresh_from_db()
        self.assertEqual(self.result.ppd_unit, 'unknown')
        self.assertEqual(self.result.ensemble_details, {})
