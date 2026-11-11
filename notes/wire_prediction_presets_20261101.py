from pathlib import Path
p=Path('网页/front/cassava_front/src/components/PredictionModule.tsx');s=p.read_text(encoding='utf-8')
s="import { getUserPreferences } from '../utils/userPreferences';\nimport { resolvePredictionParameters } from '../utils/predictionPresets';\nimport { saveUserPreferences } from '../services/preferences';\n"+s
s=s.replace("import { Tree, Modal }", "import { Tree, Modal, Input }")
s=s.replace("  const [predictionMode, setPredictionMode] = useState<'single' | 'ensemble'>('single');\n  const [modelType, setModelType] = useState('pbt_c512');", """  const preferences = getUserPreferences();
  const initialPreset = preferences.predictionPresets.find(p => p.id === preferences.defaultPredictionPreset);
  const [presetId, setPresetId] = useState(preferences.defaultPredictionPreset);
  const [predictionMode, setPredictionMode] = useState<'single' | 'ensemble'>(initialPreset?.mode || 'single');
  const [modelType, setModelType] = useState(initialPreset?.model || 'pbt_c512');
  const [savePresetOpen, setSavePresetOpen] = useState(false), [presetName, setPresetName] = useState('常用预测'), [presetSaving, setPresetSaving] = useState(false);""")
a=s.index('  const [advancedParams, setAdvancedParams] = useState({'); b=s.index('  useEffect(() => {',a)
s=s[:a]+"  const [advancedParams, setAdvancedParams] = useState(() => resolvePredictionParameters(initialPreset?.model || 'pbt_c512', initialPreset?.mode || 'single', initialPreset?.parameters));\n"+s[b:]
s=s.replace("setAdvancedParams(previous => ({ ...previous, confidenceThreshold: .5, stage1Confidence: .5, stage2Confidence: .5, usePostProcessing: false, useTTA: false, minArea: 0 }))", "setAdvancedParams(resolvePredictionParameters(modelType, predictionMode))")
s=s.replace("  useEffect(() => { void setImageSearchQuery(searchQuery); }, [searchQuery, selectedFolder]);", "  useEffect(() => { const timer = setTimeout(() => void setImageSearchQuery(searchQuery), 300); return () => clearTimeout(timer); }, [searchQuery, selectedFolder]);")
s=s.replace("`${t('prediction.task_name')}-${new Date().toLocaleString()}`", "`${getUserPreferences().taskNamePrefix.slice(0, 25)}-${new Date().toLocaleString()}`")
s=s.replace("parameters: { ...advancedParams, predictionMode, use_ensemble: predictionMode === 'ensemble' },", "parameters: { ...resolvePredictionParameters(modelType, predictionMode, advancedParams), predictionMode, use_ensemble: predictionMode === 'ensemble', preset_id: presetId || null, preset_version: preferences.predictionPresets.find(p => p.id === presetId)?.version || null },")
s=s.replace("    if (submittingRef.current) return;", "    if (submittingRef.current) return;\n    if (presetId && !preferences.predictionPresets.some(p => p.id === presetId)) { setError('默认预设已不存在，请重新选择配置'); return; }")
pos=s.index('  const buildTaskPayload')
s=s[:pos]+'''  const applyPreset = (id: string) => {
    const preset = preferences.predictionPresets.find(p => p.id === id);
    setPresetId(id); setModelType(preset?.model || 'pbt_c512'); setPredictionMode(preset?.mode || 'single');
    setAdvancedParams(resolvePredictionParameters(preset?.model || 'pbt_c512', preset?.mode || 'single', preset?.parameters)); setError(null);
  };
  const savePreset = async () => {
    const name = presetName.trim(); if (!name) return;
    if (preferences.predictionPresets.some(p => p.name === name)) { message.error('预设名称已存在，请换一个名称'); return; }
    setPresetSaving(true);
    try {
      await saveUserPreferences({ predictionPresets: [...preferences.predictionPresets, { id: crypto.randomUUID(), name, model: modelType, mode: predictionMode, version: 1, parameters: resolvePredictionParameters(modelType, predictionMode, advancedParams) }] });
      setSavePresetOpen(false); message.success('预设已保存');
    } catch (e: any) { message.error(e?.response?.data?.error || '预设保存失败，请刷新设置后重试'); } finally { setPresetSaving(false); }
  };
'''+s[pos:]
needle='            <div><label htmlFor="prediction-task-name"'
pos=s.index(needle)
s=s[:pos]+'''            <div><label htmlFor="prediction-preset" className="mb-2 block text-xs text-muted">预测预设</label><select id="prediction-preset" className="h-10 w-full rounded-lg border border-hairline bg-white px-2 text-sm" value={presetId} onChange={e => applyPreset(e.target.value)}><option value="">本次配置</option>{presetId && !preferences.predictionPresets.some(p => p.id === presetId) && <option value={presetId}>预设已不可用</option>}{preferences.predictionPresets.map(p => <option key={p.id} value={p.id}>{p.name} · v{p.version}</option>)}</select></div>
'''+s[pos:]
s=s.replace('onClick={() => setPredictionMode(mode)}', "onClick={() => { setPresetId(''); setPredictionMode(mode); }}")
s=s.replace('onChange={e => setModelType(e.target.value)}', "onChange={e => { setPresetId(''); setModelType(e.target.value); }}")
s=s.replace('<button onClick={() => setShowAdvanced(true)}', '<button onClick={() => setShowAdvanced(true)}')
s=s.replace('            <button onClick={() => setShowAdvanced(true)}', '            <button onClick={() => setSavePresetOpen(true)} className="text-sm text-accent-text">保存为个人预设</button>\n            <Modal title="保存预测预设" open={savePresetOpen} onCancel={() => setSavePresetOpen(false)} onOk={() => void savePreset()} confirmLoading={presetSaving} okText="保存"><Input aria-label="预测预设名称" value={presetName} maxLength={100} onChange={e => setPresetName(e.target.value)} /></Modal>\n            <button onClick={() => setShowAdvanced(true)}')
p.write_text(s,encoding='utf-8')
p=Path('网页/front/cassava_front/src/components/ImportWorkspace.tsx');s=p.read_text(encoding='utf-8').replace("setMode('new'); setName(", "setMode(getUserPreferences().importMode); setPreserve(getUserPreferences().preserveHierarchy); setName(");p.write_text(s,encoding='utf-8')
