import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn, Minimize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PredictionResult } from '../types';
import { resolveFileUrl } from '../services/api';
import { effectivePpd, formatPpd } from '../utils/measurement';
import { modelLabel } from '../utils/modelLabels';

interface Props {
  prediction: PredictionResult;
  overlay: string | null;
  error: string;
  position: string;
  canPrevious: boolean;
  canNext: boolean;
  onNavigate: (direction: -1 | 1) => void;
  onClose: () => void;
  onEdit: () => void;
}

export default function ResultPreview({ prediction, overlay, error, position, canPrevious, canNext, onNavigate, onClose, onEdit }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('overlay');
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const vis = (prefix: string) => Object.entries(prediction.vis_images || {}).filter(([key, value]) => key.startsWith(prefix) && value)
    .sort(([a], [b]) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length))).map(([, value]) => resolveFileUrl(value));
  const modelImages = vis('pred_'), cutImages = vis('cut2_');
  const fallback = prediction.latest_correction ? '' : prediction.overlayImageUrl || modelImages[0] || '';
  const tabs = [
    { id: 'overlay', label: '分割结果', images: [overlay || (fallback ? resolveFileUrl(fallback) : '')] },
    { id: 'original', label: '原图', images: [resolveFileUrl(prediction.imageUrl)] },
    ...(modelImages.length ? [{ id: 'model', label: '模型切面', images: modelImages }] : []),
    ...(cutImages.length ? [{ id: 'cut', label: '切面原图', images: cutImages }] : []),
  ];
  const active = tabs.find(item => item.id === tab) || tabs[0];
  const src = active.images[Math.min(index, active.images.length - 1)];
  useEffect(() => { setIndex(0); setZoomed(false); }, [prediction.id, tab]);
  const manualSegments = prediction.latest_correction?.edit_data?.segments;
  const segments: Array<{ ppd_percent: number | null }> = Array.isArray(manualSegments) && manualSegments.length
    ? manualSegments : (prediction.sub_ppd_values || []).map(value => ({ ppd_percent: Number(value) }));

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-2 sm:p-4">
    <section role="dialog" aria-modal="true" aria-label="结果预览" className="result-preview flex h-[92dvh] max-h-[960px] w-full max-w-[1440px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0 flex-1"><h3 className="truncate text-base font-semibold" title={prediction.imageName}>{prediction.imageName}</h3><p className="truncate text-xs text-muted">{prediction.folderName || t('results.uncategorized')}</p></div>
        <div className="flex items-center gap-1"><button aria-label="预览上一张" title="←" disabled={!canPrevious} onClick={() => onNavigate(-1)} className="rounded p-2 disabled:opacity-30"><ChevronLeft size={18} /></button><span className="min-w-16 text-center text-xs tabular-nums">{position}</span><button aria-label="预览下一张" title="→" disabled={!canNext} onClick={() => onNavigate(1)} className="rounded p-2 disabled:opacity-30"><ChevronRight size={18} /></button></div>
        <button onClick={onEdit} className="rounded-lg bg-brand-fill px-3 py-2 text-sm font-medium text-white">{t('results.enter_manual_correction')}</button>
        <button aria-label="关闭预览" onClick={onClose} className="rounded p-2 text-muted"><X size={18} /></button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b border-hairline px-3 py-2">
            <div role="tablist" aria-label="预览图层" className="flex min-w-0 flex-1 overflow-x-auto">{tabs.map(item => <button key={item.id} role="tab" aria-selected={active.id === item.id} onClick={() => setTab(item.id)} className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${active.id === item.id ? 'bg-brand-fill text-white' : 'text-muted hover:bg-surface-muted'}`}>{item.label}</button>)}</div>
            <button aria-label={zoomed ? '适应窗口' : '放大图像'} onClick={() => setZoomed(value => !value)} className="rounded p-2 text-muted">{zoomed ? <Minimize2 size={16} /> : <ZoomIn size={16} />}</button>
          </div>
          <div className="result-preview-canvas flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface-muted p-3">
            {src ? <img src={src} alt={active.id === 'overlay' ? '分割结果预览' : active.label} className={zoomed ? 'm-auto max-w-none shrink-0' : 'h-full min-h-0 w-full object-contain'} /> : <p role="status" className="text-sm text-muted">{error || '正在载入分割预览…'}</p>}
          </div>
          {active.images.length > 1 && <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-hairline p-2">{active.images.map((url, imageIndex) => <button key={url + imageIndex} aria-label={`切面 ${imageIndex + 1}`} aria-pressed={index === imageIndex} onClick={() => { setIndex(imageIndex); setZoomed(false); }} className={`shrink-0 overflow-hidden rounded border-2 ${index === imageIndex ? 'border-brand-fill' : 'border-transparent'}`}><img src={url} alt="" className="h-14 w-14 object-contain" /></button>)}</div>}
        </div>
        <aside className="max-h-[28dvh] shrink-0 overflow-y-auto border-t border-hairline px-4 py-3 md:max-h-none md:w-64 md:border-l md:border-t-0">
          <p className="text-xs text-muted">PPD</p><p className="mb-3 text-2xl font-semibold tabular-nums">{formatPpd(effectivePpd(prediction))}</p>
          {prediction.measurement?.protocol?.startsWith('legacy_') && <p className="mb-3 text-xs text-muted">{prediction.measurement.protocol === 'legacy_slice_mean' ? '历史切面均值' : `历史原值 ${prediction.measurement.legacy_raw_value ?? '—'} · 单位待确认`}</p>}
          <dl className="space-y-2 text-sm"><div className="flex justify-between gap-2"><dt className="text-muted">数值来源</dt><dd>{prediction.latest_correction ? `人工修订 v${prediction.latest_correction.version}` : '模型预测'}</dd></div>
            {prediction.confidence != null && <div className="flex justify-between"><dt className="text-muted">置信度</dt><dd>{(prediction.confidence * 100).toFixed(1)}%</dd></div>}
            {prediction.processingTime != null && prediction.processingTime > 0 && <div className="flex justify-between"><dt className="text-muted">处理耗时</dt><dd>{prediction.processingTime}s</dd></div>}
          </dl>
          {segments.length > 0 && <div className="mt-4 border-t border-hairline pt-3"><h4 className="mb-2 text-xs font-medium text-muted">{Array.isArray(manualSegments) && manualSegments.length ? '修订切面 PPD' : '模型切面 PPD'}</h4>{segments.map((segment, n) => <div key={n} className="flex justify-between py-1 text-sm"><span>切面 {n + 1}</span><span className="tabular-nums">{formatPpd(segment.ppd_percent)}</span></div>)}</div>}
          {prediction.ensemble_details?.members?.length === 2 && <div className="mt-4 space-y-2 border-t border-hairline pt-3 text-sm">{prediction.ensemble_details.members.map(member => <div key={member.model} className="flex justify-between gap-2"><span>{modelLabel(member.model)} PPD</span><span>{formatPpd(member.ppd_percent)}</span></div>)}<div className="flex justify-between"><span>模型一致率</span><span>{formatPpd(prediction.ensemble_details.agreement_percent)}</span></div></div>}
          {prediction.latest_correction?.note && <p className="mt-4 whitespace-pre-wrap border-t border-hairline pt-3 text-sm text-muted">{prediction.latest_correction.note}</p>}
        </aside>
      </div>
    </section>
  </div>;
}
