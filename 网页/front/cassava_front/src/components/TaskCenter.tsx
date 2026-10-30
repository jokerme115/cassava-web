import { useViewState } from '../utils/useViewState';
import WorkspacePagination from './WorkspacePagination';
import { tasksApi } from '../services/api';
import { message } from '../utils/feedback';
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Info,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X
} from 'lucide-react';
import { useTaskStore } from '../hooks/useTaskStore';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from './PageHeader';
import { PredictionTask, User } from '../types';

interface TaskCenterProps {
  currentUser?: User;
}

const TaskCenter: React.FC<TaskCenterProps> = ({ currentUser }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedLink = useRef<string | null>(null);
  const [searchQuery, setSearchQuery] = useViewState('task-search', '');
  const [statusFilter, setStatusFilter] = useViewState<string>('task-status', '');
  const [page, setPage] = useViewState('task-page', 1);
  const [pageSize, setPageSize] = useViewState('task-page-size', 48);
  const { tasks, totalCount, loading, cancelTask, deleteTask, retryTask, getTaskStatistics, loadTasks } = useTaskStore(currentUser, { search: searchQuery, status: statusFilter, page, pageSize, onInvalidPage: () => setPage(1) });
  const [selectedTask, setSelectedTask] = useState<PredictionTask | null>(null);
  const [showTaskDetail, setShowTaskDetail] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    const id = searchParams.get('task');
    if (id && id !== focusedLink.current) {
      const task = tasks.find(item => String(item.id) === id);
      if (task) { setSelectedTask(task); setShowTaskDetail(true); focusedLink.current = id; }
      else if (!loading) {
        focusedLink.current = id;
        void tasksApi.getById(id).then(item => { setSelectedTask(item); setShowTaskDetail(true); }).catch(() => message.error('任务不存在或无权访问'));
      }
    }
    setSelectedTask(current => current ? tasks.find(item => item.id === current.id) || current : current);
  }, [tasks, searchParams, loading]);

  const statistics = getTaskStatistics();

  const filteredTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.name.toLowerCase().includes(searchQuery.toLowerCase()))
        .filter((task) => !statusFilter || task.status === statusFilter),
    [tasks, searchQuery, statusFilter]
  );

  const handleDelete = (id: string) => {
    setPendingDelete(id);
    setConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteTask(pendingDelete);
      if (tasks.length === 1 && page > 1) setPage(page - 1);
      setConfirmOpen(false);
      setPendingDelete(null);
    } catch { message.error('移入回收站失败，请重试'); }
  };

  const getStatusMeta = (status: string) => {
    switch (status) {
      case 'running':
        return {
          icon: <Play className="h-4 w-4 text-sky-600" />,
          chip: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
          text: t('tasks.status.running')
        };
      case 'completed':
        return {
          icon: <CheckCircle2 className="h-4 w-4 text-accent-text" />,
          chip: 'bg-[rgba(10,132,255,0.08)] text-brand-fill-hover ring-1 ring-inset ring-[rgba(23,201,100,0.28)]',
          text: t('tasks.status.completed')
        };
      case 'failed':
        return {
          icon: <AlertCircle className="h-4 w-4 text-danger-strong" />,
          chip: 'bg-[rgba(243,18,96,0.08)] text-danger-strong ring-1 ring-inset ring-[rgba(243,18,96,0.24)]',
          text: t('tasks.status.failed')
        };
      case 'cancelled':
        return {
          icon: <X className="h-4 w-4 text-muted" />,
          chip: 'bg-surface-muted text-ink-secondary ring-1 ring-inset ring-hairline',
          text: t('tasks.status.cancelled')
        };
      case 'pending':
        return {
          icon: <Clock3 className="h-4 w-4 text-warn-text" />,
          chip: 'bg-[rgba(245,165,36,0.12)] text-warn-text ring-1 ring-inset ring-[rgba(245,165,36,0.30)]',
          text: t('tasks.status.pending')
        };
      default:
        return {
          icon: <Clock3 className="h-4 w-4 text-muted" />,
          chip: 'bg-surface-muted text-ink-secondary ring-1 ring-inset ring-hairline',
          text: status
        };
    }
  };

  const formatDuration = (startDate: string, endDate?: string, running = false) => {
    // 非运行中且无结束时间（如历史失败任务）时不能用“现在”计算，否则会显示数千小时。
    if (!endDate && !running) return '--';
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date();
    const diffMs = end.getTime() - start.getTime();
    const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);

    if (diffHours > 0) return `${diffHours}${t('tasks.hours')}${diffMins % 60}${t('tasks.minutes')}`;
    if (diffMins > 0) return `${diffMins}${t('tasks.minutes')}${diffSecs % 60}${t('tasks.seconds')}`;
    return `${diffSecs}${t('tasks.seconds')}`;
  };

  const statCards = [
    { label: t('tasks.total'), value: statistics.total, note: t('navigation.tasks'), icon: <Activity className="h-3.5 w-3.5 text-muted" /> },
    { label: t('tasks.completed'), value: statistics.completed, note: t('tasks.status.completed'), icon: <CheckCircle2 className="h-3.5 w-3.5 text-accent-text" /> },
    { label: t('tasks.running'), value: statistics.running, note: t('tasks.status.running'), icon: <Play className="h-3.5 w-3.5 text-muted" /> },
    { label: t('tasks.failed'), value: statistics.failed, note: t('tasks.status.failed'), icon: <AlertCircle className="h-3.5 w-3.5 text-danger-strong" /> },
    { label: t('tasks.success_rate'), value: `${statistics.successRate}%`, note: t('tasks.total'), icon: <Clock3 className="h-3.5 w-3.5 text-muted" /> }
  ];

  const selectedTaskMeta = selectedTask ? getStatusMeta(selectedTask.status) : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-muted px-3 py-3 sm:px-5 lg:px-6">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3">
        <section className="rounded-[16px] border border-hairline bg-white px-4 py-3 shadow-[0_4px_16px_rgba(17,24,28,0.05)]">
          <div className="flex flex-wrap items-center gap-3">
            <PageHeader title={t('navigation.tasks')} className="min-w-0 flex-1" />

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {statCards.map((card) => (
                <span
                  key={card.label}
                  title={card.note}
                  className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-muted px-3 py-1 text-xs font-medium text-ink-secondary"
                >
                  {card.icon}
                  <span className="text-muted">{card.label}</span>
                  <span className="font-semibold text-ink">{card.value}</span>
                </span>
              ))}
              <button
                onClick={() => { void loadTasks(); }}
                disabled={loading}
                title={t('tasks.refresh')}
                aria-label={t('tasks.refresh')}
                className="inline-flex items-center justify-center rounded-full border border-hairline bg-white p-2 text-ink-secondary transition hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                id="task-search"
                name="task-search"
                type="text"
                placeholder={t('tasks.search')}
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                className="w-full rounded-xl border border-hairline bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </div>
            <select
              id="task-status-filter"
              name="task-status-filter"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              aria-label={t('tasks.all_status')}
              className="w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-slate-400 focus:bg-white"
            >
              <option value="">{t('tasks.all_status')}</option>
              <option value="running">{t('tasks.status.running')}</option>
              <option value="completed">{t('tasks.status.completed')}</option>
              <option value="failed">{t('tasks.status.failed')}</option>
              <option value="cancelled">{t('tasks.status.cancelled')}</option>
            </select>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-hairline/80 bg-white shadow-[0_4px_16px_rgba(17,24,28,0.05)]">
          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex items-center gap-3 text-sm text-muted">
                <RefreshCw className="h-4 w-4 animate-spin" />
                {t('tasks.refresh')}
              </div>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <div className="rounded-full bg-surface-muted p-3"><Activity className="h-6 w-6 text-muted" /></div>
              <h3 className="mt-3 text-base font-semibold text-ink">{searchQuery || statusFilter ? t('tasks.no_matches') : t('tasks.no_tasks')}</h3>
              <p className="mt-1 max-w-md text-sm text-muted">{searchQuery || statusFilter ? t('tasks.adjust_search') : t('tasks.create_task_tip')}</p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
              {filteredTasks.map((task) => {
                const statusMeta = getStatusMeta(task.status);
                // 完成任务以实际产出结果条数为准：文件夹任务的 imageCount 会随文件夹内容变化，
                // 用进度乘总数会把历史任务算错。
                const isDone = task.status === 'completed';
                const doneCount = task.resultCount ?? task.statistics?.totalProcessed ?? Math.floor((task.progress / 100) * task.imageCount);

                return (
                  <article key={task.id} className="grid gap-3 px-3 py-3 transition hover:bg-white sm:px-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {statusMeta.icon}
                        <h3 className="truncate text-sm font-semibold text-ink">{task.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusMeta.chip}`}>{statusMeta.text}</span>
                        <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <span className="font-medium text-ink-secondary" title={t('tasks.model')}>{task.modelType || '--'}</span>
                          <span className="text-muted">{task.imageCount} {t('tasks.images_unit', { defaultValue: '张' })}</span>
                          <span className="text-hairline-strong" aria-hidden="true">·</span>
                          <span className="text-muted" title={t('tasks.created')}>{new Date(task.createdDate).toLocaleString()}</span>
                          <span className="text-hairline-strong" aria-hidden="true">·</span>
                          <span className="text-muted" title={t('tasks.duration')}>{formatDuration(task.createdDate, task.completedDate, task.status === 'running')}</span>
                        </span>
                      </div>

                      <div className="rounded-[12px] border border-hairline bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <div className="flex min-w-0 flex-wrap items-center gap-2 text-muted">
                            <span className="font-medium text-ink-secondary">{t('tasks.progress')}</span>
                            <span className="font-semibold text-ink">{Math.round(task.progress)}%</span>
                            {task.status === 'pending' && (
                              <span className="rounded-full bg-[rgba(245,165,36,0.12)] px-2 py-0.5 font-medium text-warn-text ring-1 ring-inset ring-[rgba(245,165,36,0.30)]">
                                {task.queuePosition && task.queuePosition > 1
                                  ? t('tasks.queue_position', { position: task.queuePosition })
                                  : t('tasks.queue_next')}
                              </span>
                            )}
                            <span>{t('tasks.processed_count', { done: isDone ? doneCount : Math.floor((task.progress / 100) * task.imageCount), total: isDone ? Math.max(doneCount, task.imageCount) : task.imageCount })}</span>
                            {task.statistics?.averageConfidence !== undefined && <span>{t('tasks.avg_confidence_short', { value: (task.statistics.averageConfidence * 100).toFixed(1) })}</span>}
                            {task.statistics?.processingTime !== undefined && <span>{t('tasks.runtime_short', { value: task.statistics.processingTime })}</span>}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {task.status === 'completed' && task.type !== 'upload' && (
                              <button onClick={() => navigate(`/results?task=${task.id}`)} title={t('tasks.view_results')} aria-label={t('tasks.view_results')} className="rounded-lg border border-hairline bg-white p-1.5 text-ink-secondary transition hover:bg-white"><ExternalLink className="h-3.5 w-3.5" /></button>
                            )}
                            {task.status === 'failed' && task.type !== 'upload' && (
                              <button onClick={() => { void retryTask(task); }} title={t('tasks.retry')} aria-label={t('tasks.retry')} className="rounded-lg border border-hairline bg-white p-1.5 text-ink-secondary transition hover:bg-white"><RotateCcw className="h-3.5 w-3.5" /></button>
                            )}
                            {(task.status === 'pending' || task.status === 'running') && (
                              <button onClick={() => cancelTask(task.id)} title={t('tasks.cancel_task')} aria-label={t('tasks.cancel_task')} className="rounded-lg border border-hairline bg-white p-1.5 text-ink-secondary transition hover:bg-white"><X className="h-3.5 w-3.5" /></button>
                            )}
                            <button onClick={() => { setSelectedTask(task); setShowTaskDetail(true); setSearchParams({ task: task.id }); }} title={t('tasks.details')} aria-label={t('tasks.details')} className="rounded-lg border border-hairline bg-white p-1.5 text-ink-secondary transition hover:bg-white"><Info className="h-3.5 w-3.5" /></button>
                            <button onClick={() => handleDelete(task.id)} title={t('tasks.delete_task')} aria-label={t('tasks.delete_task')} className="rounded-lg border border-hairline bg-white p-1.5 text-danger-strong transition hover:bg-[rgba(243,18,96,0.08)]"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hairline">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${task.status === 'failed' ? 'bg-danger' : task.status === 'running' ? 'bg-brand-fill' : 'bg-brand-fill/55'}`}
                            style={{ width: `${Math.max(task.progress, 2)}%` }}
                          />
                        </div>
                        {task.error && (
                          <div className={`mt-2 rounded-xl px-2.5 py-1.5 text-xs leading-5 ${task.status === 'failed' ? 'bg-[rgba(243,18,96,0.08)] text-danger-strong ring-1 ring-inset ring-[rgba(243,18,96,0.24)]' : 'bg-[rgba(245,165,36,0.12)] text-warn-text ring-1 ring-inset ring-[rgba(245,165,36,0.30)]'}`}>
                            <span className="font-medium">{task.status === 'failed' ? t('tasks.failed_reason') : t('tasks.partial_warning')}：</span>
                            <span className="break-words">{task.error}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}

            </div>
          )}
        </section>
        <WorkspacePagination page={page} pageSize={pageSize} total={totalCount} onChange={(next, size) => { setPage(size === pageSize ? next : 1); setPageSize(size); }} />
      </div>

      {showTaskDetail && selectedTask && selectedTaskMeta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[16px] border border-hairline bg-white shadow-[0_30px_120px_rgba(15,23,42,0.18)]">
            <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-base font-semibold text-ink">{selectedTask.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${selectedTaskMeta.chip}`}>{selectedTaskMeta.text}</span>
              </div>
              <button onClick={() => { setShowTaskDetail(false); setSearchParams({}, { replace: true }); }} className="rounded-xl border border-hairline p-1.5 text-muted transition hover:bg-white hover:text-ink-secondary" title={t('common.close')} aria-label={t('common.close')}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                <section className="space-y-3">
                  <div className="rounded-2xl border border-hairline bg-white p-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('tasks.basic_info')}</h4>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                      {[
                        [t('tasks.model'), selectedTask.modelType],
                        [t('tasks.image_count'), selectedTask.imageCount],
                        [t('tasks.progress'), `${Math.round(selectedTask.progress)}%`],
                        [t('tasks.created'), new Date(selectedTask.createdDate).toLocaleString()],
                        [t('tasks.duration'), formatDuration(selectedTask.createdDate, selectedTask.completedDate, selectedTask.status === 'running')],
                        [t('tasks.status_text'), selectedTaskMeta.text],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="flex min-w-0 items-baseline gap-1.5">
                          <dt className="shrink-0 text-muted">{label}</dt>
                          <dd className="truncate font-medium text-ink">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  {selectedTask.error && (
                    <div className={`rounded-2xl border p-3 ${selectedTask.status === 'failed' ? 'border-[rgba(243,18,96,0.24)] bg-[rgba(243,18,96,0.08)]' : 'border-[rgba(245,165,36,0.30)] bg-[rgba(245,165,36,0.12)]'}`}>
                      <h4 className={`text-xs font-semibold ${selectedTask.status === 'failed' ? 'text-danger-strong' : 'text-warn-text'}`}>
                        {selectedTask.status === 'failed' ? t('tasks.failed_reason') : t('tasks.partial_warning')}
                      </h4>
                      <p className={`mt-1 break-words text-xs leading-5 ${selectedTask.status === 'failed' ? 'text-danger-strong' : 'text-warn-text'}`}>{selectedTask.error}</p>
                    </div>
                  )}

                  {selectedTask.statistics && (
                    <div className="rounded-2xl border border-hairline bg-white p-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('tasks.statistics')}</h4>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-xl bg-surface-muted px-2.5 py-2"><p className="text-xs text-muted">{t('tasks.healthy_samples')}</p><p className="mt-0.5 text-lg font-semibold text-ink">{selectedTask.statistics.healthyCount}</p></div>
                        <div className="rounded-xl bg-[rgba(243,18,96,0.08)] px-2.5 py-2"><p className="text-xs text-danger-strong">{t('tasks.disease_samples')}</p><p className="mt-0.5 text-lg font-semibold text-danger-strong">{selectedTask.statistics.diseaseCount}</p></div>
                        <div className="rounded-xl bg-surface-muted px-2.5 py-2"><p className="text-xs text-muted">{t('tasks.avg_confidence')}</p><p className="mt-0.5 text-lg font-semibold text-ink">{(selectedTask.statistics.averageConfidence * 100).toFixed(1)}%</p></div>
                        <div className="rounded-xl bg-surface-muted px-2.5 py-2"><p className="text-xs text-muted">{t('tasks.processing_time')}</p><p className="mt-0.5 text-lg font-semibold text-ink">{selectedTask.statistics.processingTime}s</p></div>
                      </div>

                      <div className="mt-3 grid gap-2 lg:grid-cols-2">
                        <div className="rounded-xl border border-hairline bg-surface-muted p-2.5">
                          <h5 className="text-xs font-semibold text-ink-secondary">{t('tasks.health_distribution')}</h5>
                          <div className="mt-2 space-y-2">
                            {[{ label: t('tasks.healthy'), value: selectedTask.statistics.healthyCount, color: 'bg-slate-700' }, { label: t('tasks.disease'), value: selectedTask.statistics.diseaseCount, color: 'bg-danger' }].map((item) => {
                              const percent = selectedTask.statistics && selectedTask.statistics.totalProcessed > 0 ? (item.value / selectedTask.statistics.totalProcessed) * 100 : 0;
                              return (
                                <div key={item.label}>
                                  <div className="mb-1 flex items-center justify-between text-xs">
                                    <span className="text-ink-secondary">{item.label}</span>
                                    <span className="font-medium text-ink">{item.value} ({percent.toFixed(1)}%)</span>
                                  </div>
                                  <div className="h-1.5 overflow-hidden rounded-full bg-hairline">
                                    <div className={`h-full rounded-full ${item.color}`} style={{ width: `${percent}%` }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="rounded-xl border border-hairline bg-surface-muted p-2.5">
                          <h5 className="text-xs font-semibold text-ink-secondary">{t('tasks.efficiency')}</h5>
                          <div className="mt-2 space-y-1.5 text-xs">
                            <div className="flex items-center justify-between"><span className="text-muted">{t('tasks.total_time')}</span><span className="font-medium text-ink">{formatDuration(selectedTask.createdDate, selectedTask.completedDate, selectedTask.status === 'running')}</span></div>
                            <div className="flex items-center justify-between"><span className="text-muted">{t('tasks.avg_per_image')}</span><span className="font-medium text-ink">{selectedTask.statistics.processingTime ? (selectedTask.statistics.processingTime / selectedTask.statistics.totalProcessed).toFixed(2) : '0.00'}s</span></div>
                            <div className="flex items-center justify-between"><span className="text-muted">{t('tasks.processing_speed')}</span><span className="font-medium text-ink">{selectedTask.statistics.processingTime ? (selectedTask.statistics.totalProcessed / selectedTask.statistics.processingTime).toFixed(2) : '0.00'} {t('tasks.per_second')}</span></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                <aside className="space-y-3">
                  <div className="rounded-2xl bg-brand-fill p-3 text-white">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('tasks.parameters')}</h4>
                    <div className="mt-2 space-y-1.5 text-xs">
                      {[
                        [t('prediction.confidence_threshold'), selectedTask.parameters?.confidenceThreshold || 0.5],
                        [t('prediction.post_processing'), selectedTask.parameters?.usePostProcessing ? t('common.yes') : t('common.no')],
                        [t('prediction.tta'), selectedTask.parameters?.useTTA ? t('common.yes') : t('common.no')],
                        [t('prediction.min_area'), selectedTask.parameters?.minArea || 100],
                        [t('prediction.morph_kernel'), selectedTask.parameters?.morphKernelSize || 5],
                        [t('prediction.morph_iterations'), selectedTask.parameters?.morphIterations || 1],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="flex items-center justify-between gap-2">
                          <span className="text-muted">{label}</span>
                          <span className="font-medium">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-hairline bg-surface-muted p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-ink-secondary">{t('tasks.progress')}</span>
                      <span className="font-medium text-ink">{t('tasks.processed_count', { done: selectedTask.resultCount ?? Math.floor((selectedTask.progress / 100) * selectedTask.imageCount), total: selectedTask.imageCount })}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hairline">
                      <div className="h-full rounded-full bg-slate-700" style={{ width: `${Math.max(selectedTask.progress, 2)}%` }} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {selectedTask.status === 'completed' && selectedTask.type !== 'upload' && (
                        <button onClick={() => { setShowTaskDetail(false); navigate(`/results?task=${selectedTask.id}`); }} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-fill px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-fill-hover"><ExternalLink className="h-3.5 w-3.5" />{t('tasks.view_results')}</button>
                      )}
                      {selectedTask.status === 'failed' && selectedTask.type !== 'upload' && (
                        <button onClick={() => { void retryTask(selectedTask); setShowTaskDetail(false); }} className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-white"><RotateCcw className="h-3.5 w-3.5" />{t('tasks.retry')}</button>
                      )}
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-sm rounded-[16px] border border-hairline bg-white p-6 shadow-[0_30px_120px_rgba(15,23,42,0.18)]">
            <h3 className="text-lg font-semibold text-ink">{t('tasks.confirm_delete')}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">{t('tasks.delete_warning')}</p>
            <div className="mt-6 flex justify-end gap-3">
              <button className="rounded-2xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-secondary transition hover:bg-white" onClick={() => setConfirmOpen(false)}>{t('tasks.delete_cancel')}</button>
              <button className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700" onClick={confirmDelete}>{t('tasks.delete_confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskCenter;
