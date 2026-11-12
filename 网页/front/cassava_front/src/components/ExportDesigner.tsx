import { message } from '../utils/feedback';
import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Select, Tooltip } from 'antd';
import { Download } from 'lucide-react';
import api from '../services/rest/client';
import { predictionsApi } from '../services/api';
import { getUserPreferences } from '../utils/userPreferences';
import { referenceStyle as defaults, type FigureStyle } from '../utils/exportStyle';
import FigureStyleFields from './FigureStyleFields';
import type { PredictionResult } from '../types';
export type { FigureStyle } from '../utils/exportStyle';

type ExportFilters = { task_id?: string; search?: string; status?: string; review_status?: string; style?: string; version?: string; result_ids?: string };
export default function ExportDesigner({ prediction, count, filters, onExport, exporting, canExport = true }: {
  prediction?: PredictionResult | null; count: number; filters: ExportFilters;
  onExport: (type: 'csv' | 'xlsx' | 'zip', filters: ExportFilters) => Promise<void>; exporting: boolean;
  /** 无 export_prediction 权限时按钮置灰并说明原因，避免点了才报 403 */
  canExport?: boolean;
}) {
  const [open, setOpen] = useState(false), [style, setStyle] = useState<FigureStyle>(defaults);
  const [version, setVersion] = useState('latest'), [scope, setScope] = useState('filtered');
  const [preview, setPreview] = useState(''), [error, setError] = useState('');
  const [versions, setVersions] = useState<Array<{ version: number }>>([]);
  const [selectedTemplate, setSelectedTemplate] = useState(''), [missingTemplate, setMissingTemplate] = useState(false);
  const [format, setFormat] = useState<'csv' | 'xlsx' | 'zip'>('zip'), [adjusting, setAdjusting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const templates = getUserPreferences().exportTemplates;
  useEffect(() => {
    if (!open) return;
    const prefs = getUserPreferences(), chosen = prefs.exportTemplates.find(t => t.name === prefs.defaultExportTemplate);
    setSelectedTemplate(prefs.defaultExportTemplate); setMissingTemplate(!!prefs.defaultExportTemplate && !chosen);
    setStyle(chosen ? { ...defaults, ...chosen.style, stages: chosen.style.stages || ['prediction'] } : defaults); setAdjusting(false); setScope('filtered'); setVersion('latest');
    setError('');
    let active = true;
    if (prediction) void predictionsApi.getCorrections(prediction.id).then(data => { if (active) setVersions(data); }).catch(() => { if (active) setVersions([]); });
    return () => { active = false; };
  }, [open, prediction?.id]);
  useEffect(() => {
    if (!open || !prediction || missingTemplate) return;
    let active = true, url = '';
    const controller = new AbortController();
    setPreview(''); setPreviewLoading(true);
    const timer = window.setTimeout(() => {
      api.get(`/predictions/${prediction.id}/figure/`, { params: { style: JSON.stringify(style), version }, responseType: 'blob', signal: controller.signal })
        .then(response => { if (active) { url = URL.createObjectURL(response.data); setPreview(url); setError(''); } })
        .catch(async caught => {
          if (!active || controller.signal.aborted) return;
          let text = '预览失败，请检查版本与原图';
          try { const body = JSON.parse(await caught.response.data.text()); text = body.error || text; } catch { /* use fallback */ }
          if (active) setError(text);
        }).finally(() => { if (active) setPreviewLoading(false); });
    }, 350);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [open, prediction?.id, style, version, missingTemplate]);
  const chooseTemplate = (name: string) => {
    setSelectedTemplate(name); setMissingTemplate(false); setAdjusting(false);
    setStyle(templates.find(t => t.name === name)?.style || defaults);
  };
  const exportFilters = { ...filters, style: JSON.stringify(style), version,
    ...(scope === 'current' && prediction ? { result_ids: String(prediction.id) } : {}) };
  const submit = async () => {
    if (missingTemplate) { message.error('请选择可用模板'); return; }
    await onExport(format, exportFilters);
  };
  return <><Tooltip title={canExport ? '' : '当前账号无此权限'}><span className="inline-flex"><Button icon={<Download size={15} />} disabled={!prediction || !canExport} onClick={() => setOpen(true)}>导出</Button></span></Tooltip>
    <Modal title="导出" centered open={open} onCancel={() => { if (!exporting) setOpen(false); }} width={Math.min(1040, window.innerWidth)}
      styles={{ body: { maxHeight: 'min(72vh, calc(100dvh - 200px))', overflowY: 'auto' } }}
      footer={<div className="flex items-center justify-end gap-3"><span className="mr-auto text-xs text-muted">{scope === 'current' ? 1 : count} 条 · {version === 'latest' ? '最新修订优先' : version === 'model' ? '模型原预测' : `修订 v${version}`}</span><Button disabled={exporting} onClick={() => setOpen(false)}>取消</Button><Button type="primary" icon={<Download size={15} />} loading={exporting} disabled={missingTemplate || (format === 'zip' && (previewLoading || !!error))} onClick={() => void submit()}>导出</Button></div>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-h-56 min-w-0 items-center justify-center rounded-xl border border-hairline bg-surface-muted p-3">
          {missingTemplate ? <Alert type="warning" message="默认模板已不可用，请选择模板或使用参考样式" action={<Button onClick={() => chooseTemplate('')}>使用参考样式</Button>} /> : error ? <Alert type="error" message={error} /> : preview ? <img src={preview} alt="PPD轮廓导出预览" className="max-h-[56vh] w-full object-contain" /> : <p className="text-sm text-muted">正在生成预览…</p>}
        </div>
        <div className="space-y-4">
          <label className="block text-sm">导出范围<Select aria-label="导出范围" className="mt-2 w-full" value={scope} onChange={value => { setScope(value); setVersion('latest'); }} options={[{ value: 'filtered', label: `当前筛选全部 ${count} 条` }, { value: 'current', label: '仅当前预览图片' }]} /></label>
          <label className="block text-sm">结果版本<Select aria-label="结果版本" className="mt-2 w-full" value={version} onChange={setVersion} options={[{ value: 'latest', label: '最新修订优先，无修订用模型' }, { value: 'model', label: '模型原预测' }, ...(scope === 'current' ? versions.map(item => ({ value: String(item.version), label: `人工修订 v${item.version}` })) : [])]} /></label>
          <label className="block text-sm">图片模板<Select aria-label="图片模板" className="mt-2 w-full" value={selectedTemplate} onChange={chooseTemplate} options={[{ value: '', label: '参考图样式' }, ...(missingTemplate ? [{ value: selectedTemplate, label: '默认模板不可用', disabled: true }] : []), ...templates.map(t => ({ value: t.name, label: `${t.name} · v${t.version}` }))]} /></label>
          <label className="block text-sm">文件格式<Select aria-label="文件格式" className="mt-2 w-full" value={format} onChange={setFormat} options={[{ value: 'zip', label: '图像与掩码 ZIP' }, { value: 'csv', label: 'CSV' }, { value: 'xlsx', label: 'Excel' }]} /></label>
          <div className="flex justify-between border-t border-hairline pt-3 text-sm"><button onClick={() => setAdjusting(v => !v)} className="text-accent-text">{adjusting ? '收起样式' : '调整本次样式'}</button><a className="text-accent-text" href="/profile?tab=export-templates" target="_blank" rel="noreferrer">模板管理 ↗</a></div>
          {adjusting && <FigureStyleFields value={style} onChange={setStyle} />}
        </div>
      </div>
    </Modal>
  </>;
}
