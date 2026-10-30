import { message } from '../utils/feedback';
import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Input, InputNumber, Select, Slider, Switch } from 'antd';
import { Download, SlidersHorizontal } from 'lucide-react';
import api from '../services/rest/client';
import { predictionsApi } from '../services/api';
import { workspaceStorageKey } from '../utils/workspaceContext';
import type { PredictionResult } from '../types';

export interface FigureStyle {
  cassava_color: string; rotten_color: string; cassava_line_width: number; rotten_line_width: number;
  cassava_fill: boolean; rotten_fill: boolean; cassava_opacity: number; rotten_opacity: number;
  font_size: number; show_ppd: boolean; show_filename: boolean; columns: number; padding: number; panel_width: number; collage: boolean;
}
const defaults: FigureStyle = { cassava_color: '#34d9cf', rotten_color: '#ff5b7f', cassava_line_width: 2, rotten_line_width: 2,
  cassava_fill: false, rotten_fill: false, cassava_opacity: .2, rotten_opacity: .35, font_size: 36, show_ppd: true,
  show_filename: false, columns: 3, padding: 20, panel_width: 600, collage: false };
interface Template { name: string; style: FigureStyle }
type ExportFilters = { task_id?: string; search?: string; status?: string; review_status?: string; style?: string; version?: string; result_ids?: string };

