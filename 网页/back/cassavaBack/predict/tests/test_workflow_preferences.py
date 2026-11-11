from django.contrib.auth.models import User
from rest_framework.test import APITestCase


class WorkflowPreferencesTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('preferences-user', password='Safe-Research-2026!')
        self.other = User.objects.create_user('preferences-other', password='Safe-Research-2026!')
        self.client.force_authenticate(self.user)

    def save(self, patch, etag=None):
        return self.client.post('/api/auth/profile/update/', {'preferences': patch, **({'preferences_etag': etag} if etag else {})}, format='json')

    def test_partial_categories_preserve_each_other(self):
        self.assertEqual(self.save({'brushSize': 35}).status_code, 200)
        reply = self.save({'listPageSize': 96, 'listGroup': 'month'})
        self.assertEqual(reply.status_code, 200)
        prefs = reply.data['profile']['preferences']
        self.assertEqual(prefs['brushSize'], 35)
        self.assertEqual(prefs['listPageSize'], 96)

    def test_concurrent_stale_editor_cannot_overwrite_settings(self):
        original = self.client.get('/api/auth/user/').data['profile']['preferences_etag']
        first = self.save({'listPageSize': 96}, original)
        self.assertEqual(first.status_code, 200)
        self.assertNotEqual(first.data['profile']['preferences_etag'], original)
        reply = self.save({'brushSize': 38}, original)
        self.assertEqual(reply.status_code, 409)
        prefs = self.client.get('/api/auth/user/').data['profile']['preferences']
        self.assertNotIn('brushSize', prefs)
        self.assertEqual(prefs['listPageSize'], 96)

    def test_preferences_sync_into_new_login_response_without_leaking_accounts(self):
        preset = {'id': 'trial', 'name': '科研常用', 'model': 'pbt_c512', 'mode': 'single', 'version': 1, 'parameters': {}}
        self.assertEqual(self.save({'predictionPresets': [preset], 'defaultPredictionPreset': 'trial'}).status_code, 200)
        self.assertEqual(self.client.get('/api/auth/user/').data['profile']['preferences']['predictionPresets'][0]['name'], '科研常用')
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get('/api/auth/user/').data['profile']['preferences'], {})

    def test_bad_ranges_and_wrong_types_are_rejected(self):
        for patch in [{'listPageSize': 999}, {'listPageSize': True}, {'editorResetZoom': 'yes'}, {'listGroup': 'unknown'}, {'predictionPresets': 'bad'}]:
            with self.subTest(patch=patch):
                self.assertEqual(self.save(patch).status_code, 400)

    def test_duplicate_names_and_invalid_prediction_fields_are_rejected(self):
        item = {'id': 'a', 'name': '重复', 'model': 'm6', 'mode': 'single', 'version': 1, 'parameters': {}}
        self.assertEqual(self.save({'predictionPresets': [item, {**item, 'id': 'b'}]}).status_code, 400)
        self.assertEqual(self.save({'predictionPresets': [{**item, 'parameters': {'executable': 'bad'}}]}).status_code, 400)

    def test_export_template_payload_must_have_safe_complete_style(self):
        self.assertEqual(self.save({'exportTemplates': [{'name': '论文', 'version': 1, 'style': {'cassava_color': '<script>'}}]}).status_code, 400)

    def test_composite_template_preserves_selected_content_order_and_layout(self):
        from predict.contour_export import export_style
        style = export_style({'stages': ['prediction', 'original'], 'stage_layout': 'columns'})
        response = self.save({'exportTemplates': [{'name': '对照图', 'version': 1, 'style': style}]})
        self.assertEqual(response.status_code, 200)
        saved = self.client.get('/api/auth/user/').data['profile']['preferences']['exportTemplates'][0]['style']
        self.assertEqual(saved['stages'], ['prediction', 'original'])
        self.assertEqual(saved['stage_layout'], 'columns')

    def test_invalid_batch_is_atomic_with_profile_changes(self):
        reply = self.client.post('/api/auth/profile/update/', {'email': 'updated@example.test', 'preferences': {'listPageSize': 999}}, format='json')
        self.assertEqual(reply.status_code, 400)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, '')
