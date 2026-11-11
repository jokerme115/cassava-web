from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from PIL import Image
from django.test import SimpleTestCase
from predict.contour_export import export_style, figure_png, panels, export_rotation
from predict.user_preferences import validate_style
from rest_framework.exceptions import ValidationError


class CompositeExportTests(SimpleTestCase):
    def start_patch(self, patcher):
        value = patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def setUp(self):
        source = Image.new('RGB', (90, 30), '#402010')
        data = BytesIO(); source.save(data, 'PNG')
        self.source = data.getvalue()
        self.prediction = SimpleNamespace(original_image=SimpleNamespace(oss_key='original.png', name='test.png'))
        self.segments = [{'bbox': [i*30, 0, (i+1)*30, 30], 'ppd_percent': 5.0} for i in range(3)]
        mask = np.ones((30,90), dtype=bool)
        lesion = np.zeros_like(mask); lesion[10:15, 10:15] = True
        self.start_patch(patch('predict.contour_export.read_storage_bytes', return_value=self.source))
        self.start_patch(patch('predict.contour_export.measurement_masks', return_value=(mask,lesion,2700,25,25/27)))
        self.segment_mock = self.start_patch(patch('predict.contour_export.segment_measurements', return_value=self.segments))

    def test_one_png_combines_all_stages_and_respects_layout(self):
        style = export_style({'panel_width':128, 'padding':4, 'stages':['original','yolo','prediction']})
        vertical = Image.open(BytesIO(figure_png(self.prediction, style=style)))
        horizontal = Image.open(BytesIO(figure_png(self.prediction, style={**style,'stage_layout':'columns'})))
        self.assertGreater(horizontal.width, vertical.width)
        self.assertGreater(vertical.height, horizontal.height)

    def test_yolo_crops_have_no_prediction_contours_or_fill(self):
        style = export_style({'panel_width':128, 'cassava_fill':True, 'rotten_fill':True})
        raw = panels(self.prediction,None,style,annotated=False,require_segments=True)
        annotated = panels(self.prediction,None,style)
        self.assertEqual(len(raw),3)
        self.assertEqual(raw[0][0].getpixel((64,64)), (64,32,16))
        self.assertNotEqual(raw[0][0].getpixel((64,64)),annotated[0][0].getpixel((64,64)))

    def test_original_only_does_not_require_masks_or_yolo_coordinates(self):
        with patch('predict.contour_export.measurement_masks',side_effect=ValueError('missing masks')):
            image = Image.open(BytesIO(figure_png(self.prediction,style={'stages':['original'],'panel_width':128})))
        self.assertEqual(image.size,(128,43))

    def test_missing_yolo_coordinates_fails_explicitly(self):
        self.segment_mock.return_value = []
        with self.assertRaisesMessage(ValueError,'YOLO'):
            figure_png(self.prediction,style={'stages':['yolo']})

    def test_stage_order_changes_the_composite(self):
        style={'panel_width':128,'stages':['original','prediction'],'stage_layout':'columns'}
        a=figure_png(self.prediction,style=style)
        b=figure_png(self.prediction,style={**style,'stages':['prediction','original']})
        self.assertNotEqual(a,b)

    def test_template_validation_and_legacy_default(self):
        self.assertEqual(export_style()['stages'],['prediction'])
        validate_style(export_style({'stages':['original','prediction']}))
        for stages in ([],['original','original'],['invalid']):
            with self.assertRaises(ValueError): export_style({'stages':stages})
            with self.assertRaises(ValidationError): validate_style({**export_style(),'stages':stages})

    def test_portrait_source_and_both_crop_groups_share_landscape_orientation(self):
        source = Image.new('RGB', (30,90), 'blue')
        source.paste(Image.new('RGB',(30,45),'red'),(0,0))
        data=BytesIO(); source.save(data,'PNG')
        mask=np.ones((90,30),dtype=bool)
        segments=[{'bbox':[0,0,30,90],'ppd_percent':5.0}]
        with patch('predict.contour_export.read_storage_bytes',return_value=data.getvalue()), patch('predict.contour_export.measurement_masks',return_value=(mask,np.zeros_like(mask),2700,0,0)), patch('predict.contour_export.segment_measurements',return_value=segments):
            original=Image.open(BytesIO(figure_png(self.prediction,style={'stages':['original'],'panel_width':128})))
            self.assertGreater(original.width,original.height)
            self.assertEqual(original.getpixel((16,20)),(0,0,255))
            self.assertEqual(original.getpixel((112,20)),(255,0,0))
            for annotated in (False,True):
                result=panels(self.prediction,None,export_style({'panel_width':128,'cassava_line_width':0,'rotten_line_width':0}),annotated=annotated)
                self.assertEqual(result[0][0].getpixel((16,64)),(0,0,255))
                self.assertEqual(result[0][0].getpixel((112,64)),(255,0,0))
                self.assertEqual(result[0][1],5.0)

    def test_saved_rotation_is_applied_before_landscape_normalization(self):
        landscape=Image.new('RGB',(90,30))
        square=Image.new('RGB',(30,30))
        self.assertEqual(export_rotation(landscape),0)
        self.assertEqual(export_rotation(square),0)
        self.assertEqual(export_rotation(landscape,SimpleNamespace(edit_data={'rotation_degrees':90})),180)
