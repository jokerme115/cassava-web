from pathlib import Path

root = Path(__file__).resolve().parents[2]
p = root / '网页/back/cassavaBack/predict/services.py'
s = p.read_text(encoding='utf-8-sig')

def replace(old, new):
    global s
    assert old in s, old[:120]
    s = s.replace(old, new, 1)

replace('from .m6_predictor import m6_best_predictor', 'from .m6_predictor import m6_best_predictor\nfrom .ensemble import MEMBERS, LABELS, METHOD, vote_probabilities, voting_summary')
replace('def prediction_provenance(model_name):\n', '''def prediction_provenance(model_name):
    if model_name == 'ensemble':
        files = [item for member in MEMBERS for item in prediction_provenance(member)]
        return list({item['file']: item for item in files}.values())
''')
anchor = '    def get_cassava_area_mask(self, image):'
replace(anchor, '''    def predict_ppd_voting(self, model, image_path, confidence_threshold=0.5,
                           min_area=100, morph_kernel_size=5, morph_iterations=1,
                           patch_size=(512, 512), stride=(256, 256), overlay_opacity=0.45,
                           use_post_processing=True, use_tta=False):
        # Both members see the exact same detected crop. Fuse probabilities before filtering.
        first = self.predict_ppd(model, image_path, confidence_threshold=confidence_threshold,
            return_masks=True, use_post_processing=False, use_tta=use_tta)
        second = self.predict_ppd_m6(image_path, confidence_threshold=confidence_threshold,
            patch_size=patch_size, stride=stride, return_masks=True,
            use_post_processing=False, use_tta=use_tta)
        rgb = np.asarray(ImageOps.exif_transpose(Image.open(image_path)).convert('RGB'))
        h, w = rgb.shape[:2]
        probabilities = [cv2.resize(np.asarray(item[4], dtype=np.float32), (w, h),
                                   interpolation=cv2.INTER_LINEAR) for item in (first, second)]
        voted, mean, disagreement = vote_probabilities(probabilities, confidence_threshold)
        cassava = self.get_cassava_area_mask(rgb) > 0

        def filtered(mask):
            if use_post_processing:
                mask = post_process_mask(mask, min_area, morph_kernel_size, morph_iterations)
            return ((mask > 0) & cassava).astype(np.uint8)

        rotten = filtered(voted)
        member_masks = {name: filtered((probability > confidence_threshold).astype(np.uint8))
                        for name, probability in zip(MEMBERS, probabilities)}
        _, rotten, _, _, ppd = calculate_mask_metrics(cassava, rotten)
        overlay = rgb.copy()
        lesion = rotten > 0
        overlay[lesion] = rgb[lesion] * (1 - overlay_opacity) + np.array([255, 0, 0]) * overlay_opacity
        details = voting_summary(cassava, member_masks, disagreement)
        return (ppd, Image.fromarray(overlay), cassava.astype(np.uint8), rotten.astype(np.uint8), mean,
                {'summary': details, 'member_masks': member_masks, 'disagreement': disagreement})

''' + anchor)
start = s.index('            # 加载PPD预测模型\n', s.index('    def integrated_prediction('))
end = s.index('            else:\n                model_path_map', start)
s = s[:start] + '''            # Voting uses both configured real checkpoints; never silently drops a member.
            if use_ensemble:
                if ensemble_method != METHOD:
                    raise ValueError('不支持的投票方法')
                path = resolve_existing_model_path(getattr(settings, 'DEEPLABV3_RESNET101_PATH', None))
                if not path:
                    raise ValueError('V1.0权重不存在，不能生成双模型投票结果')
                model = self.load_model(path, model_type='deeplabv3plus_resnet101')
            elif single_model_type == 'm6_best':
                model = 'm6_best'
''' + s[end:]
start = s.index('            # 执行PPD预测\n', s.index('    def integrated_prediction('))
prefix, rest = s[:start], s[start:]
rest = rest.replace("                    if single_model_type == 'm6_best':", '''                    voting = None
                    if use_ensemble:
                        prediction_output = self.predict_ppd_voting(
                            model, seg2_image_path, confidence_threshold, min_area,
                            morph_kernel_size, morph_iterations, patch_size, stride,
                            overlay_opacity, use_post_processing, use_tta)
                        voting = prediction_output[5]
                    elif single_model_type == 'm6_best':''', 1)
