import tempfile
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image
from django.test import SimpleTestCase

from predict.ensemble import METHOD, vote_probabilities, voting_summary
from predict.services import DeepLabV3PlusService, PredictionService


class VotingTests(SimpleTestCase):
    def test_disagreement_uses_probability_and_exact_tie_is_negative(self):
        first = np.array([[.9, .51, .9, .8, .1]])
        second = np.array([[.2, 0, .1, .8, .2]])
        mask, mean, disagreement = vote_probabilities([first, second], .5)
        np.testing.assert_array_equal(mask, [[1, 0, 0, 1, 0]])
        self.assertEqual(int(disagreement.sum()), 3)
        self.assertAlmostEqual(float(mean[0, 0]), .55)

    def test_background_is_excluded_from_agreement_and_empty_area_is_unknown(self):
        support = np.array([[1, 1, 0, 0]])
        masks = {'resnet101': support, 'm6_best': support * 0}
        report = voting_summary(support, masks, np.array([[0, 1, 1, 1]]))
        self.assertEqual(report['agreement_percent'], 50)
        self.assertEqual([m['ppd_percent'] for m in report['members']], [100, 0])
        self.assertIsNone(voting_summary(support * 0, masks, support)['agreement_percent'])

    def test_bad_or_missing_probability_maps_fail_instead_of_single_model_fallback(self):
        for maps in ([np.zeros((2, 2))], [np.zeros((2, 2)), np.zeros((3, 3))],
                     [np.zeros((2, 2)), np.full((2, 2), np.nan)],
                     [np.zeros((2, 2)), np.full((2, 2), 1.1)]):
            with self.assertRaises(ValueError):
                vote_probabilities(maps, .5)

    def test_voting_uses_pixels_rather_than_average_of_member_ppd(self):
        service = DeepLabV3PlusService()
        support = np.ones((2, 2), np.uint8)
        first = np.array([[.9, .9], [0, 0]], np.float32)
        second = np.array([[.2, 0], [.9, 0]], np.float32)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'crop.png'
            Image.new('RGB', (2, 2)).save(path)
            with patch.object(service, 'predict_ppd', return_value=(50, None, support, support, first)) as v1, patch.object(
                service, 'predict_ppd_m6', return_value=(25, None, support, support, second)
            ) as v2, patch.object(service, 'get_cassava_area_mask', return_value=support):
                output = service.predict_ppd_voting(object(), str(path), use_post_processing=False)
            self.assertEqual(output[0], 25)
            self.assertEqual([m['ppd_percent'] for m in output[5]['summary']['members']], [50, 25])
            self.assertEqual(output[5]['summary']['agreement_percent'], 25)
            self.assertFalse(v1.call_args.kwargs['use_post_processing'])
            self.assertFalse(v2.call_args.kwargs['use_post_processing'])

    def test_flat_and_nested_mode_select_both_models(self):
        for params in ({'single_model_type': 'ensemble'}, {'parameters': {'predictionMode': 'ensemble'}}):
            parsed = PredictionService._parse_prediction_params(params)
            self.assertTrue(parsed['use_ensemble'])
            self.assertEqual(parsed['single_model_type'], 'ensemble')
            self.assertEqual(parsed['ensemble_method'], METHOD)
