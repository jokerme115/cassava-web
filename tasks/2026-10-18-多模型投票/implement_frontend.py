from pathlib import Path
root = Path(__file__).resolve().parents[2]
src = root / '网页/front/cassava_front/src'

p = src / 'components/PredictionModule.tsx'
s = p.read_text(encoding='utf-8-sig')
s = s.replace("  const [modelType, setModelType]", "  const [predictionMode, setPredictionMode] = useState<'single' | 'ensemble'>('single');\n  const [modelType, setModelType]", 1)
s = s.replace("label: 'DeepLabV3+ ResNet-101', description: t('prediction.models.resnet101')", "label: 'V1.0', description: '基础版本'", 1)
s = s.replace("label: 'M6 Best', description: t('prediction.models.m6_best')", "label: 'V1.1', description: '更新版本（精度待独立验证）'", 1)
s = s.replace("        modelType,\n        predictionMode: 'single',", "        modelType: predictionMode === 'ensemble' ? 'ensemble' : modelType,\n        predictionMode,", 1)
s = s.replace('        parameters: advancedParams,\n        single_model_type: modelType', "        parameters: { ...advancedParams, predictionMode, use_ensemble: predictionMode === 'ensemble' },\n        single_model_type: predictionMode === 'ensemble' ? 'ensemble' : modelType", 1)
s = s.replace("const baseTime = modelType === 'm6_best' ? 1.2 : 0.3;", "const baseTime = predictionMode === 'ensemble' ? 1.5 : modelType === 'm6_best' ? 1.2 : 0.3;", 1)
old = '''                  <button
                    id="prediction-mode"
                    className={`flex-1 px-2 py-1.5 sm:px-3 sm:py-2 rounded text-xs sm:text-sm transition-colors bg-white shadow-sm text-gray-900`}
                  >{t('prediction.mode.single')}</button>'''
new = '''                  {(['single', 'ensemble'] as const).map(mode => (
                    <button key={mode} id={mode === 'single' ? 'prediction-mode' : undefined}
                      type="button" aria-pressed={predictionMode === mode}
                      onClick={() => setPredictionMode(mode)}
                      className={`flex-1 px-2 py-1.5 sm:px-3 sm:py-2 rounded text-xs sm:text-sm transition-colors ${predictionMode === mode ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                      {mode === 'single' ? t('prediction.mode.single') : '多模型投票'}
                    </button>
                  ))}'''
assert old in s
s = s.replace(old, new, 1)
s = s.replace('                  value={modelType}', "                  disabled={predictionMode === 'ensemble'}\n                  value={modelType}", 1)
s = s.replace('                </select>\n              </div>\n\n              <div>\n                <div className="flex items-center justify-between mb-2">', '''                </select>
                {predictionMode === 'ensemble' && <div className="mt-3 rounded-lg bg-teal-50 p-3 text-sm text-teal-900">
                  <p className="font-medium">V1.0 + V1.1 · 等权投票</p>
                  <p className="mt-1 text-xs leading-5">两个模型分析同一切面，每个像素各投一票；1:1 时按平均病变概率裁决。结果保留各模型 PPD 和一致率，分歧供人工复核。一致率不是准确率，也不保证消除漏检。</p>
                </div>}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">''', 1)
s = s.replace("{modelType === 'm6_best' && (", "{(modelType === 'm6_best' || predictionMode === 'ensemble') && (", 1)
s = s.replace("<span className=\"font-medium\">{t('prediction.mode.single')}</span>", "<span className=\"font-medium\">{predictionMode === 'ensemble' ? '多模型投票' : t('prediction.mode.single')}</span>", 1)
s = s.replace("{modelOptions.find(m => m.value === modelType)?.label}", "{predictionMode === 'ensemble' ? 'V1.0 + V1.1' : modelOptions.find(m => m.value === modelType)?.label}", 1)
p.write_text(s, encoding='utf-8')

