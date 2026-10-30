import { useViewState } from '../utils/useViewState';
import ExportDesigner from './ExportDesigner';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  ChevronLeft,
  ChevronRight,
  Eye,
  Grid,
  Image as ImageIcon,
  List,
  Search,
  Target,
  X
} from 'lucide-react';
import { useResultsStore } from '../hooks/useResultsStore';
import { useTaskStore } from '../hooks/useTaskStore';
import { predictionsApi, resolveFileUrl, tasksApi } from '../services/api';
import { useSearchParams } from 'react-router-dom';
import { effectivePpd, formatPpd, formatPpdValue } from '../utils/measurement';
import { modelLabel, shortModelLabel } from '../utils/modelLabels';
import { useTranslation } from 'react-i18next';
import { PredictionResult, PredictionTask, User } from '../types';
import PredictionResultEditor from './PredictionResultEditor';

interface ResultsCenterProps {
  currentUser?: User;
}

const ResultsCenter: React.FC<ResultsCenterProps> = ({ currentUser }) => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  // 支持从任务中心跳转过来时直接聚焦某个任务的结果：/results?task=123
  const taskParam = searchParams.get('task');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(taskParam);
  const { tasks, loading: tasksLoading } = useTaskStore(currentUser);
  const [linkedTask, setLinkedTask] = useState<PredictionTask | null>(null);
  const [linkedTaskMissing, setLinkedTaskMissing] = useState(false);
  useEffect(() => {
    let active = true;
    setLinkedTask(null); setLinkedTaskMissing(false);
    if (selectedTaskId) void tasksApi.getById(selectedTaskId).then(task => { if (active) setLinkedTask(task); }).catch(() => { if (active) setLinkedTaskMissing(true); });
    return () => { active = false; };
  }, [selectedTaskId]);
  // 链接里的任务若已删除或无权查看，就不再按该任务过滤，回落到全部结果
  const taskFilter = selectedTaskId;
  const [searchQuery, setSearchQuery] = useViewState('results-search', '');
  const [filterStatus, setFilterStatus] = useViewState<'all' | 'high' | 'medium' | 'low' | 'review'>('results-status', 'all');
  const [reviewFilter, setReviewFilter] = useViewState('results-review', 'all');
  const { results, exportResults, exporting, totalCount, allResultsCount, hasMore, loadingMore, loadMore, summary, loading: resultsLoading } = useResultsStore(currentUser, taskFilter, searchQuery, filterStatus, reviewFilter);
  useEffect(() => { setSelectedTaskId(taskParam); }, [taskParam]);
  useEffect(() => {
    if (selectedTaskId !== taskParam) setSearchParams(selectedTaskId ? { task: selectedTaskId } : {}, { replace: true });
  }, [selectedTaskId]);

  const [selectedResult, setSelectedResult] = useState<PredictionResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [zoomGroup, setZoomGroup] = useState<string[]>([]);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');


  const isLoading = resultsLoading || tasksLoading;

  const fileUrl = useCallback((value: string) => resolveFileUrl(value), []);

  const hasUnknownPpdUnit = (result: PredictionResult) => !result.has_correction && result.ppd_unit === 'unknown';

  // 复核状态：后端 measurement.review_status 目前只会写 unreviewed；
  // 已人工校正但未复核的单列「已修正（待复核）」，状态推进到 reviewed 后显示「已复核」。
  const reviewStateOf = (result: PredictionResult) => {
    const status = String(result.measurement?.review_status || '').toLowerCase();
    if (status === 'reviewed' || status === 'confirmed' || status === 'approved') {
      return { key: 'results.reviewed', cls: 'border-[rgba(23,201,100,0.35)] bg-[rgba(23,201,100,0.12)] text-ok-text' };
    }
    if (result.has_correction) {
      return { key: 'results.corrected_unreviewed', cls: 'border-[rgba(245,165,36,0.35)] bg-[rgba(245,165,36,0.12)] text-warn-text' };
    }
    return { key: 'results.needs_review', cls: 'border-hairline-strong bg-surface-sunken text-ink-secondary' };
  };

  // 模型显示名：优先用结果自身的 model_type，缺失时回落到所属任务的模型类型
  const modelNameOf = (result: PredictionResult, full = false) => {
    const raw = result as unknown as { model_type?: string; single_model_type?: string; algorithm?: string };
    const taskModel = tasks.find((task) => String(task.id) === String(result.taskId))?.modelType;
    const name = raw.model_type || raw.single_model_type || raw.algorithm || taskModel;
    return full ? modelLabel(name) : shortModelLabel(name);
  };

  // PPD 统一按百分比展示，缺值给 --
  const ppdText = (value: number | null) => (value === null ? '--' : formatPpd(value));

  const buildVisList = useCallback((vis: Record<string, string> | undefined, prefix: string) =>
    Object.entries(vis || {})
      .filter(([key, value]) => key.startsWith(prefix) && value)
      .sort((a, b) => Number(a[0].slice(prefix.length)) - Number(b[0].slice(prefix.length)))
      .map(([, value]) => fileUrl(value)), [fileUrl]);

  const taskResults = useMemo(() => {
    let filtered = taskFilter ? results.filter((r) => String(r.taskId) === String(taskFilter)) : results;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((r) => r.imageName?.toLowerCase().includes(q) || r.folderName?.toLowerCase().includes(q));
    }
    if (filterStatus !== 'all') {
      filtered = filtered.filter((r) => {
        const ppd = effectivePpd(r);
        if (filterStatus === 'review') return ppd === null;
        if (ppd === null) return false;
        if (filterStatus === 'high') return ppd >= 7;
        if (filterStatus === 'medium') return ppd >= 4 && ppd < 7;
        return ppd < 4;
      });
    }
    return filtered;
  }, [taskFilter, results, searchQuery, filterStatus]);

  const [navigating, setNavigating] = useState(false);
  const navigateSelected = async (direction: -1 | 1) => {
    if (!selectedResult || navigating) return;
    const index = taskResults.findIndex(result => result.id === selectedResult.id);
    const next = taskResults[index + direction];
    if (next) { setSelectedResult(next); return; }
    if (direction > 0 && hasMore) {
      setNavigating(true);
      try { const added = await loadMore(); if (added?.[0]) setSelectedResult(added[0]); }
      finally { setNavigating(false); }
    }
  };
  useEffect(() => {
    if (!modalOpen || editorOpen || zoomImg) return;
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]')) return;
      if (event.key === 'Escape') setModalOpen(false);
      if (!event.repeat && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); void navigateSelected(event.key === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [modalOpen, editorOpen, zoomImg, selectedResult, taskResults, navigating, hasMore]);

  const stats = useMemo(() => summary && summary.total ? ({ ...summary,
    avg: summary.avg == null ? '-' : formatPpdValue(summary.avg), max: summary.max == null ? '-' : formatPpdValue(summary.max),
    min: summary.min == null ? '-' : formatPpdValue(summary.min), unknown: summary.needs_review || 0, needsReview: summary.needs_review || 0,
  }) : null, [summary]);

  const distribution = useMemo(() => {
    if (!stats || !stats.total) return [];
    return [
      { label: `${t('results.severe_disease')} (>= 7)`, value: stats.severe, tone: 'rose' },
      { label: `${t('results.mild_disease')} (4-7)`, value: stats.mild, tone: 'amber' },
      { label: `${t('results.healthy')} (< 4)`, value: stats.healthy, tone: 'emerald' },
      { label: t('results.needs_review'), value: stats.needsReview, tone: 'slate' }
    ].map((item) => ({ ...item, percent: ((item.value / stats.total) * 100).toFixed(1) }));
  }, [stats, t]);

  useEffect(() => {
    setSelectedResult((current) => taskResults.find((item) => item.id === current?.id) ?? taskResults[0] ?? null);
  }, [taskResults]);

  const [overlayError, setOverlayError] = useState('');
  const [finalOverlay, setFinalOverlay] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setFinalOverlay(null); setOverlayError('');
    if (selectedResult && modalOpen) {
      predictionsApi.getOverlay(selectedResult.id, selectedResult.latest_correction?.version || 0).then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setFinalOverlay(objectUrl);
      }).catch(() => { if (active) setOverlayError('分割预览不可用'); });
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selectedResult?.id, selectedResult?.latest_correction?.version, modalOpen]);

  const selectedVis = useMemo(() => {
    if (!selectedResult) return { cut2: [], pred: [] };
    const vis = selectedResult.vis_images || {};
    return { cut2: buildVisList(vis, 'cut2_'), pred: buildVisList(vis, 'pred_') };
  }, [buildVisList, selectedResult]);

  const segmentCount = useMemo(() => {
    if (!selectedResult) return 0;
    const raw = selectedResult.split_count ?? selectedResult.splitCount;
    if (typeof raw === 'number' && raw > 0) return raw;
    if (Array.isArray(selectedResult.sub_ppd_values) && selectedResult.sub_ppd_values.length) return selectedResult.sub_ppd_values.length;
    if (selectedVis.pred.length) return selectedVis.pred.length;
    if (selectedVis.cut2.length) return selectedVis.cut2.length;
    return 0;
  }, [selectedResult, selectedVis]);


  useEffect(() => {
    if (!zoomImg) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomImg(null);
      if (e.key === 'ArrowLeft' && zoomGroup.length > 1) setZoomIndex((i) => (i - 1 + zoomGroup.length) % zoomGroup.length);
      if (e.key === 'ArrowRight' && zoomGroup.length > 1) setZoomIndex((i) => (i + 1) % zoomGroup.length);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [zoomImg, zoomGroup]);

  useEffect(() => {
    if (zoomGroup.length && zoomIndex >= 0) setZoomImg(zoomGroup[zoomIndex]);
  }, [zoomGroup, zoomIndex]);

  const openZoom = useCallback((img: string, group: string[]) => {
    setZoomGroup(group);
    setZoomIndex(group.indexOf(img));
    setZoomImg(img);
  }, []);

  const activeTask = selectedTaskId ? tasks.find((task) => String(task.id) === String(selectedTaskId)) || (String(linkedTask?.id) === String(selectedTaskId) ? linkedTask : null) : null;
  // 网址里带的 task 参数找不到对应任务时提示，而不是静默显示全部结果
  // 注意：任务列表为空时也要提示，否则库中没有任务时永远不会提示
  const invalidTaskParam = Boolean(selectedTaskId) && !tasksLoading && linkedTaskMissing && !activeTask;
  const metricCards = [
    { label: t('results.total_images'), value: String(stats?.total || 0), suffix: '' },
    { label: t('results.avg_ppd'), value: stats?.avg || '-', suffix: stats?.avg && stats.avg !== '-' ? '%' : '' },
    { label: t('results.max_ppd'), value: stats?.max || '-', suffix: stats?.max && stats.max !== '-' ? '%' : '' },
    { label: t('results.min_ppd'), value: stats?.min || '-', suffix: stats?.min && stats.min !== '-' ? '%' : '' }
  ];

  return (
    <div className="page-shell page-shell--wide page-shell--flush">
      <div className="grid items-start gap-4 xl:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="hidden space-y-2 self-start rounded-[16px] border border-hairline bg-white p-3 xl:sticky xl:top-2 xl:block">


          <button
            onClick={() => setSelectedTaskId(null)}
            className={`w-full rounded-lg border-0 px-3 py-2.5 text-left transition ${!selectedTaskId ? 'border-accent-line/30 bg-[rgba(10,132,255,0.06)]' : 'border-hairline bg-surface-muted hover:bg-surface-sunken'}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">{t('results.all_results')}</p>
                <p className="mt-1 text-xs text-muted">{t('results.records_count', { count: allResultsCount })}</p>
              </div>
              <Target className="h-4 w-4 text-muted" />
            </div>
          </button>

          <div className="space-y-3">
            {tasks.map((task) => {
              const taskCount = task.resultCount ?? results.filter((result) => String(result.taskId) === String(task.id)).length;
              return (
                <button
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`w-full rounded-lg border-0 px-3 py-2.5 text-left transition ${String(selectedTaskId) === String(task.id) ? 'border-sky-200 bg-sky-50' : 'border-hairline bg-white hover:bg-surface-muted'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{task.name}</p>
                      <p className="mt-1 text-xs text-muted">{shortModelLabel(task.modelType)} · {t('results.records_count', { count: taskCount })}</p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-ink-secondary ring-1 ring-inset ring-hairline">
                      {Math.round(task.progress)}%
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0 space-y-3">
          <section className="sticky top-0 z-20 border-b border-hairline bg-white py-3">

            {activeTask && <span className="mb-2 block truncate text-sm font-medium">{activeTask.name}</span>}
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="results-task-mobile" className="sr-only">{t('results.all_tasks')}</label>
              <select id="results-task-mobile" value={selectedTaskId ?? ''} onChange={(e) => setSelectedTaskId(e.target.value || null)} className="w-full rounded-[10px] border border-hairline-strong bg-white px-3 py-2 text-sm text-ink outline-none focus:border-accent-line focus:ring-2 focus:ring-[rgba(10,132,255,0.12)] sm:w-auto xl:hidden">
                <option value="">{t('results.all_results')}</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>{task.name}</option>
                ))}
              </select>

              <div className="relative min-w-0 basis-full sm:basis-0 sm:flex-1">
                <label htmlFor="results-search" className="sr-only">{t('results.search')}</label>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input id="results-search" name="results-search" type="text" placeholder={t('results.search')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full rounded-[10px] border border-hairline-strong bg-white py-2 pl-10 pr-3 text-sm text-ink outline-none transition focus:border-accent-line focus:ring-2 focus:ring-[rgba(10,132,255,0.12)]" />
              </div>

              <label htmlFor="results-status-filter" className="sr-only">{t('results.all_status')}</label>
              <select id="results-status-filter" name="results-status-filter" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as 'all' | 'high' | 'medium' | 'low' | 'review')} className="rounded-[10px] border border-hairline-strong bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-accent-line focus:ring-2 focus:ring-[rgba(10,132,255,0.12)]">
                <option value="all">{t('results.all_status')}</option><option value="review">数值待确认</option>
                <option value="low">{t('results.low_health')}</option>
                <option value="medium">{t('results.medium_disease')}</option>
                <option value="high">{t('results.high_disease')}</option>
              </select>

              <select aria-label="复检状态" value={reviewFilter} onChange={event => setReviewFilter(event.target.value)} className="rounded-lg border border-hairline-strong bg-white px-3 py-2 text-sm"><option value="all">全部复检状态</option><option value="unreviewed">待复检</option><option value="reviewed">已复检</option></select>
              <span className="text-sm tabular-nums text-muted">{t('results.results_count', { count: totalCount })}</span>

              <ExportDesigner prediction={taskResults.find(item => item.id === selectedResult?.id) || taskResults[0]} count={totalCount} filters={{ ...(taskFilter ? { task_id: taskFilter } : {}), search: searchQuery, status: filterStatus, review_status: reviewFilter }} onExport={exportResults} exporting={exporting} />
              <div className="ml-auto flex rounded-[10px] bg-surface-sunken p-1">
                <button onClick={() => setViewMode('grid')} className={`rounded-[8px] px-2.5 py-1.5 ${viewMode === 'grid' ? 'bg-white text-ink shadow-sm' : 'text-muted'}`} aria-label="grid"><Grid className="h-4 w-4" /></button>
                <button onClick={() => setViewMode('list')} className={`rounded-[8px] px-2.5 py-1.5 ${viewMode === 'list' ? 'bg-white text-ink shadow-sm' : 'text-muted'}`} aria-label="list"><List className="h-4 w-4" /></button>
              </div>
            </div>
          </section>

          <section aria-label="结果统计" className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-hairline px-1 py-2 text-sm">
            {metricCards.map(card => <div key={card.label} className="flex items-baseline gap-2"><span className="text-muted">{card.label}</span><strong className="font-semibold tabular-nums">{card.value}{card.suffix}</strong></div>)}
            <details className="ml-auto text-sm"><summary className="cursor-pointer text-ink-secondary">分布</summary><div className="absolute right-6 z-20 mt-2 space-y-2 rounded-xl border border-hairline bg-white p-4 shadow-lg">{distribution.map(item => <div key={item.label} className="flex min-w-52 items-center justify-between gap-4"><span>{item.label}</span><span className="tabular-nums">{item.value} · {item.percent}%</span></div>)}</div></details>
          </section>

          <section className="py-1">
            {invalidTaskParam && (
              <div className="mb-4 rounded-2xl border border-[rgba(245,165,36,0.30)] bg-[rgba(245,165,36,0.12)] px-4 py-3">
                <p className="text-sm font-semibold text-warn-text">{t('not_found.invalid_task')}</p>
                <p className="mt-1 text-sm text-warn-text">{t('not_found.invalid_task_desc')}</p>
              </div>
            )}
            {hasMore && <div className="mb-4 flex items-center justify-between text-sm text-muted"><span>{results.length} / {totalCount}</span><button onClick={() => { void loadMore(); }} disabled={loadingMore} className="rounded-lg border px-3 py-2">{loadingMore ? t('common.loading') : t('results.load_more')}</button></div>}
            {isLoading && taskResults.length === 0 ? (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-muted">{t('results.loading')}</div>
            ) : taskResults.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                <div className="rounded-full bg-surface-muted p-4"><ImageIcon className="h-8 w-8 text-muted" /></div>
                <h3 className="mt-5 text-lg font-semibold text-ink">{t('results.no_results')}</h3>
                <p className="mt-2 max-w-md text-sm text-muted">{searchQuery || filterStatus !== 'all' ? t('results.adjust_search_results') : t('results.complete_task_tip')}</p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {taskResults.map((result) => {
                  const ppdValue = effectivePpd(result);
                  const severity = ppdValue === null ? 'unknown' : (ppdValue ?? -1) >= 7 ? 'severe' : (ppdValue ?? -1) >= 4 ? 'mild' : 'healthy';
                  const tone = 'border-hairline bg-white';
                  const severityDot = severity === 'severe' ? 'bg-danger' : severity === 'mild' ? 'bg-warn' : severity === 'healthy' ? 'bg-ok' : 'bg-slate-300';
                  const reviewState = reviewStateOf(result);
                  return (
                    <article key={result.id} className={`group card flex flex-col rounded-[16px] border p-3 transition-shadow hover:shadow-lg ${tone}`}>
                        <button className="relative block w-full overflow-hidden rounded-[12px]" onClick={() => { setSelectedResult(result); setModalOpen(true); }}>
                        <img src={fileUrl(result.overlayImageUrl || Object.entries(result.vis_images || {}).find(([key]) => key.startsWith('pred_'))?.[1] || result.imageUrl)} alt={result.imageName} className="aspect-square w-full object-cover" />
                        <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-1 rounded-lg border border-hairline bg-white/95 px-2 py-1 text-xs shadow-sm">
                          <span className="font-semibold text-ink"><span className="font-normal text-muted">{t('results.ppd_value')}</span> <span className="tabular-nums">{ppdText(ppdValue)}</span></span>
                          {hasUnknownPpdUnit(result) && <span className="truncate font-normal text-warn-text">{t('results.unit_unconfirmed')}</span>}
                        </div>
                      </button>
                      <div className="mt-3 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink" title={result.imageName}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${severityDot}`} />{result.imageName}</p>
                          <p className="mt-1 truncate text-xs text-muted" title={result.folderName || ''}>{result.folderName || t('results.uncategorized')}</p>{result.measurement?.execution_warning && <p className="mt-1 text-xs text-warn-text">{t('results.history_inconsistent')}</p>}
                        </div>
                        <button className="rounded-xl border border-hairline bg-white p-2 text-ink-secondary transition hover:text-ink" onClick={() => { setSelectedResult(result); setModalOpen(true); }} aria-label={t('results.preview')}>
                          <Eye className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${reviewState.cls}`}>{t(reviewState.key)}</span>
                        <span className="truncate rounded-full border border-hairline bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-secondary" title={modelNameOf(result, true)}>{modelNameOf(result)}</span>
                      </div>
                      <div className="mt-auto flex items-center gap-1.5 pt-2">
                        <button type="button" onClick={() => { setSelectedResult(result); setEditorOpen(true); }} className="inline-flex items-center gap-1 rounded-lg border border-accent-line/40 bg-white px-2.5 py-1.5 text-xs font-medium text-accent-text transition-colors hover:bg-[rgba(10,132,255,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-line">{t('results.open_editor')}</button>
                        {result.ensemble_details?.members?.length === 2 && <button type="button" onClick={() => { setSelectedResult(result); setModalOpen(true); }} className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong bg-white px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-accent-line hover:bg-surface-sunken hover:text-accent-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-line">{t('results.vote_detail')}</button>}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                {taskResults.map((result) => {
                  const ppdValue = effectivePpd(result);
                  const severity = ppdValue === null ? 'unknown' : (ppdValue ?? -1) >= 7 ? 'severe' : (ppdValue ?? -1) >= 4 ? 'mild' : 'healthy';
                  const tone = 'border-hairline bg-white';
                  const severityDot = severity === 'severe' ? 'bg-danger' : severity === 'mild' ? 'bg-warn' : severity === 'healthy' ? 'bg-ok' : 'bg-slate-300';
                  const reviewState = reviewStateOf(result);
                  return (
                    <article key={result.id} className={`card flex items-center gap-4 rounded-[16px] border p-3 ${tone}`}>
                      <button onClick={() => { setSelectedResult(result); setModalOpen(true); }} className="overflow-hidden rounded-[12px]">
                        <img src={fileUrl(result.overlayImageUrl || Object.entries(result.vis_images || {}).find(([key]) => key.startsWith('pred_'))?.[1] || result.imageUrl)} alt={result.imageName} className="h-20 w-20 object-cover" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <button onClick={() => { setSelectedResult(result); setModalOpen(true); }} className="flex items-center gap-1.5 truncate text-left text-base font-semibold text-ink"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${severityDot}`} />{result.imageName}</button>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                          <span>{result.folderName || t('results.uncategorized')}</span>
                          <span>{t('results.ppd_value')}: <span className="font-medium tabular-nums text-ink">{ppdText(ppdValue)}</span>{hasUnknownPpdUnit(result) ? ` · ${t('results.unit_unconfirmed')}` : ''}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${reviewState.cls}`}>{t(reviewState.key)}</span>
                          <span className="rounded-full border border-hairline bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-secondary">{modelNameOf(result)}</span>
                          {Array.isArray(result.sub_ppd_values) && result.sub_ppd_values.length > 0 && <span>{t('results.sub_ppd')}: {result.sub_ppd_values.map((v) => Number(v).toFixed(2)).join(', ')}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="rounded-xl border border-hairline bg-white p-2 text-ink-secondary transition hover:text-ink" onClick={() => { setSelectedResult(result); setModalOpen(true); }} aria-label={t('results.preview')}><Eye className="h-4 w-4" /></button>
                        <a href={fileUrl(result.imageUrl)} download className="rounded-xl border border-hairline bg-white p-2 text-ink-secondary transition hover:text-ink" aria-label={t('results.download')}><Download className="h-4 w-4" /></a>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button type="button" onClick={() => { setSelectedResult(result); setEditorOpen(true); }} className="inline-flex items-center gap-1 rounded-lg border border-accent-line/40 bg-white px-3 py-1.5 text-xs font-medium text-accent-text transition-colors hover:bg-[rgba(10,132,255,0.08)]">{t('results.open_editor')}</button>
                        {result.ensemble_details?.members?.length === 2 && <button type="button" onClick={() => { setSelectedResult(result); setModalOpen(true); }} className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong bg-white px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-accent-line hover:bg-surface-sunken hover:text-accent-text">{t('results.vote_detail')}</button>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>

      {modalOpen && selectedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-[24px] card shadow-[0_30px_120px_rgba(15,23,42,0.18)]">
            <div className="flex items-center justify-between border-b border-hairline px-6 py-5">
              <div>
                <h3 className="text-xl font-semibold text-ink">{selectedResult.imageName}</h3>
                <p className="mt-1 text-sm text-muted">{selectedResult.folderName || t('results.uncategorized')}</p>
                <div className="mt-2 flex items-center gap-2"><button aria-label="预览上一张" disabled={taskResults.findIndex(item => item.id === selectedResult.id) <= 0} onClick={() => void navigateSelected(-1)} className="rounded p-1 disabled:opacity-30"><ChevronLeft size={18} /></button><span className="text-xs tabular-nums">{taskResults.findIndex(item => item.id === selectedResult.id) + 1} / {totalCount}</span><button aria-label="预览下一张" disabled={navigating || (taskResults.findIndex(item => item.id === selectedResult.id) >= taskResults.length - 1 && !hasMore)} onClick={() => void navigateSelected(1)} className="rounded p-1 disabled:opacity-30"><ChevronRight size={18} /></button></div>
                <button type="button" className="mt-2 text-sm font-medium text-ink-secondary" onClick={() => { setModalOpen(false); setEditorOpen(true); }}>{t('results.enter_manual_correction')}</button>
              </div>
              <button onClick={() => setModalOpen(false)} className="rounded-2xl border border-hairline p-2 text-muted transition hover:bg-white hover:text-ink-secondary" aria-label={t('results.preview')}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(90vh-88px)] overflow-y-auto px-6 py-6">
                  {selectedResult.ensemble_details?.members?.length === 2 && (
                    <div className="rounded-[16px] border border-hairline bg-white p-5">
                      <h4 className="text-sm font-semibold text-ink">{t('results.vote_model_score')}</h4>
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex justify-between font-medium"><span>{t('results.vote_model_ppd')}</span><span>{formatPpd(selectedResult.ppdValue)}</span></div>
                        {selectedResult.ensemble_details.members.map(member => <div key={member.model} className="flex justify-between"><span>{modelLabel(member.model)} PPD</span><span>{formatPpd(member.ppd_percent)}</span></div>)}
                        <div className="flex justify-between border-t border-hairline pt-2"><span>{t('results.model_agreement')}</span><span>{formatPpd(selectedResult.ensemble_details.agreement_percent)}</span></div>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-ink-secondary">一致率不代表准确率；分歧像素：{selectedResult.ensemble_details.disagreement_pixels}。分歧按平均病变概率裁决。以上为模型原始结果，人工校正后的最终 PPD 单独显示。</p>
                    </div>
                  )}

              <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                <section className="space-y-5">
                  <div className="rounded-xl bg-surface-muted p-3"><h4 className="text-sm font-medium">分割结果{selectedResult.latest_correction ? ` · 修订 v${selectedResult.latest_correction.version}` : ''}</h4>{finalOverlay ? <img src={finalOverlay} alt="分割结果预览" className="mt-2 max-h-[60vh] w-full object-contain" onClick={() => openZoom(finalOverlay, [finalOverlay])} /> : selectedResult.overlayImageUrl || selectedVis.pred[0] ? <img src={fileUrl(selectedResult.overlayImageUrl || selectedVis.pred[0])} alt="模型分割结果预览" className="mt-2 max-h-[60vh] w-full object-contain" /> : <p className="py-12 text-center text-sm text-muted">{overlayError || '正在载入分割预览…'}</p>}</div>
                  <details className="text-sm"><summary className="cursor-pointer text-muted">原图</summary><img src={fileUrl(selectedResult.imageUrl)} alt={selectedResult.imageName} className="mt-2 max-h-[60vh] w-full object-contain" /></details>
                  {Boolean(selectedResult.latest_correction?.edit_data?.segments) && <p className="text-xs text-muted">{t('results.correction_note')}</p>}
                  {selectedResult.vis_images?.disagreement && <div className="rounded-[16px] border border-[rgba(245,165,36,0.30)] bg-white p-4"><h4 className="text-sm font-semibold">{t('results.disagreement_range')}</h4><p className="mt-1 text-xs text-muted">{t('results.disagreement_hint')}</p><img src={fileUrl(selectedResult.vis_images.disagreement)} alt="模型分歧范围" className="mt-3 w-full rounded-xl" /></div>}
                  {selectedVis.pred.length > 0 && (
                    <div className="rounded-[16px] card p-4">
                      <h4 className="text-sm font-semibold text-ink">{t('results.original_prediction')}</h4>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {selectedVis.pred.map((img, index) => (
                          <button key={`${img}-${index}`} onClick={() => openZoom(img, selectedVis.pred)} className="overflow-hidden rounded-[16px] border border-hairline bg-surface-muted">
                            <img src={img} alt={`prediction-${index + 1}`} className="aspect-square w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedVis.cut2.length > 0 && (
                    <div className="rounded-[16px] card p-4">
                      <h4 className="text-sm font-semibold text-ink">{t('results.second_cut')}</h4>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {selectedVis.cut2.map((img, index) => (
                          <button key={`${img}-${index}`} onClick={() => openZoom(img, selectedVis.cut2)} className="overflow-hidden rounded-[16px] border border-hairline bg-surface-muted">
                            <img src={img} alt={`cut-${index + 1}`} className="aspect-square w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                <aside className="space-y-4">
                  <div className="rounded-[16px] border border-hairline bg-surface-muted p-5">
                    <h4 className="text-sm font-semibold">{t('results.result_details')}</h4>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between border-b border-hairline pb-3"><span className="text-muted">{t('results.ppd_value')}</span><span className="font-medium">{formatPpd(effectivePpd(selectedResult))}</span></div>
                      {hasUnknownPpdUnit(selectedResult) && <div className="rounded-lg bg-amber-400/10 px-2 py-1.5 text-xs text-amber-200">{t('results.unit_unknown_hint')}</div>}
                      <div className="flex items-center justify-between border-b border-hairline pb-3"><span className="text-muted">Confidence</span><span className="font-medium">{selectedResult.confidence == null ? t('results.not_provided') : `${(selectedResult.confidence * 100).toFixed(1)}%`}</span></div>
                      <div className="flex items-center justify-between border-b border-hairline pb-3"><span className="text-muted">Processing Time</span><span className="font-medium">{selectedResult.processingTime ? `${selectedResult.processingTime}s` : t('results.not_recorded')}</span></div>
                      <div className="flex items-center justify-between"><span className="text-muted">Segments</span><span className="font-medium">{segmentCount}</span></div>
                    </div>
                  </div>



                  <div className="rounded-[16px] border border-hairline bg-surface-muted p-5">
                    <h4 className="text-sm font-semibold text-ink">{t('results.original_segment_ppd')}</h4>
                    <div className="mt-4 space-y-3">
                      {Array.isArray(selectedResult.sub_ppd_values) && selectedResult.sub_ppd_values.length > 0 ? (
                        selectedResult.sub_ppd_values.map((value, index) => (
                          <div key={`${value}-${index}`}>
                            <div className="mb-1 flex items-center justify-between text-sm">
                              <span className="text-muted">Part {index + 1}</span>
                              <span className="font-medium text-ink">{Number(value).toFixed(2)}</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-hairline/80">
                              <div className={`h-full rounded-full ${Number(value) >= 7 ? 'bg-danger' : Number(value) >= 4 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${Math.min(Number(value) * 10, 100)}%` }} />
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted">{t('results.no_segment_ppd')}</p>
                      )}
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </div>
      )}

      {zoomImg && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4">
          <button onClick={() => setZoomImg(null)} className="absolute right-6 top-6 rounded-full border border-hairline bg-white/10 p-2 text-white" aria-label="close zoom">
            <X className="h-5 w-5" />
          </button>
          <img src={zoomImg} alt="zoom" className="max-h-[88vh] max-w-[92vw] rounded-[16px] object-contain shadow-2xl" />
        </div>
      )}

      {editorOpen && selectedResult && (
        <PredictionResultEditor
          key={selectedResult.id}
          prediction={selectedResult}
          positionLabel={`${taskResults.findIndex(result => result.id === selectedResult.id) + 1} / ${totalCount}`}
          onReviewed={() => window.dispatchEvent(new Event('results:reload'))}
          canPrevious={taskResults.findIndex(result => result.id === selectedResult.id) > 0}
          canNext={!navigating && (taskResults.findIndex(result => result.id === selectedResult.id) < taskResults.length - 1 || hasMore)}
          onNavigate={navigateSelected}
          onClose={() => setEditorOpen(false)}
          onSaved={(correction) => {
            setSelectedResult((current) => current ? {
              ...current,
              has_correction: true,
              latest_correction_ppd: Number(correction?.ppd_percent ?? 0),
              latest_correction: correction,
              measurement: { final_ppd: Number(correction.ppd_percent), measurement_source: 'manual', measurement_status: 'manual-corrected', correction_version: correction.version, review_status: 'unreviewed' },
            } : current);
            window.dispatchEvent(new Event('results:reload'));
          }}
        />
      )}
    </div>
  );
};

export default ResultsCenter;
