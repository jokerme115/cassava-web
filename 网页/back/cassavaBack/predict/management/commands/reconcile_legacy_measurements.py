"""Reconcile only an operator-supplied, snapshot-verified legacy database."""
import hashlib
import json
import math
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from predict.models import PredictionResult, ProcessingTask


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument('baseline')
        parser.add_argument('--apply', action='store_true')

    @transaction.atomic
    def handle(self, *args, **options):
        payload = Path(options['baseline']).read_bytes()
        baseline = json.loads(payload)
        digest = hashlib.sha256(payload).hexdigest()
        records = list(PredictionResult.objects.select_for_update().filter(
            pk__in=[r['id'] for r in baseline['results']]))
        by_id = {r.pk: r for r in records}
        verified = 0
        for old in baseline['results']:
            obj = by_id.get(old['id'])
            if obj is None:
                raise CommandError(f"Missing historical result {old['id']}")
            for field in ('ppd_value', 'sub_ppd_values', 'owner_id', 'original_image_id',
                          'processing_task_id', 'oss_key', 'single_model_type'):
                if getattr(obj, field) != old[field]:
                    raise CommandError(f'Historical result {obj.pk} differs: {field}')
            if str(obj.result_image) != old['result_image']:
                raise CommandError(f'Historical result {obj.pk} image differs')
            subs = old['sub_ppd_values']
            known = (isinstance(subs, list) and bool(subs)
                     and all(type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 100 for v in subs)
                     and math.isclose(sum(subs) / len(subs), old['ppd_value'], abs_tol=1e-10))
            verified += int(known)
            if options['apply']:
                details = dict(obj.ensemble_details or {})
                details['legacy_measurement'] = {
                    'protocol': 'legacy_slice_mean' if known else 'legacy_unverified',
                    'raw_value': old['ppd_value'], 'unit': 'percent' if known else 'unknown',
                    'source_commit': baseline['source_commit'], 'baseline_sha256': digest,
                }
                obj.ensemble_details = details
                obj.ppd_unit = 'percent' if known else 'unknown'
                obj.save(update_fields=['ensemble_details', 'ppd_unit'])
        for old in baseline['tasks']:
            current = ProcessingTask.objects.filter(pk=old['id']).values().first()
            if not current or any(current[k] != value for k, value in old.items() if k in current):
                raise CommandError(f"Historical task {old['id']} differs")
        self.stdout.write(json.dumps({'applied': options['apply'], 'results': len(records),
            'legacy_slice_mean': verified, 'legacy_unverified': len(records) - verified,
            'baseline_sha256': digest}))
