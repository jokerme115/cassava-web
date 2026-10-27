import React, { useMemo, useState } from 'react';
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
import { useNavigate } from 'react-router-dom';
import { PredictionTask, User } from '../types';

interface TaskCenterProps {
  currentUser?: User;
}

const TaskCenter: React.FC<TaskCenterProps> = ({ currentUser }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tasks, loading, cancelTask, deleteTask, retryTask, getTaskStatistics, loadTasks } = useTaskStore(currentUser);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<PredictionTask | null>(null);
  const [showTaskDetail, setShowTaskDetail] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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
    await deleteTask(pendingDelete);
    setConfirmOpen(false);
    setPendingDelete(null);
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
          icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
          chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
          text: t('tasks.status.completed')
        };
      case 'failed':
        return {
          icon: <AlertCircle className="h-4 w-4 text-rose-600" />,
          chip: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
          text: t('tasks.status.failed')
        };
      case 'cancelled':
        return {
          icon: <X className="h-4 w-4 text-slate-500" />,
          chip: 'bg-white/40 text-slate-700 ring-1 ring-inset ring-slate-200',
          text: t('tasks.status.cancelled')
        };
      case 'pending':
        return {
          icon: <Clock3 className="h-4 w-4 text-amber-600" />,
          chip: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
          text: t('tasks.status.pending')
        };
      default:
        return {
          icon: <Clock3 className="h-4 w-4 text-slate-500" />,
          chip: 'bg-white/40 text-slate-700 ring-1 ring-inset ring-slate-200',
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
    { label: t('tasks.total'), value: statistics.total, note: t('navigation.tasks'), icon: <Activity className="h-3.5 w-3.5 text-slate-500" /> },
    { label: t('tasks.completed'), value: statistics.completed, note: t('tasks.status.completed'), icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> },
    { label: t('tasks.running'), value: statistics.running, note: t('tasks.status.running'), icon: <Play className="h-3.5 w-3.5 text-slate-500" /> },
    { label: t('tasks.failed'), value: statistics.failed, note: t('tasks.status.failed'), icon: <AlertCircle className="h-3.5 w-3.5 text-rose-600" /> },
    { label: t('tasks.success_rate'), value: `${statistics.successRate}%`, note: t('tasks.total'), icon: <Clock3 className="h-3.5 w-3.5 text-slate-500" /> }
  ];

  const selectedTaskMeta = selectedTask ? getStatusMeta(selectedTask.status) : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.05),_transparent_32%)] px-3 py-3 sm:px-5 lg:px-6">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3">
        <section className="rounded-[24px] border border-white/80 bg-white/90 px-4 py-3 shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded-full bg-[#0a84ff] p-1.5 text-white" title={t('navigation.tasks')}>
                <Activity className="h-3.5 w-3.5" />
              </span>
              <h2 className="truncate text-lg font-semibold tracking-tight text-slate-900">{t('navigation.tasks')}</h2>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {statCards.map((card) => (
                <span
                  key={card.label}
                  title={card.note}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/60 px-3 py-1 text-xs font-medium text-slate-600"
                >
                  {card.icon}
                  <span className="text-slate-400">{card.label}</span>
                  <span className="font-semibold text-slate-900">{card.value}</span>
                </span>
              ))}
              <button
                onClick={() => { void loadTasks(); }}
                disabled={loading}
                title={t('tasks.refresh')}
                aria-label={t('tasks.refresh')}
                className="inline-flex items-center justify-center rounded-full border border-white/50 bg-[#0a84ff] p-2 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                id="task-search"
                name="task-search"
                type="text"
                placeholder={t('tasks.search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white/45 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white/80"
              />
            </div>
            <select
              id="task-status-filter"
              name="task-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label={t('tasks.all_status')}
              className="w-full rounded-xl border border-slate-200 bg-white/45 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white/80"
            >
              <option value="">{t('tasks.all_status')}</option>
              <option value="running">{t('tasks.status.running')}</option>
              <option value="completed">{t('tasks.status.completed')}</option>
              <option value="failed">{t('tasks.status.failed')}</option>
              <option value="cancelled">{t('tasks.status.cancelled')}</option>
            </select>
          </div>
        </section>

        <section className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/60 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <RefreshCw className="h-4 w-4 animate-spin" />
                {t('tasks.refresh')}
              </div>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <div className="rounded-full bg-white/40 p-3"><Activity className="h-6 w-6 text-slate-400" /></div>
              <h3 className="mt-3 text-base font-semibold text-slate-900">{searchQuery || statusFilter ? t('tasks.no_matches') : t('tasks.no_tasks')}</h3>
              <p className="mt-1 max-w-md text-sm text-slate-500">{searchQuery || statusFilter ? t('tasks.adjust_search') : t('tasks.create_task_tip')}</p>
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
                  <article key={task.id} className="grid gap-3 px-3 py-3 transition hover:bg-white/45 sm:px-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {statusMeta.icon}
                        <h3 className="truncate text-sm font-semibold text-slate-900">{task.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.chip}`}>{statusMeta.text}</span>
                        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                          <span title={t('tasks.model')}>{task.modelType || '--'}</span>
                          <span title={t('tasks.image_count')}>{task.imageCount} {t('tasks.images_unit', { defaultValue: '张' })}</span>
                          <span title={t('tasks.created')}>{new Date(task.createdDate).toLocaleString()}</span>
                          <span title={t('tasks.duration')}>{formatDuration(task.createdDate, task.completedDate, task.status === 'running')}</span>
                        </span>
                      </div>

                      <div className="rounded-[18px] border border-slate-200 bg-white/60 px-3 py-2">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <div className="flex min-w-0 flex-wrap items-center gap-2 text-slate-500">
                            <span className="font-medium text-slate-600">{t('tasks.progress')}</span>
                            <span className="font-semibold text-slate-900">{Math.round(task.progress)}%</span>
                            {task.status === 'pending' && (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
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
                            {task.status === 'completed' && (
                              <button onClick={() => navigate(`/results?task=${task.id}`)} title={t('tasks.view_results')} aria-label={t('tasks.view_results')} className="rounded-lg border border-slate-200 bg-white/60 p-1.5 text-slate-700 transition hover:bg-white/45"><ExternalLink className="h-3.5 w-3.5" /></button>
                            )}
                            {task.status === 'failed' && (
                              <button onClick={() => { void retryTask(task); }} title={t('tasks.retry')} aria-label={t('tasks.retry')} className="rounded-lg border border-slate-200 bg-white/60 p-1.5 text-slate-700 transition hover:bg-white/45"><RotateCcw className="h-3.5 w-3.5" /></button>
                            )}
                            {(task.status === 'pending' || task.status === 'running') && (
                              <button onClick={() => cancelTask(task.id)} title={t('tasks.cancel_task')} aria-label={t('tasks.cancel_task')} className="rounded-lg border border-slate-200 bg-white/60 p-1.5 text-slate-700 transition hover:bg-white/45"><X className="h-3.5 w-3.5" /></button>
                            )}
                            <button onClick={() => { setSelectedTask(task); setShowTaskDetail(true); }} title={t('tasks.details')} aria-label={t('tasks.details')} className="rounded-lg border border-slate-200 bg-white/60 p-1.5 text-slate-700 transition hover:bg-white/45"><Info className="h-3.5 w-3.5" /></button>
                            <button onClick={() => handleDelete(task.id)} title={t('tasks.delete_task')} aria-label={t('tasks.delete_task')} className="rounded-lg border border-slate-200 bg-white/60 p-1.5 text-rose-600 transition hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div className={`h-full rounded-full transition-all duration-500 ${task.status === 'failed' ? 'bg-rose-500' : task.status === 'running' ? 'bg-slate-700' : 'bg-emerald-500'}`} style={{ width: `${Math.max(task.progress, 2)}%` }} />
                        </div>
                        {task.error && (
                          <div className={`mt-2 rounded-xl px-2.5 py-1.5 text-xs leading-5 ${task.status === 'failed' ? 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200' : 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200'}`}>
                            <span className="font-medium">{task.status === 'failed' ? t('tasks.failed_reason') : t('tasks.partial_warning')}：</span>
                            <span className="break-words">{task.error}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
              <div className="py-4 text-center text-xs text-slate-400">{t('tasks.list_end')}</div>
            </div>
          )}
        </section>
      </div>

      {showTaskDetail && selectedTask && selectedTaskMeta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white/60 shadow-[0_30px_120px_rgba(15,23,42,0.18)]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-base font-semibold text-slate-900">{selectedTask.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${selectedTaskMeta.chip}`}>{selectedTaskMeta.text}</span>
              </div>
              <button onClick={() => setShowTaskDetail(false)} className="rounded-xl border border-slate-200 p-1.5 text-slate-500 transition hover:bg-white/45 hover:text-slate-700" title={t('common.close')} aria-label={t('common.close')}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                <section className="space-y-3">
                  <div className="rounded-2xl border border-slate-200 bg-white/60 p-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('tasks.basic_info')}</h4>
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
                          <dt className="shrink-0 text-slate-400">{label}</dt>
                          <dd className="truncate font-medium text-slate-900">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  {selectedTask.error && (
                    <div className={`rounded-2xl border p-3 ${selectedTask.status === 'failed' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}>
                      <h4 className={`text-xs font-semibold ${selectedTask.status === 'failed' ? 'text-rose-800' : 'text-amber-900'}`}>
                        {selectedTask.status === 'failed' ? t('tasks.failed_reason') : t('tasks.partial_warning')}
                      </h4>
                      <p className={`mt-1 break-words text-xs leading-5 ${selectedTask.status === 'failed' ? 'text-rose-700' : 'text-amber-800'}`}>{selectedTask.error}</p>
                    </div>
                  )}

                  {selectedTask.statistics && (
                    <div className="rounded-2xl border border-slate-200 bg-white/60 p-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('tasks.statistics')}</h4>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-xl bg-white/40 px-2.5 py-2"><p className="text-[11px] text-slate-500">{t('tasks.healthy_samples')}</p><p className="mt-0.5 text-lg font-semibold text-slate-900">{selectedTask.statistics.healthyCount}</p></div>
                        <div className="rounded-xl bg-rose-50 px-2.5 py-2"><p className="text-[11px] text-rose-700">{t('tasks.disease_samples')}</p><p className="mt-0.5 text-lg font-semibold text-rose-900">{selectedTask.statistics.diseaseCount}</p></div>
                        <div className="rounded-xl bg-white/40 px-2.5 py-2"><p className="text-[11px] text-slate-500">{t('tasks.avg_confidence')}</p><p className="mt-0.5 text-lg font-semibold text-slate-900">{(selectedTask.statistics.averageConfidence * 100).toFixed(1)}%</p></div>
                        <div className="rounded-xl bg-white/40 px-2.5 py-2"><p className="text-[11px] text-slate-500">{t('tasks.processing_time')}</p><p className="mt-0.5 text-lg font-semibold text-slate-900">{selectedTask.statistics.processingTime}s</p></div>
                      </div>

                      <div className="mt-3 grid gap-2 lg:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 bg-white/40 p-2.5">
                          <h5 className="text-[11px] font-semibold text-slate-600">{t('tasks.health_distribution')}</h5>
                          <div className="mt-2 space-y-2">
                            {[{ label: t('tasks.healthy'), value: selectedTask.statistics.healthyCount, color: 'bg-slate-700' }, { label: t('tasks.disease'), value: selectedTask.statistics.diseaseCount, color: 'bg-rose-500' }].map((item) => {
                              const percent = selectedTask.statistics && selectedTask.statistics.totalProcessed > 0 ? (item.value / selectedTask.statistics.totalProcessed) * 100 : 0;
                              return (
                                <div key={item.label}>
                                  <div className="mb-1 flex items-center justify-between text-[11px]">
                                    <span className="text-slate-600">{item.label}</span>
                                    <span className="font-medium text-slate-900">{item.value} ({percent.toFixed(1)}%)</span>
                                  </div>
                                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                                    <div className={`h-full rounded-full ${item.color}`} style={{ width: `${percent}%` }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white/40 p-2.5">
                          <h5 className="text-[11px] font-semibold text-slate-600">{t('tasks.efficiency')}</h5>
                          <div className="mt-2 space-y-1.5 text-[11px]">
                            <div className="flex items-center justify-between"><span className="text-slate-500">{t('tasks.total_time')}</span><span className="font-medium text-slate-900">{formatDuration(selectedTask.createdDate, selectedTask.completedDate, selectedTask.status === 'running')}</span></div>
                            <div className="flex items-center justify-between"><span className="text-slate-500">{t('tasks.avg_per_image')}</span><span className="font-medium text-slate-900">{selectedTask.statistics.processingTime ? (selectedTask.statistics.processingTime / selectedTask.statistics.totalProcessed).toFixed(2) : '0.00'}s</span></div>
                            <div className="flex items-center justify-between"><span className="text-slate-500">{t('tasks.processing_speed')}</span><span className="font-medium text-slate-900">{selectedTask.statistics.processingTime ? (selectedTask.statistics.totalProcessed / selectedTask.statistics.processingTime).toFixed(2) : '0.00'} {t('tasks.per_second')}</span></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                <aside className="space-y-3">
                  <div className="rounded-2xl bg-[linear-gradient(135deg,#0a84ff_0%,#5856d6_100%)] p-3 text-white">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">{t('tasks.parameters')}</h4>
                    <div className="mt-2 space-y-1.5 text-[11px]">
                      {[
                        [t('prediction.confidence_threshold'), selectedTask.parameters?.confidenceThreshold || 0.5],
                        [t('prediction.post_processing'), selectedTask.parameters?.usePostProcessing ? t('common.yes') : t('common.no')],
                        [t('prediction.tta'), selectedTask.parameters?.useTTA ? t('common.yes') : t('common.no')],
                        [t('prediction.min_area'), selectedTask.parameters?.minArea || 100],
                        [t('prediction.morph_kernel'), selectedTask.parameters?.morphKernelSize || 5],
                        [t('prediction.morph_iterations'), selectedTask.parameters?.morphIterations || 1],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="flex items-center justify-between gap-2">
                          <span className="text-slate-400">{label}</span>
                          <span className="font-medium">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white/40 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-600">{t('tasks.progress')}</span>
                      <span className="font-medium text-slate-900">{t('tasks.processed_count', { done: selectedTask.resultCount ?? Math.floor((selectedTask.progress / 100) * selectedTask.imageCount), total: selectedTask.imageCount })}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-slate-700" style={{ width: `${Math.max(selectedTask.progress, 2)}%` }} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {selectedTask.status === 'completed' && (
                        <button onClick={() => { setShowTaskDetail(false); navigate(`/results?task=${selectedTask.id}`); }} className="inline-flex items-center gap-1.5 rounded-xl bg-[#0a84ff] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#0070d6]"><ExternalLink className="h-3.5 w-3.5" />{t('tasks.view_results')}</button>
                      )}
                      {selectedTask.status === 'failed' && (
                        <button onClick={() => { void retryTask(selectedTask); setShowTaskDetail(false); }} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/60 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-white/45"><RotateCcw className="h-3.5 w-3.5" />{t('tasks.retry')}</button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[28px] border border-slate-200 bg-white/60 p-6 shadow-[0_30px_120px_rgba(15,23,42,0.18)]">
            <h3 className="text-lg font-semibold text-slate-900">{t('tasks.confirm_delete')}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{t('tasks.delete_warning')}</p>
            <div className="mt-6 flex justify-end gap-3">
              <button className="rounded-2xl border border-slate-200 bg-white/60 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/45" onClick={() => setConfirmOpen(false)}>{t('tasks.delete_cancel')}</button>
              <button className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700" onClick={confirmDelete}>{t('tasks.delete_confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskCenter;