export default function ExportDesigner({ prediction, count, filters, onExport, exporting }: {
  prediction?: PredictionResult | null; count: number; filters: ExportFilters;
  onExport: (type: 'csv' | 'xlsx' | 'zip', filters: ExportFilters) => Promise<void>; exporting: boolean;
}) {
  const [open, setOpen] = useState(false), [style, setStyle] = useState<FigureStyle>(defaults);
  const [version, setVersion] = useState('latest'), [scope, setScope] = useState('filtered');
  const [preview, setPreview] = useState(''), [error, setError] = useState('');
  const [versions, setVersions] = useState<Array<{ version: number }>>([]);
  const [templateName, setTemplateName] = useState('我的模板'), [templates, setTemplates] = useState<Template[]>([]);
  const change = <K extends keyof FigureStyle>(key: K, value: FigureStyle[K]) => setStyle(previous => ({ ...previous, [key]: value }));
  useEffect(() => {
    if (!open) return;
    try { setTemplates(JSON.parse(localStorage.getItem(workspaceStorageKey('export-templates')) || '[]')); } catch { setTemplates([]); }
    if (prediction) void predictionsApi.getCorrections(prediction.id).then(setVersions).catch(() => setVersions([]));
  }, [open, prediction?.id]);
  useEffect(() => {
    if (!open || !prediction) return;
    let active = true, url = '';
    const timer = window.setTimeout(() => {
      api.get(`/predictions/${prediction.id}/figure/`, { params: { style: JSON.stringify(style), version }, responseType: 'blob' })
        .then(response => { if (active) { url = URL.createObjectURL(response.data); setPreview(url); setError(''); } })
        .catch(async caught => { let text = '预览失败，请检查所选版本与原图资源'; try { const body = JSON.parse(await caught.response.data.text()); text = body.error || text; } catch { /* use fallback */ } if (active) setError(text); });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [open, prediction?.id, style, version]);
  const save = () => {
    let name = templateName.trim() || '我的模板', i = 1;
    while (templates.some(template => template.name === name)) name = `${templateName} (${i++})`;
    const next = [...templates, { name, style }];
    try { localStorage.setItem(workspaceStorageKey('export-templates'), JSON.stringify(next)); setTemplates(next); message.success('模板已保存'); }
    catch { message.error('无法保存模板，请检查浏览器存储'); }
  };
  const exportFilters = { ...filters, style: JSON.stringify(style), version,
    ...(scope === 'current' && prediction ? { result_ids: String(prediction.id) } : {}) };
  return <><Button icon={<SlidersHorizontal size={15} />} disabled={!prediction} onClick={() => setOpen(true)}>自定义导出</Button>
    <Drawer title="PPD 轮廓图与导出模板" open={open} onClose={() => setOpen(false)} width={Math.min(1060, window.innerWidth)}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0"><div className="sticky top-0 rounded-xl border border-hairline bg-surface-muted p-3">
          {error ? <Alert type="error" message={error} /> : preview ? <img src={preview} alt="按已选掩码生成的PPD轮廓导出预览" className="h-auto w-full" /> : <p>生成预览…</p>}

        </div></div>
        <div className="space-y-5">
          <label className="block text-sm">导出范围<Select className="mt-2 w-full" value={scope} onChange={value => { setScope(value); if (value === 'filtered') setVersion('latest'); }} options={[{ value: 'filtered', label: `当前筛选全部 ${count} 条` }, { value: 'current', label: '仅当前预览图片' }]} /></label>
          <label className="block text-sm">结果版本<Select className="mt-2 w-full" value={version} onChange={setVersion} options={[{ value: 'latest', label: '最新保存修订，没有则用模型预测' }, { value: 'model', label: '模型原预测' }, ...(scope === 'current' ? versions.map(item => ({ value: String(item.version), label: `人工修订 v${item.version}` })) : [])]} /></label>
          {(['cassava', 'rotten'] as const).map(layer => <fieldset key={layer} className="space-y-3 rounded-xl border border-hairline p-3"><legend className="px-1 text-sm font-medium">{layer === 'cassava' ? '木薯主体' : '病斑'}</legend>
            <label className="flex items-center justify-between text-sm">颜色<input aria-label={`${layer === 'cassava' ? '木薯主体' : '病斑'}颜色`} type="color" value={style[`${layer}_color`]} onChange={event => change(`${layer}_color`, event.target.value)} /></label>
            <label className="flex items-center justify-between text-sm">线条粗细<InputNumber aria-label={`${layer === 'cassava' ? '木薯主体' : '病斑'}线条粗细`} min={0} max={20} value={style[`${layer}_line_width`]} onChange={value => change(`${layer}_line_width`, Math.round(Number(value ?? 2)))} /></label>
            <label className="flex items-center justify-between text-sm">内部填色<Switch checked={style[`${layer}_fill`]} onChange={value => change(`${layer}_fill`, value)} /></label>
            <label className="block text-sm">填色不透明度 {Math.round(style[`${layer}_opacity`] * 100)}%<Slider disabled={!style[`${layer}_fill`]} min={0} max={100} value={Math.round(style[`${layer}_opacity`]*100)} onChange={value => change(`${layer}_opacity`, value / 100)} /></label>
          </fieldset>)}
          {(['show_ppd', 'show_filename', 'collage'] as const).map((key, index) => <label key={key} className="flex items-center justify-between text-sm">{['显示PPD', '显示文件名', '另生成跨照片拼图'][index]}<Switch checked={style[key]} onChange={value => change(key, value)} /></label>)}
          {(['font_size', 'columns', 'padding', 'panel_width'] as const).map((key, index) => <label key={key} className="flex items-center justify-between text-sm">{['PPD字号', '每行切面数量', '留白(px)', '每切面宽度(px)'][index]}<InputNumber min={[12,1,0,128][index]} max={[96,8,120,2048][index]} value={style[key]} onChange={value => change(key, Math.round(Number(value ?? defaults[key])))} /></label>)}
          <div className="space-y-2 border-t border-hairline pt-4"><Select placeholder="加载个人模板" className="w-full" onChange={name => { const template = templates.find(item => item.name === name); if (template) setStyle({ ...defaults, ...template.style }); }} options={templates.map(template => ({ value: template.name, label: template.name }))} /><Input aria-label="模板名称" value={templateName} onChange={event => setTemplateName(event.target.value)} /><Button onClick={save}>保存为个人模板</Button> <Button onClick={() => setStyle(defaults)}>恢复参考样式</Button></div>
          <Button block type="primary" icon={<Download size={16} />} loading={exporting} onClick={() => void onExport('zip', exportFilters)}>下载图包＋数值表＋版本清单</Button>
          <div className="flex gap-2"><Button onClick={() => void onExport('csv', exportFilters)}>CSV</Button><Button onClick={() => void onExport('xlsx', exportFilters)}>Excel</Button></div>
        </div>
      </div>
    </Drawer></>;
}
