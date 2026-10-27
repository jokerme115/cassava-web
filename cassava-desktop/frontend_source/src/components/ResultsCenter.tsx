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
import { resolveFileUrl } from '../services/api';
import { useTranslation } from 'react-i18next';
import { PredictionResult, User } from '../types';

interface ResultsCenterProps {
  currentUser?: User;
}

const ResultsCenter: React.FC<ResultsCenterProps> = ({ currentUser }) => {
  const { t } = useTranslation();
  const { results, exportResults, loading: resultsLoading } = useResultsStore(currentUser);
  const { tasks, loading: tasksLoading } = useTaskStore(currentUser);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<PredictionResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [zoomGroup, setZoomGroup] = useState<string[]>([]);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  const isLoading = resultsLoading || tasksLoading;

  const fileUrl = (value: string) => {
    return resolveFileUrl(value);
  };

  const buildVisList = (vis: Record<string, string> | undefined, prefix: string) =>
    Object.entries(vis || {})
      .filter(([key, value]) => key.startsWith(prefix) && value)
      .sort((a, b) => Number(a[0].slice(prefix.length)) - Number(b[0].slice(prefix.length)))
      .map(([, value]) => fileUrl(value));

  const taskResults = useMemo(() => {
    let filtered = selectedTaskId ? results.filter((r) => r.taskId === selectedTaskId) : results;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((r) => r.imageName?.toLowerCase().includes(q) || r.folderName?.toLowerCase().includes(q));
    }
    if (filterStatus !== 'all') {
      filtered = filtered.filter((r) => {
        const ppd = Number(r.ppdValue) || 0;
        if (filterStatus === 'high') return ppd >= 7;
        if (filterStatus === 'medium') return ppd >= 4 && ppd < 7;
        return ppd < 4;
      });
    }
    return filtered;
  }, [selectedTaskId, results, searchQuery, filterStatus]);

  const totalPages = Math.max(1, Math.ceil(taskResults.length / pageSize));
  const pageStartIndex = (currentPage - 1) * pageSize;
  const pagedResults = useMemo(
    () => taskResults.slice(pageStartIndex, pageStartIndex + pageSize),
    [taskResults, pageStartIndex, pageSize]
  );
  const pageStartDisplay = taskResults.length ? pageStartIndex + 1 : 0;
  const pageEndDisplay = Math.min(taskResults.length, pageStartIndex + pageSize);

  const stats = useMemo(() => {
    if (!taskResults.length) return null;
    const ppds = taskResults.map((r) => Number(r.ppdValue) || 0);
    const severe = ppds.filter((p) => p >= 7).length;
    const mild = ppds.filter((p) => p >= 4 && p < 7).length;
    const healthy = ppds.filter((p) => p < 4).length;
    return {
      total: taskResults.length,
      avg: (ppds.reduce((a, b) => a + b, 0) / ppds.length).toFixed(2),
      max: Math.max(...ppds).toFixed(2),
      min: Math.min(...ppds).toFixed(2),
      healthy,
      mild,
      severe
    };
  }, [taskResults]);

  const distribution = useMemo(() => {
    if (!stats || !stats.total) return [];
    return [
      { label: `${t('results.severe_disease')} (>= 7)`, value: stats.severe, tone: 'rose' },
      { label: `${t('results.mild_disease')} (4-7)`, value: stats.mild, tone: 'amber' },
      { label: `${t('results.healthy')} (< 4)`, value: stats.healthy, tone: 'emerald' }
    ].map((item) => ({ ...item, percent: ((item.value / stats.total) * 100).toFixed(1) }));
  }, [stats, t]);

  useEffect(() => {
    if (taskResults.length > 0) {
      setSelectedResult(taskResults[0]);
    } else {
      setSelectedResult(null);
    }
  }, [taskResults]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedTaskId, searchQuery, filterStatus]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const selectedVis = useMemo(() => {
    if (!selectedResult) return { cut2: [], pred: [] };
    const vis = selectedResult.vis_images || {};
    return { cut2: buildVisList(vis, 'cut2_'), pred: buildVisList(vis, 'pred_') };
  }, [selectedResult]);

  const segmentCount = useMemo(() => {
    if (!selectedResult) return 0;
    const raw = selectedResult.split_count ?? selectedResult.splitCount;
    if (typeof raw === 'number' && raw > 0) return raw;
    if (Array.isArray(selectedResult.sub_ppd_values) && selectedResult.sub_ppd_values.length) return selectedResult.sub_ppd_values.length;
    if (selectedVis.pred.length) return selectedVis.pred.length;
    if (selectedVis.cut2.length) return selectedVis.cut2.length;
    return 0;
  }, [selectedResult, selectedVis]);

  const handleExportCsv = useCallback(() => {
    const exportSource = selectedTaskId ? results.filter((r) => r.taskId === selectedTaskId) : results;
    exportResults(selectedTaskId || undefined, exportSource);
  }, [exportResults, selectedTaskId, results]);

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

  const activeTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) : null;
  const metricCards = [
    { label: t('results.total_images'), value: stats?.total || 0 },
    { label: t('results.avg_ppd'), value: stats?.avg || '-' },
    { label: t('results.max_ppd'), value: stats?.max || '-' },
    { label: t('results.min_ppd'), value: stats?.min || '-' }
  ];

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f6f8f5_0%,#eef2ef_100%)] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-[30px] border border-slate-200/80 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <div className="rounded-[24px] bg-slate-900 px-4 py-5 text-white">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-300">Results Workspace</p>
            <h2 className="mt-3 text-2xl font-semibold">{t('navigation.results')}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">Start from a task, then review metrics, filter results and export data without overloading one screen.</p>
          </div>

          <button
            onClick={() => setSelectedTaskId(null)}
            className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${!selectedTaskId ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">All Results</p>
                <p className="mt-1 text-xs text-slate-500">{results.length} records</p>
              </div>
              <Target className="h-4 w-4 text-slate-400" />
            </div>
          </button>

          <div className="space-y-3">
            {tasks.map((task) => {
              const taskCount = results.filter((result) => result.taskId === task.id).length;
              return (
                <button
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${selectedTaskId === task.id ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{task.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{task.modelType || '--'} · {taskCount} records</p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                      {Math.round(task.progress)}%
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="space-y-5">
          <section className="rounded-[30px] border border-slate-200/80 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">{activeTask ? activeTask.name : 'All Tasks'}</p>
                <h3 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{t('navigation.results')}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {activeTask ? `Focused on ${activeTask.name} for detailed review and export.` : 'Showing results from every task. Narrow to a single task when you need a tighter review pass.'}
                </p>
              </div>
              <button onClick={handleExportCsv} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800">
                <Download className="h-4 w-4" />
                {t('results.export_csv')}
              </button>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metricCards.map((card) => (
                <article key={card.label} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                  <p className="text-sm font-medium text-slate-500">{card.label}</p>
                  <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">{card.value}</p>
                </article>
              ))}
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-slate-500" />
                <h4 className="text-sm font-semibold text-slate-900">{t('results.health_distribution')}</h4>
              </div>
              <div className="mt-4 space-y-4">
                {distribution.map((item) => (
                  <div key={item.label}>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="text-slate-600">{item.label}</span>
                      <span className="font-medium text-slate-900">{item.value} ({item.percent}%)</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                      <div className={`h-full rounded-full ${item.tone === 'rose' ? 'bg-rose-500' : item.tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${item.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200/80 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)] sm:p-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="grid flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                  <label htmlFor="results-search" className="sr-only">{t('results.search')}</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input id="results-search" name="results-search" type="text" placeholder={t('results.search')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100" />
                  </div>
                </div>
                <div>
                  <label htmlFor="results-status-filter" className="sr-only">{t('results.all_status')}</label>
                  <select id="results-status-filter" name="results-status-filter" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as 'all' | 'high' | 'medium' | 'low')} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100">
                    <option value="all">{t('results.all_status')}</option>
                    <option value="low">{t('results.low_health')}</option>
                    <option value="medium">{t('results.medium_disease')}</option>
                    <option value="high">{t('results.high_disease')}</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-500">
                  {t('results.results_count', { count: taskResults.length })}
                  {taskResults.length > 0 ? ` · ${pageStartDisplay}-${pageEndDisplay} / ${taskResults.length}` : ''}
                </span>
                <div className="flex rounded-2xl bg-slate-100 p-1">
                  <button onClick={() => setViewMode('grid')} className={`rounded-xl px-3 py-2 ${viewMode === 'grid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`} aria-label="grid"><Grid className="h-4 w-4" /></button>
                  <button onClick={() => setViewMode('list')} className={`rounded-xl px-3 py-2 ${viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`} aria-label="list"><List className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200/80 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)] sm:p-5">
            {isLoading && taskResults.length === 0 ? (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">{t('common.loading')}</div>
            ) : taskResults.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                <div className="rounded-full bg-slate-100 p-4"><ImageIcon className="h-8 w-8 text-slate-400" /></div>
                <h4 className="mt-5 text-lg font-semibold text-slate-900">{t('results.no_results')}</h4>
                <p className="mt-2 max-w-md text-sm text-slate-500">{searchQuery || filterStatus !== 'all' ? t('results.adjust_search_results') : t('results.complete_task_tip')}</p>
              </div>
            ) : (
              <>
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {pagedResults.map((result) => {
                  const ppdValue = Number(result.ppdValue) || 0;
                  const tone = ppdValue >= 7 ? 'border-rose-200 bg-rose-50' : ppdValue >= 4 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50';
                  return (
                    <article key={result.id} className={`group rounded-[24px] border p-3 transition hover:-translate-y-0.5 hover:shadow-lg ${tone}`}>
                      <button className="relative block w-full overflow-hidden rounded-[18px]" onClick={() => { setSelectedResult(result); setModalOpen(true); }}>
                        <img src={fileUrl(result.imageUrl)} alt={result.imageName} className="aspect-square w-full object-cover" />
                        <div className="absolute inset-x-2 bottom-2 rounded-full bg-slate-950/75 px-2 py-1 text-center text-xs font-medium text-white">
                          {t('results.ppd_value')}: {typeof result.ppdValue === 'number' ? result.ppdValue.toFixed(2) : result.ppdValue}
                        </div>
                      </button>
                      <div className="mt-3 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900" title={result.imageName}>{result.imageName}</p>
                          <p className="mt-1 truncate text-xs text-slate-500" title={result.folderName || ''}>{result.folderName || t('results.uncategorized')}</p>
                        </div>
                        <button className="rounded-xl border border-white/80 bg-white/80 p-2 text-slate-600 transition hover:text-slate-900" onClick={() => openZoom(fileUrl(result.imageUrl), [fileUrl(result.imageUrl)])} aria-label={t('results.preview')}>
                          <Eye className="h-4 w-4" />
                        </button>
                      </div>
                    </article>
                  );
                })}
                </div>
              ) : (
                <div className="space-y-3">
                {pagedResults.map((result) => {
                  const ppdValue = Number(result.ppdValue) || 0;
                  const tone = ppdValue >= 7 ? 'border-rose-200 bg-rose-50' : ppdValue >= 4 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50';
                  return (
                    <article key={result.id} className={`flex items-center gap-4 rounded-[24px] border p-3 ${tone}`}>
                      <button onClick={() => { setSelectedResult(result); setModalOpen(true); }} className="overflow-hidden rounded-[18px]">
                        <img src={fileUrl(result.imageUrl)} alt={result.imageName} className="h-20 w-20 object-cover" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <button onClick={() => { setSelectedResult(result); setModalOpen(true); }} className="truncate text-left text-base font-semibold text-slate-900">{result.imageName}</button>
                        <div className="mt-1 flex flex-wrap gap-3 text-sm text-slate-500">
                          <span>{result.folderName || t('results.uncategorized')}</span>
                          <span>{t('results.ppd_value')}: {typeof result.ppdValue === 'number' ? result.ppdValue.toFixed(2) : result.ppdValue}</span>
                          {Array.isArray(result.sub_ppd_values) && result.sub_ppd_values.length > 0 && <span>{t('results.sub_ppd')}: {result.sub_ppd_values.map((v) => Number(v).toFixed(2)).join(', ')}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="rounded-xl border border-white/80 bg-white/80 p-2 text-slate-600 transition hover:text-slate-900" onClick={() => openZoom(fileUrl(result.imageUrl), [fileUrl(result.imageUrl)])} aria-label={t('results.preview')}><Eye className="h-4 w-4" /></button>
                        <a href={fileUrl(result.imageUrl)} download className="rounded-xl border border-white/80 bg-white/80 p-2 text-slate-600 transition hover:text-slate-900" aria-label={t('results.download')}><Download className="h-4 w-4" /></a>
                      </div>
                    </article>
                  );
                })}
                </div>
              )}
              {taskResults.length > pageSize && (
                <div className="mt-5 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-slate-500">
                    {pageStartDisplay}-{pageEndDisplay} / {taskResults.length}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      disabled={currentPage <= 1}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('results.prev_page')}
                    </button>
                    {Array.from({ length: totalPages }, (_, index) => index + 1)
                      .filter((page) => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 2)
                      .map((page, index, pages) => {
                        const prev = pages[index - 1];
                        return (
                          <React.Fragment key={page}>
                            {prev && page - prev > 1 && <span className="px-1 text-sm text-slate-400">...</span>}
                            <button
                              onClick={() => setCurrentPage(page)}
                              className={`h-9 min-w-9 rounded-xl px-3 text-sm font-medium transition ${currentPage === page ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                            >
                              {page}
                            </button>
                          </React.Fragment>
                        );
                      })}
                    <button
                      onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                      disabled={currentPage >= totalPages}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('results.next_page')}
                    </button>
                  </div>
                </div>
              )}
              </>
            )}
          </section>
        </main>
      </div>

      {modalOpen && selectedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_30px_120px_rgba(15,23,42,0.18)]">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">{selectedResult.imageName}</h3>
                <p className="mt-1 text-sm text-slate-500">{selectedResult.folderName || t('results.uncategorized')}</p>
              </div>
              <button onClick={() => setModalOpen(false)} className="rounded-2xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700" aria-label={t('results.preview')}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(90vh-88px)] overflow-y-auto px-6 py-6">
              <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                <section className="space-y-5">
                  <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
                    <h4 className="text-sm font-semibold text-slate-900">{t('results.original_image')}</h4>
                    <img src={fileUrl(selectedResult.imageUrl)} alt={selectedResult.imageName} className="mt-3 w-full rounded-[20px] object-cover shadow-sm" onClick={() => openZoom(fileUrl(selectedResult.imageUrl), [fileUrl(selectedResult.imageUrl)])} />
                  </div>

                  {selectedVis.pred.length > 0 && (
                    <div className="rounded-[28px] border border-slate-200 bg-white p-4">
                      <h4 className="text-sm font-semibold text-slate-900">{t('results.prediction_results')}</h4>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {selectedVis.pred.map((img, index) => (
                          <button key={`${img}-${index}`} onClick={() => openZoom(img, selectedVis.pred)} className="overflow-hidden rounded-[20px] border border-slate-200 bg-slate-50">
                            <img src={img} alt={`prediction-${index + 1}`} className="aspect-square w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedVis.cut2.length > 0 && (
                    <div className="rounded-[28px] border border-slate-200 bg-white p-4">
                      <h4 className="text-sm font-semibold text-slate-900">{t('results.second_cut')}</h4>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {selectedVis.cut2.map((img, index) => (
                          <button key={`${img}-${index}`} onClick={() => openZoom(img, selectedVis.cut2)} className="overflow-hidden rounded-[20px] border border-slate-200 bg-slate-50">
                            <img src={img} alt={`cut-${index + 1}`} className="aspect-square w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                <aside className="space-y-4">
                  <div className="rounded-[28px] border border-slate-200 bg-slate-900 p-5 text-white">
                    <h4 className="text-sm font-semibold">{t('results.result_details')}</h4>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between border-b border-white/10 pb-3"><span className="text-slate-300">{t('results.ppd_value')}</span><span className="font-medium">{typeof selectedResult.ppdValue === 'number' ? selectedResult.ppdValue.toFixed(2) : selectedResult.ppdValue}</span></div>
                      <div className="flex items-center justify-between border-b border-white/10 pb-3"><span className="text-slate-300">Confidence</span><span className="font-medium">{(Number(selectedResult.confidence || 0) * 100).toFixed(1)}%</span></div>
                      <div className="flex items-center justify-between border-b border-white/10 pb-3"><span className="text-slate-300">Processing Time</span><span className="font-medium">{selectedResult.processingTime || 0}s</span></div>
                      <div className="flex items-center justify-between"><span className="text-slate-300">Segments</span><span className="font-medium">{segmentCount}</span></div>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                    <h4 className="text-sm font-semibold text-slate-900">Sub PPD</h4>
                    <div className="mt-4 space-y-3">
                      {Array.isArray(selectedResult.sub_ppd_values) && selectedResult.sub_ppd_values.length > 0 ? (
                        selectedResult.sub_ppd_values.map((value, index) => (
                          <div key={`${value}-${index}`}>
                            <div className="mb-1 flex items-center justify-between text-sm">
                              <span className="text-slate-500">Part {index + 1}</span>
                              <span className="font-medium text-slate-900">{Number(value).toFixed(2)}</span>
                            </div>
                            <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                              <div className={`h-full rounded-full ${Number(value) >= 7 ? 'bg-rose-500' : Number(value) >= 4 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(Number(value) * 10, 100)}%` }} />
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500">{t('results.no_segment_ppd')}</p>
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
          <button onClick={() => setZoomImg(null)} className="absolute right-6 top-6 rounded-full border border-white/20 bg-white/10 p-2 text-white" aria-label="close zoom">
            <X className="h-5 w-5" />
          </button>
          <img src={zoomImg} alt="zoom" className="max-h-[88vh] max-w-[92vw] rounded-[24px] object-contain shadow-2xl" />
        </div>
      )}
    </div>
  );
};

export default ResultsCenter;