rest = rest.replace('ppd, overlay_image, cassava_mask, rotten_mask, confidence_map = prediction_output', 'ppd, overlay_image, cassava_mask, rotten_mask, confidence_map = prediction_output[:5]', 1)
rest = rest.replace('                    "ppd": ppd,', '                    "voting": voting,\n                    "ppd": ppd,', 1)
rest = rest.replace('            has_confidence_map = False', '''            full_member_masks = {name: np.zeros_like(full_rotten_mask) for name in MEMBERS} if use_ensemble else {}
            full_disagreement = np.zeros_like(full_rotten_mask) if use_ensemble else None
            has_confidence_map = False''', 1)
rest = rest.replace('                target_size = (x2 - x1, y2 - y1)', '''                target_size = (x2 - x1, y2 - y1)
                if use_ensemble:
                    voting = prediction['voting']
                    for name, mask in {**voting['member_masks'], '_disagreement': voting['disagreement']}.items():
                        resized = cv2.resize(mask.astype(np.uint8), target_size, interpolation=cv2.INTER_NEAREST)
                        full = full_disagreement if name == '_disagreement' else full_member_masks[name]
                        full[y1:y2, x1:x2] = np.maximum(full[y1:y2, x1:x2], resized)''', 1)
rest = rest.replace('            return {\n                "success": True,', '''            ensemble_details = voting_summary(full_cassava_mask, full_member_masks, full_disagreement) if use_ensemble else {}
            if use_ensemble:
                ensemble_details['segments'] = [p['voting']['summary'] for p in all_predictions]
            return {
                "ensemble_details": ensemble_details,
                "success": True,''', 1)
s = prefix + rest
replace("ensemble_method='weighted_average', \n                            ensemble_weights=None,\n                            single_model_type='resnet101'", "ensemble_method=METHOD, \n                            ensemble_weights=None,\n                            single_model_type='resnet101'")
# Resolve ensemble mode once; external names are labels while stable model IDs remain traceable.
replace("        return {\n            'confidence': float(advanced.get('confidenceThreshold'", """        model_name = str(advanced.get('single_model_type') or advanced.get('modelType') or 'resnet101')
        use_ensemble = model_name == 'ensemble' or read_bool(
            advanced.get('use_ensemble'), advanced.get('predictionMode') == 'ensemble')
        if use_ensemble:
            model_name = 'ensemble'
        return {
            'confidence': float(advanced.get('confidenceThreshold'""")
replace("""            'use_ensemble': read_bool(
                params.get('use_ensemble'),
                params.get('predictionMode') == 'ensemble',
                default=False
            ),
            'single_model_type': str(
                advanced.get('single_model_type') or advanced.get('modelType') or 'resnet101'
            ),
            'model_label': str(
                advanced.get('single_model_type') or advanced.get('modelType') or 'resnet101'
            ),""", """            'use_ensemble': use_ensemble,
            'ensemble_method': METHOD if use_ensemble else None,
            'single_model_type': model_name,
            'model_label': LABELS.get(model_name, model_name),""")
replace("            is_ensemble=prediction_params.get('use_ensemble', False),", """            is_ensemble=prediction_params.get('use_ensemble', False),
            ensemble_method=prediction_params.get('ensemble_method'),
            ensemble_details=result.get('ensemble_details') or {},""")
replace("                        use_ensemble=prediction_params['use_ensemble'],", """                        use_ensemble=prediction_params['use_ensemble'],
                        ensemble_method=prediction_params.get('ensemble_method') or METHOD,""")
p.write_text(s, encoding='utf-8')