p = src / 'hooks/useTaskStore.ts'
s = p.read_text(encoding='utf-8-sig').replace('        batchSize,\n', '        batchSize,\n        predictionMode,\n', 1)
s = s.replace('          ...parameters,', "          ...parameters,\n          predictionMode: predictionMode ?? parameters?.predictionMode ?? 'single',", 1)
p.write_text(s, encoding='utf-8')

p = src / 'services/api.ts'
s = p.read_text(encoding='utf-8-sig')
s = "import { modelLabel } from '../utils/modelLabels';\n" + s
s = s.replace('    modelType:\n      task?.modelType ??', '    modelType: modelLabel(\n      task?.modelType ??', 1)
s = s.replace("      task?.single_model_type ??\n      '',", "      task?.single_model_type ??\n      ''),", 1)
p.write_text(s, encoding='utf-8')

p = src / 'types/index.ts'
s = p.read_text(encoding='utf-8-sig').replace('  vis_images?: Record<string, string>;', '''  ensemble_details?: {
    method: string;
    agreement_percent: number | null;
    disagreement_pixels: number;
    members: { model: string; label: string; ppd_percent: number | null }[];
  };
  vis_images?: Record<string, string>;''', 1)
p.write_text(s, encoding='utf-8')

p = src / 'components/ResultsCenter.tsx'
s = p.read_text(encoding='utf-8-sig')
anchor = '                  <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">\n                    <h4 className="text-sm font-semibold text-slate-900">模型原始分段 PPD</h4>'
new = '''                  {selectedResult.ensemble_details?.members?.length === 2 && (
                    <div className="rounded-[28px] border border-teal-200 bg-teal-50 p-5">
                      <h4 className="text-sm font-semibold text-teal-950">多模型投票评分</h4>
                      <div className="mt-3 space-y-2 text-sm">
                        {selectedResult.ensemble_details.members.map(member => <div key={member.model} className="flex justify-between"><span>{member.label} PPD</span><span>{formatPpd(member.ppd_percent)}</span></div>)}
                        <div className="flex justify-between border-t border-teal-200 pt-2"><span>模型一致率</span><span>{formatPpd(selectedResult.ensemble_details.agreement_percent)}</span></div>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-teal-800">一致率不代表准确率；分歧像素：{selectedResult.ensemble_details.disagreement_pixels}。分歧按平均病变概率裁决。以上为模型原始结果，人工校正后的最终 PPD 单独显示。</p>
                    </div>
                  )}

''' + anchor
assert anchor in s
s = s.replace(anchor,new,1)
p.write_text(s,encoding='utf-8')

p = root / '网页/back/cassavaBack/predict/result_export.py'
s = p.read_text(encoding='utf-8-sig')
s = s.replace('from .measurement import ', 'from .ensemble import LABELS\nfrom .measurement import ', 1)
s = s.replace("'预测参数', '数据状态']", "'预测参数', '数据状态', 'V1.0 PPD(%)', 'V1.1 PPD(%)', '模型一致率(非准确率%)', '投票明细']", 1)
s = s.replace('prediction.single_model_type, model_ppd,', 'LABELS.get(prediction.single_model_type, prediction.single_model_type), model_ppd,', 1)
s = s.replace("json.dumps(params, ensure_ascii=False), info['measurement_status']])", """json.dumps(params, ensure_ascii=False), info['measurement_status'],
                         *[next((m.get('ppd_percent') for m in (prediction.ensemble_details or {}).get('members', []) if m.get('model') == name), None) for name in ('resnet101', 'm6_best')],
                         (prediction.ensemble_details or {}).get('agreement_percent'),
                         json.dumps(prediction.ensemble_details or {}, ensure_ascii=False)])""", 1)
s = s.replace("            item['model_ppd'] = model_ppd", "            item['ensemble_details'] = prediction.ensemble_details or {}\n            item['model_ppd'] = model_ppd", 1)
p.write_text(s, encoding='utf-8')
