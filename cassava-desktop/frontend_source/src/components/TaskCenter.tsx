import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  Play,
  RefreshCw,
  Search,
  Trash2,
  X,
  CheckSquare,
  Square
} from 'lucide-react';
import { useTaskStore } from '../hooks/useTaskStore';
import { useTranslation } from 'react-i18next';
import { PredictionTask, User } from '../types';

interface TaskCenterProps {
  currentUser?: User;
}

const TaskCenter: React.FC<TaskCenterProps> = ({ currentUser }) => {
  const { t } = useTranslation();
  const { tasks, loading, cancelTask, deleteTask, getTaskStatistics, loadTasks } = useTaskStore(currentUser);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<PredictionTask | null>(null);
  const [showTaskDetail, setShowTaskDetail] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

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
    const deleted = await deleteTask(pendingDelete);
    if (deleted) {
      setConfirmOpen(false);
      setPendingDelete(null);
      setSelectedTaskIds(prev => {
        const next = new Set(prev);
        next.delete(pendingDelete);
        return next;
      });
    }
  };

  const toggleSelectTask = (taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedTaskIds.size === filteredTasks.length) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(filteredTasks.map(t => t.id)));
    }
  };

  const handleBatchCancel = async () => {
    for (const taskId of selectedTaskIds) {
      const task = tasks.find(t => t.id === taskId);
      if (task && task.status === 'running') {
        await cancelTask(taskId);
      }
    }
    setSelectedTaskIds(new Set());
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
          chip: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
          text: t('tasks.status.cancelled')
        };
      default:
        return {
          icon: <Clock3 className="h-4 w-4 text-slate-500" />,
          chip: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
          text: status
        };
    }
  };

  const formatDuration = (startDate: string, endDate?: string) => {
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

  const getTaskErrorMessage = (task: PredictionTask | null) => {
    const rawMessage = (task?.errorMessage || task?.error_message || '').trim();
    if (!rawMessage) return '';

    const lowerMessage = rawMessage.toLowerCase();
    if (rawMessage.includes('没有可处理的图片') || rawMessage.includes('没有待处理的图片')) {
      return t('tasks.error_no_images');
    }
    if (rawMessage.includes('无法获取图片文件') || rawMessage.includes('无法读取图片') || lowerMessage.includes('no such file')) {
      return t('tasks.error_image_unavailable');
    }
    if (rawMessage.includes('无法加载') || rawMessage.includes('模型') || lowerMessage.includes('checkpoint') || lowerMessage.includes('model')) {
      return t('tasks.error_model_unavailable');
    }
    if (lowerMessage.includes('cuda') || lowerMessage.includes('out of memory') || rawMessage.includes('显存')) {
      return t('tasks.error_gpu_unavailable');
    }
    if (rawMessage.includes('logger') || rawMessage.includes('内部')) {
      return t('tasks.error_internal');
    }
    return rawMessage.length > 180 ? t('tasks.error_generic') : rawMessage;
  };

  const statCards = [
    { label: t('tasks.total'), value: statistics.total, note: t('navigation.tasks'), icon: <Activity className="h-5 w-5 text-slate-700" /> },
    { label: t('tasks.completed'), value: statistics.completed, note: t('tasks.status.completed'), icon: <CheckCircle2 className="h-5 w-5 text-emerald-700" /> },
    { label: t('tasks.running'), value: statistics.running, note: t('tasks.status.running'), icon: <Play className="h-5 w-5 text-sky-700" /> },
    { label: t('tasks.failed'), value: statistics.failed, note: t('tasks.status.failed'), icon: <AlertCircle className="h-5 w-5 text-rose-700" /> },
    { label: t('tasks.success_rate'), value: `${statistics.successRate}%`, note: t('tasks.total'), icon: <Clock3 className="h-5 w-5 text-amber-700" /> }
  ];

  const selectedTaskMeta = selectedTask ? getStatusMeta(selectedTask.status) : null;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(20,83,45,0.08),_transparent_28%),linear-gradient(180deg,#f7faf7_0%,#eef2ef_100%)] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                <Activity className="h-3.5 w-3.5" />
                Operations
              </span>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{t('navigation.tasks')}</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Monitor task progress, runtime status and output quality from one focused workspace.</p>
              </div>
            </div>
            <button
              onClick={loadTasks}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {t('tasks.refresh')}
            </button>
            {selectedTaskIds.size > 0 && (
              <>
                <span className="text-sm text-slate-500">{selectedTaskIds.size} selected</span>
                <button
                  onClick={handleBatchCancel}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
                >
                  <X className="h-4 w-4" />
                  Cancel Selected
                </button>
              </>
            )}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {statCards.map((card) => (
            <article key={card.label} className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-500">{card.label}</p>
                  <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{card.value}</p>
                  <p className="mt-2 text-xs text-slate-500">{card.note}</p>
                </div>
                <div className="rounded-2xl bg-slate-100 p-3">{card.icon}</div>
              </div>
            </article>
          ))}
        </section>

        <section className="rounded-[28px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_rgba(15,23,42,0.05)] sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <label htmlFor="task-search" className="sr-only">{t('tasks.search')}</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="task-search"
                  name="task-search"
                  type="text"
                  placeholder={t('tasks.search')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </div>
            </div>
            <div>
              <label htmlFor="task-status-filter" className="sr-only">{t('tasks.all_status')}</label>
              <select
                id="task-status-filter"
                name="task-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="">{t('tasks.all_status')}</option>
                <option value="running">{t('tasks.status.running')}</option>
                <option value="completed">{t('tasks.status.completed')}</option>
                <option value="failed">{t('tasks.status.failed')}</option>
                <option value="cancelled">{t('tasks.status.cancelled')}</option>
              </select>
            </div>
          </div>
        </section>

        <section className="rounded-[30px] border border-slate-200/80 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <RefreshCw className="h-4 w-4 animate-spin" />
                {t('tasks.refresh')}
              </div>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
              <div className="rounded-full bg-slate-100 p-4"><Activity className="h-8 w-8 text-slate-400" /></div>
              <h3 className="mt-5 text-lg font-semibold text-slate-900">{searchQuery || statusFilter ? t('tasks.no_matches') : t('tasks.no_tasks')}</h3>
              <p className="mt-2 max-w-md text-sm text-slate-500">{searchQuery || statusFilter ? t('tasks.adjust_search') : t('tasks.create_task_tip')}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-100">
                <button onClick={toggleSelectAll} className="text-slate-600 hover:text-slate-900">
                  {selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0
                    ? <CheckSquare className="h-5 w-5 text-emerald-600" />
                    : <Square className="h-5 w-5" />
                  }
                </button>
                <span className="text-sm text-slate-500">Select all</span>
              </div>
              {filteredTasks.map((task) => {
                const statusMeta = getStatusMeta(task.status);
                const completionValue = task.status === 'completed' && task.statistics?.totalProcessed ? task.statistics.totalProcessed : Math.floor((task.progress / 100) * task.imageCount);
                const isSelected = selectedTaskIds.has(task.id);
                const taskErrorMessage = getTaskErrorMessage(task);

                return (
                  <article key={task.id} className={`grid gap-4 px-4 py-5 transition sm:px-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] ${isSelected ? 'bg-emerald-50/50' : 'hover:bg-slate-50/80'}`}>
                    <button onClick={() => toggleSelectTask(task.id)} className="self-center text-slate-600 hover:text-slate-900">
                      {isSelected
                        ? <CheckSquare className="h-5 w-5 text-emerald-600" />
                        : <Square className="h-5 w-5" />
                      }
                    </button>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {statusMeta.icon}
                          <h3 className="text-lg font-semibold text-slate-900">{task.name}</h3>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusMeta.chip}`}>{statusMeta.text}</span>
                        </div>
                        <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl bg-slate-50 px-3 py-2"><span className="text-slate-400">{t('tasks.model')}</span><p className="mt-1 font-medium text-slate-900">{task.modelType || '--'}</p></div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-2"><span className="text-slate-400">{t('tasks.image_count')}</span><p className="mt-1 font-medium text-slate-900">{task.imageCount}</p></div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-2"><span className="text-slate-400">{t('tasks.created')}</span><p className="mt-1 font-medium text-slate-900">{new Date(task.createdDate).toLocaleString()}</p></div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-2"><span className="text-slate-400">{t('tasks.duration')}</span><p className="mt-1 font-medium text-slate-900">{formatDuration(task.createdDate, task.completedDate)}</p></div>
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-600">{t('tasks.progress')}</span>
                          <span className="font-semibold text-slate-900">{Math.round(task.progress)}%</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                          <div className={`h-full rounded-full transition-all duration-500 ${task.status === 'failed' ? 'bg-rose-500' : task.status === 'running' ? 'bg-sky-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(task.progress, 2)}%` }} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                          <span>{t('tasks.processed_count', { processed: completionValue, total: task.imageCount })}</span>
                          {task.statistics?.averageConfidence !== undefined && <span>Avg confidence {(task.statistics.averageConfidence * 100).toFixed(1)}%</span>}
                          {task.statistics?.processingTime !== undefined && <span>Runtime {task.statistics.processingTime}s</span>}
                        </div>
                      </div>
                      {task.status === 'failed' && taskErrorMessage && (
                        <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">
                          <div className="flex gap-2">
                            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                            <span>{taskErrorMessage}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 lg:flex-col lg:items-stretch">
                      {task.status === 'running' && <button onClick={() => cancelTask(task.id)} className="inline-flex items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100" title={t('tasks.cancel_task')}><X className="mr-1.5 h-4 w-4" />{t('tasks.cancel_task')}</button>}
                      <button onClick={() => { setSelectedTask(task); setShowTaskDetail(true); }} className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">{t('tasks.details')}</button>
                      <button onClick={() => handleDelete(task.id)} className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:border-rose-200 hover:bg-rose-50" title={t('tasks.delete_task')}><Trash2 className="mr-1.5 h-4 w-4" />{t('tasks.delete_task')}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {showTaskDetail && selectedTask && selectedTaskMeta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_30px_120px_rgba(15,23,42,0.18)]">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-semibold text-slate-900">{selectedTask.name}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${selectedTaskMeta.chip}`}>{selectedTaskMeta.text}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{t('tasks.task_details')}</p>
              </div>
              <button onClick={() => setShowTaskDetail(false)} className="rounded-2xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700" aria-label={t('tasks.details')}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(90vh-88px)] overflow-y-auto px-6 py-6">
              <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
                <section className="space-y-5">
                  <div className="rounded-[28px] border border-slate-200 bg-slate-50/70 p-5">
                    <h4 className="text-base font-semibold text-slate-900">{t('tasks.basic_info')}</h4>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <div className="rounded-2xl bg-white px-4 py-3"><p className="text-xs uppercase tracking-wide text-slate-400">{t('tasks.task_name')}</p><p className="mt-1 text-sm font-medium text-slate-900">{selectedTask.name}</p></div>
                      <div className="rounded-2xl bg-white px-4 py-3"><p className="text-xs uppercase tracking-wide text-slate-400">{t('tasks.model')}</p><p className="mt-1 text-sm font-medium text-slate-900">{selectedTask.modelType}</p></div>
                      <div className="rounded-2xl bg-white px-4 py-3"><p className="text-xs uppercase tracking-wide text-slate-400">{t('tasks.image_count')}</p><p className="mt-1 text-sm font-medium text-slate-900">{selectedTask.imageCount}</p></div>
                      <div className="rounded-2xl bg-white px-4 py-3"><p className="text-xs uppercase tracking-wide text-slate-400">{t('tasks.created')}</p><p className="mt-1 text-sm font-medium text-slate-900">{new Date(selectedTask.createdDate).toLocaleString()}</p></div>
                      <div className="rounded-2xl bg-white px-4 py-3"><p className="text-xs uppercase tracking-wide text-slate-400">{t('tasks.duration')}</p><p className="mt-1 text-sm font-medium text-slate-900">{formatDuration(selectedTask.createdDate, selectedTask.completedDate)}</p></div>
                      <div className="rounded-2xl bg-white px-4 py-3"><p className="text-xs uppercase tracking-wide text-slate-400">{t('tasks.progress')}</p><p className="mt-1 text-sm font-medium text-slate-900">{Math.round(selectedTask.progress)}%</p></div>
                    </div>
                  </div>

                  {selectedTask.statistics && (
                    <div className="rounded-[28px] border border-slate-200 bg-white p-5">
                      <h4 className="text-base font-semibold text-slate-900">{t('tasks.statistics')}</h4>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl bg-emerald-50 px-4 py-4"><p className="text-xs uppercase tracking-wide text-emerald-700">{t('tasks.healthy_samples')}</p><p className="mt-2 text-2xl font-semibold text-emerald-950">{selectedTask.statistics.healthyCount}</p></div>
                        <div className="rounded-2xl bg-rose-50 px-4 py-4"><p className="text-xs uppercase tracking-wide text-rose-700">{t('tasks.disease_samples')}</p><p className="mt-2 text-2xl font-semibold text-rose-950">{selectedTask.statistics.diseaseCount}</p></div>
                        <div className="rounded-2xl bg-sky-50 px-4 py-4"><p className="text-xs uppercase tracking-wide text-sky-700">{t('tasks.avg_confidence')}</p><p className="mt-2 text-2xl font-semibold text-sky-950">{(selectedTask.statistics.averageConfidence * 100).toFixed(1)}%</p></div>
                        <div className="rounded-2xl bg-amber-50 px-4 py-4"><p className="text-xs uppercase tracking-wide text-amber-700">{t('tasks.processing_time')}</p><p className="mt-2 text-2xl font-semibold text-amber-950">{selectedTask.statistics.processingTime}s</p></div>
                      </div>

                      <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                          <h5 className="text-sm font-semibold text-slate-900">{t('tasks.health_distribution')}</h5>
                          <div className="mt-4 space-y-4">
                            {[{ label: t('tasks.healthy'), value: selectedTask.statistics.healthyCount, color: 'bg-emerald-500' }, { label: t('tasks.disease'), value: selectedTask.statistics.diseaseCount, color: 'bg-rose-500' }].map((item) => {
                              const percent = selectedTask.statistics && selectedTask.statistics.totalProcessed > 0 ? (item.value / selectedTask.statistics.totalProcessed) * 100 : 0;
                              return (
                                <div key={item.label}>
                                  <div className="mb-2 flex items-center justify-between text-sm">
                                    <span className="text-slate-600">{item.label}</span>
                                    <span className="font-medium text-slate-900">{item.value} ({percent.toFixed(1)}%)</span>
                                  </div>
                                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                                    <div className={`h-full rounded-full ${item.color}`} style={{ width: `${percent}%` }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                          <h5 className="text-sm font-semibold text-slate-900">{t('tasks.efficiency')}</h5>
                          <div className="mt-4 space-y-3 text-sm">
                            <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3"><span className="text-slate-500">{t('tasks.total_time')}</span><span className="font-medium text-slate-900">{formatDuration(selectedTask.createdDate, selectedTask.completedDate)}</span></div>
                            <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3"><span className="text-slate-500">{t('tasks.avg_per_image')}</span><span className="font-medium text-slate-900">{selectedTask.statistics.processingTime ? (selectedTask.statistics.processingTime / selectedTask.statistics.totalProcessed).toFixed(2) : '0.00'}s</span></div>
                            <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3"><span className="text-slate-500">{t('tasks.processing_speed')}</span><span className="font-medium text-slate-900">{selectedTask.statistics.processingTime ? (selectedTask.statistics.totalProcessed / selectedTask.statistics.processingTime).toFixed(2) : '0.00'} {t('tasks.per_second')}</span></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                <aside className="space-y-5">
                  {selectedTask.status === 'failed' && getTaskErrorMessage(selectedTask) && (
                    <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-5 text-rose-900">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 h-5 w-5 flex-none text-rose-600" />
                        <div>
                          <h4 className="text-base font-semibold">{t('tasks.failure_reason')}</h4>
                          <p className="mt-2 text-sm leading-6">{getTaskErrorMessage(selectedTask)}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-[28px] border border-slate-200 bg-slate-900 p-5 text-white">
                    <h4 className="text-base font-semibold">{t('tasks.parameters')}</h4>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between border-b border-white/10 pb-3"><span className="text-slate-300">{t('prediction.confidence_threshold')}</span><span className="font-medium">{selectedTask.parameters?.confidenceThreshold || 0.5}</span></div>
                      <div className="flex items-center justify-between border-b border-white/10 pb-3"><span className="text-slate-300">{t('prediction.post_processing')}</span><span className="font-medium">{selectedTask.parameters?.usePostProcessing ? t('images.create') : t('images.cancel')}</span></div>
                      <div className="flex items-center justify-between border-b border-white/10 pb-3"><span className="text-slate-300">{t('prediction.tta')}</span><span className="font-medium">{selectedTask.parameters?.useTTA ? t('images.create') : t('images.cancel')}</span></div>
                      <div className="flex items-center justify-between border-b border-white/10 pb-3"><span className="text-slate-300">{t('prediction.min_area')}</span><span className="font-medium">{selectedTask.parameters?.minArea || 100}</span></div>
                      <div className="flex items-center justify-between border-b border-white/10 pb-3"><span className="text-slate-300">{t('prediction.morph_kernel')}</span><span className="font-medium">{selectedTask.parameters?.morphKernelSize || 5}</span></div>
                      <div className="flex items-center justify-between"><span className="text-slate-300">{t('prediction.morph_iterations')}</span><span className="font-medium">{selectedTask.parameters?.morphIterations || 1}</span></div>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                    <h4 className="text-base font-semibold text-slate-900">{t('tasks.progress')}</h4>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(selectedTask.progress, 2)}%` }} />
                    </div>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3"><span className="text-slate-500">{t('tasks.overall_progress')}</span><span className="font-medium text-slate-900">{Math.round(selectedTask.progress)}%</span></div>
                      <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3"><span className="text-slate-500">{t('tasks.processed')}</span><span className="font-medium text-slate-900">{Math.floor((selectedTask.progress / 100) * selectedTask.imageCount)} / {selectedTask.imageCount}</span></div>
                      <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3"><span className="text-slate-500">{t('tasks.status_text')}</span><span className="font-medium text-slate-900">{selectedTaskMeta.text}</span></div>
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
          <div className="w-full max-w-sm rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_30px_120px_rgba(15,23,42,0.18)]">
            <h3 className="text-lg font-semibold text-slate-900">{t('tasks.confirm_delete')}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{t('tasks.delete_warning')}</p>
            <div className="mt-6 flex justify-end gap-3">
              <button className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => setConfirmOpen(false)}>{t('tasks.delete_cancel')}</button>
              <button className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700" onClick={confirmDelete}>{t('tasks.delete_confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskCenter;
