import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Download,
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
import { predictionsApi, resolveFileUrl } from '../services/api';
import { useSearchParams } from 'react-router-dom';
import { effectivePpd, formatPpd } from '../utils/measurement';
import PageHeader from './PageHeader';
import { modelLabel } from '../utils/modelLabels';
import { useTranslation } from 'react-i18next';
import { PredictionResult, User } from '../types';
import PredictionResultEditor from './PredictionResultEditor';

interface ResultsCenterProps {
  currentUser?: User;
}

const ResultsCenter: React.FC<ResultsCenterProps> = ({ currentUser }) => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  // 支持从任务中心跳转过来时直接聚焦某个任务的结果：/results?task=123
  const taskParam = searchParams.get('task');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(taskParam);
  const { tasks, loading: tasksLoading } = useTaskStore(currentUser);
  // 链接里的任务若已删除或无权查看，就不再按该任务过滤，回落到全部结果
  const taskFilter = Boolean(selectedTaskId) && !tasksLoading && tasks.length > 0 && !tasks.some((task) => task.id === selectedTaskId) ? null : selectedTaskId;
  const { results, exportResults, exporting, totalCount, allResultsCount, hasMore, loadingMore, loadMore, loading: resultsLoading } = useResultsStore(currentUser, taskFilter);
  const [selectedResult, setSelectedResult] = useState<PredictionResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [zoomGroup, setZoomGroup] = useState<string[]>([]);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'high' | 'medium' | 'low' | 'review'>('all');

  const isLoading = resultsLoading || tasksLoading;

  const fileUrl = useCallback((value: string) => resolveFileUrl(value), []);

  const hasUnknownPpdUnit = (result: PredictionResult) => !result.has_correction && result.ppd_unit === 'unknown';

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

  const stats = useMemo(() => {
    if (!taskResults.length) return null;
    const ppds = taskResults.map(effectivePpd).filter((value): value is number => value !== null);
    const severe = ppds.filter((p) => p >= 7).length;
    const mild = ppds.filter((p) => p >= 4 && p < 7).length;
    const healthy = ppds.filter((p) => p < 4).length;
    return {
      total: taskResults.length,
      avg: ppds.length ? (ppds.reduce((a, b) => a + b, 0) / ppds.length).toFixed(2) : '-',
      max: ppds.length ? Math.max(...ppds).toFixed(2) : '-',
      min: ppds.length ? Math.min(...ppds).toFixed(2) : '-',
      healthy,
      mild,
      severe,
      needsReview: taskResults.length - ppds.length
    };
  }, [taskResults]);

  const distribution = useMemo(() => {
    if (!stats || !stats.total) return [];
    return [
      { label: `${t('results.severe_disease')} (>= 7)`, value: stats.severe, tone: 'rose' },
      { label: `${t('results.mild_disease')} (4-7)`, value: stats.mild, tone: 'amber' },
      { label: `${t('results.healthy')} (< 4)`, value: stats.healthy, tone: 'emerald' },
      { label: '待复核', value: stats.needsReview, tone: 'slate' }
    ].map((item) => ({ ...item, percent: ((item.value / stats.total) * 100).toFixed(1) }));
  }, [stats, t]);

  useEffect(() => {
    setSelectedResult((current) => taskResults.find((item) => item.id === current?.id) ?? taskResults[0] ?? null);
  }, [taskResults]);

  const [finalOverlay, setFinalOverlay] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setFinalOverlay(null);
    if (selectedResult?.latest_correction) {
      predictionsApi.getOverlay(selectedResult.id, selectedResult.latest_correction.version).then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setFinalOverlay(objectUrl);
      }).catch(() => { /* The original model images remain labelled separately. */ });
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selectedResult?.id, selectedResult?.latest_correction?.version]);

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

  const handleExport = (fileType: 'csv' | 'xlsx' | 'zip') => {
    void exportResults(fileType, { task_id: selectedTaskId || undefined, search: searchQuery || undefined, status: filterStatus });
  };

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

  const activeTask = selectedTaskId ? tasks.find((task) => String(task.id) === String(selectedTaskId)) : null;
  // 网址里带的 task 参数找不到对应任务时提示，而不是静默显示全部结果
  // 注意：任务列表为空时也要提示，否则库中没有任务时永远不会提示
  const invalidTaskParam = Boolean(selectedTaskId) && !tasksLoading && tasks.length > 0 && !activeTask;
  const metricCards = [
    { label: t('results.total_images'), value: stats?.total || 0 },
    { label: t('results.avg_ppd'), value: stats?.avg || '-' },
    { label: t('results.max_ppd'), value: stats?.max || '-' },
    { label: t('results.min_ppd'), value: stats?.min || '-' }
  ];

  return (
    <div className="page-shell page-shell--wide page-shell--flush">
      <div className="grid items-start gap-4 xl:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="hidden space-y-2 self-start rounded-[16px] border border-hairline bg-white p-3 xl:sticky xl:top-2 xl:block">
          <p className="px-2 pt-1 text-sm font-semibold text-ink">{t('navigation.results')}</p>

          <button
            onClick={() => setSelectedTaskId(null)}
            className={`w-full rounded-[16px] border px-4 py-4 text-left transition ${!selectedTaskId ? 'border-accent-line/30 bg-[rgba(10,132,255,0.06)]' : 'border-hairline bg-surface-muted hover:bg-surface-sunken'}`}
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
                  className={`w-full rounded-[16px] border px-4 py-4 text-left transition ${String(selectedTaskId) === String(task.id) ? 'border-sky-200 bg-sky-50' : 'border-hairline bg-white hover:bg-surface-muted'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{task.name}</p>
                      <p className="mt-1 text-xs text-muted">{task.modelType || '--'} · {t('results.records_count', { count: taskCount })}</p>
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

        <main className="space-y-5">
          <section className="rounded-[16px] border border-hairline bg-white p-4 shadow-[0_4px_16px_rgba(17,24,28,0.05)]">
            <PageHeader
              title={activeTask ? activeTask.name : t('results.all_results')}
              actions={(
              <div className="flex flex-wrap items-center gap-2" aria-label="导出当前筛选结果">
                {(['csv', 'xlsx', 'zip'] as const).map((fileType) => (
                  <button key={fileType} onClick={() => handleExport(fileType)} disabled={exporting || !totalCount} title={`导出${fileType === 'zip' ? '图像与掩码' : fileType.toUpperCase()}`} className="inline-flex items-center gap-1.5 rounded-[10px] border border-hairline-strong bg-white px-3 py-2 text-sm text-ink-secondary transition-colors hover:bg-surface-sunken disabled:opacity-40">
                    <Download className="h-4 w-4" /><span className="hidden sm:inline">{exporting ? '正在生成…' : fileType === 'zip' ? '图像与掩码ZIP' : `导出${fileType.toUpperCase()}`}</span>
                  </button>
                ))}
              </div>
              )}
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
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
                <option value="all">{t('results.all_status')}</option><option value="review">{t('results.review_pending')}</option>
                <option value="low">{t('results.low_health')}</option>
                <option value="medium">{t('results.medium_disease')}</option>
                <option value="high">{t('results.high_disease')}</option>
              </select>

              <span className="text-sm tabular-nums text-muted">{t('results.results_count', { count: taskResults.length })}</span>

              <div className="ml-auto flex rounded-[10px] bg-surface-sunken p-1">
                <button onClick={() => setViewMode('grid')} className={`rounded-[8px] px-2.5 py-1.5 ${viewMode === 'grid' ? 'bg-white text-ink shadow-sm' : 'text-muted'}`} aria-label="grid"><Grid className="h-4 w-4" /></button>
                <button onClick={() => setViewMode('list')} className={`rounded-[8px] px-2.5 py-1.5 ${viewMode === 'list' ? 'bg-white text-ink shadow-sm' : 'text-muted'}`} aria-label="list"><List className="h-4 w-4" /></button>
              </div>
            </div>
          </section>

          <section className="grid items-start gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="grid grid-cols-2 items-start gap-3 xl:grid-cols-4">
              {metricCards.map((card) => (
                <article key={card.label} className="rounded-[12px] border border-hairline bg-white p-3.5">
                  <p className="text-sm font-medium text-muted">{card.label}</p>
                  <p className="metric-value mt-1.5 text-2xl">{card.value}</p>
                </article>
              ))}
            </div>

            <div className="rounded-[12px] border border-hairline bg-surface-muted p-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted" />
                <h3 className="text-sm font-semibold text-ink">{t('results.health_distribution')}</h3>
              </div>
              <div className="mt-3 space-y-2.5">
                {distribution.map((item) => (
                  <div key={item.label}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-ink-secondary">{item.label}</span>
                      <span className="tabular-nums font-medium text-ink">{item.value} ({item.percent}%)</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-hairline-strong">
                      <div className={`h-full rounded-full ${item.tone === 'rose' ? 'bg-[#d92d20]' : item.tone === 'amber' ? 'bg-[#b54708]' : item.tone === 'emerald' ? 'bg-[#12805c]' : 'bg-[#c8ccd2]'}`} style={{ width: `${item.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-[16px] border border-hairline bg-white p-4 shadow-[0_4px_16px_rgba(17,24,28,0.05)] sm:p-5">
            {invalidTaskParam && (
              <div className="mb-4 rounded-2xl border border-[rgba(245,165,36,0.30)] bg-[rgba(245,165,36,0.12)] px-4 py-3">
                <p className="text-sm font-semibold text-warn-text">{t('not_found.invalid_task')}</p>
                <p className="mt-1 text-sm text-warn-text">{t('not_found.invalid_task_desc')}</p>
              </div>
            )}
            {hasMore && <div className="mb-4 flex items-center justify-between text-sm text-muted"><span>{t('results.loaded_count', { loaded: results.length, total: totalCount })}</span><button onClick={() => { void loadMore(); }} disabled={loadingMore} className="rounded-lg border px-3 py-2">{loadingMore ? t('common.loading') : t('results.load_more')}</button></div>}
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
                  return (
                    <article key={result.id} className={`group card rounded-[16px] border p-3 transition-shadow hover:shadow-lg ${tone}`}>
                        <button className="relative block w-full overflow-hidden rounded-[12px]" onClick={() => { setSelectedResult(result); setEditorOpen(true); }}>
                        <img src={fileUrl(result.imageUrl)} alt={result.imageName} className="aspect-square w-full object-cover" />
                        <div className="absolute inset-x-2 bottom-2 truncate rounded-lg border border-hairline bg-white/95 px-2 py-1 text-center text-xs font-semibold text-ink shadow-sm">
                          <span className="text-muted">{t('results.ppd_value')}</span>{' '}
                          <span className="tabular-nums">{formatPpd(ppdValue)}</span>
                          {result.has_correction ? <span className="font-normal text-warn-text"> · 已校正（未复核）</span> : hasUnknownPpdUnit(result) ? <span className="font-normal text-warn-text"> · 历史单位待确认</span> : null}
                        </div>
                      </button>
                      <div className="mt-3 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink" title={result.imageName}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${severityDot}`} />{result.imageName}</p>
                          <p className="mt-1 truncate text-xs text-muted" title={result.folderName || ''}>{result.folderName || t('results.uncategorized')}</p>{result.measurement?.execution_warning && <p className="mt-1 text-xs text-warn-text">历史模型记录不一致，建议重跑</p>}
                        </div>
                        <button className="rounded-xl border border-hairline bg-white p-2 text-ink-secondary transition hover:text-ink" onClick={() => openZoom(fileUrl(result.imageUrl), [fileUrl(result.imageUrl)])} aria-label={t('results.preview')}>
                          <Eye className="h-4 w-4" />
                        </button>
                      </div>
                      {result.ensemble_details?.members?.length === 2 && <button type="button" onClick={() => { setSelectedResult(result); setModalOpen(true); }} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-white px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-accent-line hover:bg-surface-sunken hover:text-accent-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-line">投票评分</button>}
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
                  return (
                    <article key={result.id} className={`card flex items-center gap-4 rounded-[16px] border p-3 ${tone}`}>
                      <button onClick={() => { setSelectedResult(result); setEditorOpen(true); }} className="overflow-hidden rounded-[12px]">
                        <img src={fileUrl(result.imageUrl)} alt={result.imageName} className="h-20 w-20 object-cover" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <button onClick={() => { setSelectedResult(result); setEditorOpen(true); }} className="flex items-center gap-1.5 truncate text-left text-base font-semibold text-ink"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${severityDot}`} />{result.imageName}</button>
                        <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted">
                          <span>{result.folderName || t('results.uncategorized')}</span>
                          <span>{t('results.ppd_value')}: {formatPpd(ppdValue)} {result.has_correction ? '· 已校正（未复核）' : hasUnknownPpdUnit(result) ? '· 历史单位待确认' : ''}</span>
                          {Array.isArray(result.sub_ppd_values) && result.sub_ppd_values.length > 0 && <span>{t('results.sub_ppd')}: {result.sub_ppd_values.map((v) => Number(v).toFixed(2)).join(', ')}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="rounded-xl border border-hairline bg-white p-2 text-ink-secondary transition hover:text-ink" onClick={() => openZoom(fileUrl(result.imageUrl), [fileUrl(result.imageUrl)])} aria-label={t('results.preview')}><Eye className="h-4 w-4" /></button>
                        <a href={fileUrl(result.imageUrl)} download className="rounded-xl border border-hairline bg-white p-2 text-ink-secondary transition hover:text-ink" aria-label={t('results.download')}><Download className="h-4 w-4" /></a>
                      </div>
                      {result.ensemble_details?.members?.length === 2 && <button type="button" onClick={() => { setSelectedResult(result); setModalOpen(true); }} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-white px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-accent-line hover:bg-surface-sunken hover:text-accent-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-line">投票评分</button>}
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
                <button type="button" className="mt-2 text-sm font-medium text-ink-secondary" onClick={() => { setModalOpen(false); setEditorOpen(true); }}>进入人工校正</button>
              </div>
              <button onClick={() => setModalOpen(false)} className="rounded-2xl border border-hairline p-2 text-muted transition hover:bg-white hover:text-ink-secondary" aria-label={t('results.preview')}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(90vh-88px)] overflow-y-auto px-6 py-6">
                  {selectedResult.ensemble_details?.members?.length === 2 && (
                    <div className="rounded-[16px] border border-hairline bg-white p-5">
                      <h4 className="text-sm font-semibold text-ink">投票模型评分</h4>
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex justify-between font-medium"><span>投票模型 PPD</span><span>{formatPpd(selectedResult.ppdValue)}</span></div>
                        {selectedResult.ensemble_details.members.map(member => <div key={member.model} className="flex justify-between"><span>{modelLabel(member.model)} PPD</span><span>{formatPpd(member.ppd_percent)}</span></div>)}
                        <div className="flex justify-between border-t border-hairline pt-2"><span>模型一致率</span><span>{formatPpd(selectedResult.ensemble_details.agreement_percent)}</span></div>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-ink-secondary">一致率不代表准确率；分歧像素：{selectedResult.ensemble_details.disagreement_pixels}。分歧按平均病变概率裁决。以上为模型原始结果，人工校正后的最终 PPD 单独显示。</p>
                    </div>
                  )}

              <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                <section className="space-y-5">
                  <div className="rounded-[16px] border border-hairline bg-surface-muted p-4">
                    <h4 className="text-sm font-semibold text-ink">{t('results.original_image')}</h4>
                    <img src={fileUrl(selectedResult.imageUrl)} alt={selectedResult.imageName} className="mt-3 w-full rounded-[16px] object-cover shadow-sm" onClick={() => openZoom(fileUrl(selectedResult.imageUrl), [fileUrl(selectedResult.imageUrl)])} />
                  </div>

                  {finalOverlay && <div className="rounded-[16px] border border-hairline bg-white p-4"><h4 className="text-sm font-semibold">人工校正叠加图 · v{selectedResult.latest_correction?.version} · 未复核</h4><img src={finalOverlay} alt="人工校正最终叠加图" className="mt-3 w-full rounded-xl" /><a href={finalOverlay} download={`corrected-${selectedResult.id}.png`} className="mt-2 inline-block text-sm text-ink-secondary">下载校正叠加图</a></div>}
                  {Boolean(selectedResult.latest_correction?.edit_data?.segments) && <p className="text-xs text-muted">校正分段数值见导出表“切面明细”；下方保留模型原始分段用于对照。</p>}
                  {selectedResult.vis_images?.disagreement && <div className="rounded-[16px] border border-[rgba(245,165,36,0.30)] bg-white p-4"><h4 className="text-sm font-semibold">模型分歧范围（白色区域）</h4><p className="mt-1 text-xs text-muted">与原图坐标一致，用于定位需要人工检查的位置。</p><img src={fileUrl(selectedResult.vis_images.disagreement)} alt="模型分歧范围" className="mt-3 w-full rounded-xl" /></div>}
                  {selectedVis.pred.length > 0 && (
                    <div className="rounded-[16px] card p-4">
                      <h4 className="text-sm font-semibold text-ink">模型原始预测图</h4>
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
                      {hasUnknownPpdUnit(selectedResult) && <div className="rounded-lg bg-amber-400/10 px-2 py-1.5 text-xs text-amber-200">该历史结果的 PPD 单位无法确认，建议重新预测。</div>}
                      <div className="flex items-center justify-between border-b border-hairline pb-3"><span className="text-muted">Confidence</span><span className="font-medium">{selectedResult.confidence == null ? '未提供' : `${(selectedResult.confidence * 100).toFixed(1)}%`}</span></div>
                      <div className="flex items-center justify-between border-b border-hairline pb-3"><span className="text-muted">Processing Time</span><span className="font-medium">{selectedResult.processingTime ? `${selectedResult.processingTime}s` : '未记录'}</span></div>
                      <div className="flex items-center justify-between"><span className="text-muted">Segments</span><span className="font-medium">{segmentCount}</span></div>
                    </div>
                  </div>



                  <div className="rounded-[16px] border border-hairline bg-surface-muted p-5">
                    <h4 className="text-sm font-semibold text-ink">模型原始分段 PPD</h4>
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
                        <p className="text-sm text-muted">暂无分段 PPD 数据。</p>
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
