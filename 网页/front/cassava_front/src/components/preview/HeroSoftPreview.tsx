import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Clock3, ExternalLink, Folder, Image as ImageIcon, Info, Layers, RotateCcw, Trash2 } from 'lucide-react';
import { predictionsApi, tasksApi } from '../../services/api';
import { useTranslation } from 'react-i18next';

/**
 * HeroUI 风格样板（选项 C：柔和现代 Apple 派）
 * 只做视觉样板，不接任何写操作；数据仅读取真实任务与结果，便于与现有页面直接对比。
 *
 * 设计口径（不用 Glass，改柔和实底）：
 * - 页面底色 #f7f8fa 纯色，不铺渐变、不铺色斑
 * - 卡片 #ffffff + 28px 大圆角 + 1px #ededf2 描边 + 极淡阴影
 * - 强调色只有一支 iOS 蓝；状态色只用 绿/橙/情绪红 三支，且只做小圆点或胶囊
 * - 数据层级靠字号与留白，不靠颜色堆叠
 */

const ACCENT = '#0a84ff';
const OK = '#17c964';
const WARN = '#f5a524';
const DANGER = '#f31260';
const INK = '#11181c';
const MUTED = '#687076';

type Sample = 'tasks' | 'results';

const card = 'rounded-[16px] border border-hairline bg-white shadow-[0_10px_30px_rgba(17,17,26,0.045)]';

const statusTone: Record<string, { color: string; label: string }> = {
  completed: { color: OK, label: '已完成' },
  running: { color: ACCENT, label: '运行中' },
  pending: { color: MUTED, label: '排队中' },
  failed: { color: DANGER, label: '失败' },
};

const Pill = ({ color, children }: { color: string; children: React.ReactNode }) => (
  <span
    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
    style={{ color, background: `${color}14` }}
  >
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
    {children}
  </span>
);

const Metric = ({ label, value, suffix, delta, tone }: { label: string; value: string | number; suffix?: string; delta?: string; tone: string }) => (
  <div className={`${card} p-4 sm:p-5`}>
    <div className="flex items-center justify-between">
      <p className="text-[12px] sm:text-[13px]" style={{ color: MUTED }}>{label}</p>
      <span className="h-2 w-2 rounded-full" style={{ background: tone }} />
    </div>
    <p className="mt-3 text-[26px] font-semibold leading-none tracking-tight sm:mt-4 sm:text-[32px]" style={{ color: INK }}>
      {value}
      {suffix && <span className="ml-1 text-sm font-medium sm:text-base" style={{ color: MUTED }}>{suffix}</span>}
    </p>
    {delta && (
      <span className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium sm:mt-3 sm:text-[11px]" style={{ color: tone, background: `${tone}14` }}>
        {delta}
      </span>
    )}
  </div>
);

const Bar = ({ percent, tone = ACCENT }: { percent: number; tone?: string }) => (
  <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: '#f0f1f4' }}>
    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(2, Math.min(100, percent))}%`, background: tone }} />
  </div>
);

const HeroSoftPreview = () => {
  const { t } = useTranslation();
  const [sample, setSample] = useState<Sample>('tasks');
  const [tasks, setTasks] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [taskRes, resultRes] = await Promise.all([
          tasksApi.getAll({ page_size: 20, ordering: '-created_time' }),
          predictionsApi.getAll({ page_size: 12, ordering: '-prediction_time' }),
        ]);
        if (!alive) return;
        setTasks(Array.isArray(taskRes?.items) ? taskRes.items : []);
        setResults(Array.isArray(resultRes?.results) ? resultRes.results : []);
      } catch {
        if (alive) { setTasks([]); setResults([]); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((item) => item.status === 'completed').length;
    const running = tasks.filter((item) => item.status === 'running').length;
    const failed = tasks.filter((item) => item.status === 'failed').length;
    return { total, completed, running, failed, rate: total ? Math.round((completed / total) * 100) : 0 };
  }, [tasks]);

  const ppd = useMemo(() => {
    const values = results
      .map((item) => (item.prediction?.ppd_value ?? item.prediction?.ppdValue ?? item.ppd_value ?? null))
      .filter((value): value is number => typeof value === 'number');
    if (!values.length) return { avg: null as number | null, max: null as number | null, min: null as number | null };
    return {
      avg: values.reduce((sum, value) => sum + value, 0) / values.length,
      max: Math.max(...values),
      min: Math.min(...values),
    };
  }, [results]);

  const health = useMemo(() => {
    const buckets = [
      { key: '严重', color: DANGER, test: (v: number) => v >= 7 },
      { key: '轻微', color: WARN, test: (v: number) => v >= 4 && v < 7 },
      { key: '健康', color: OK, test: (v: number) => v < 4 },
    ];
    const values = results
      .map((item) => (item.prediction?.ppd_value ?? item.ppd_value ?? null))
      .filter((value): value is number => typeof value === 'number');
    const total = values.length || 1;
    return buckets.map((bucket) => {
      const count = values.filter(bucket.test).length;
      return { ...bucket, count, percent: Math.round((count / total) * 100) };
    });
  }, [results]);

  const fmt = (value: number | null) => (value === null ? '—' : value.toFixed(2));

  return (
    <div className="h-full w-full overflow-y-auto" style={{ background: '#f7f8fa' }}>
      <div className="mx-auto w-full max-w-[1240px] px-5 py-8 sm:px-8">
        {/* 页头 */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.18em]" style={{ color: MUTED }}>Design preview · Option C</p>
            <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight" style={{ color: INK }}>柔和现代样板</h1>
            <p className="mt-1.5 max-w-xl text-[14px] leading-6" style={{ color: MUTED }}>
              HeroUI 口径：纯色浅底 + 28px 大圆角白卡 + 单一 iOS 蓝强调 + 系统色只做小面积标识。仅视觉样板，不影响主流程。
            </p>
          </div>
          <div className="inline-flex rounded-full border border-hairline bg-white p-1">
            {(['tasks', 'results'] as Sample[]).map((key) => (
              <button
                key={key}
                onClick={() => setSample(key)}
                className="rounded-full px-4 py-2 text-[13px] font-medium transition-colors"
                style={sample === key ? { background: ACCENT, color: '#fff' } : { color: MUTED }}
              >
                {key === 'tasks' ? '任务中心样板' : '结果中心样板'}
              </button>
            ))}
          </div>
        </header>

        {sample === 'tasks' ? (
          <section className="mt-8 space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <Metric label="总任务" value={stats.total} tone={ACCENT} delta="累计提交" />
              <Metric label="已完成" value={stats.completed} tone={OK} delta={`成功率 ${stats.rate}%`} />
              <Metric label="运行中" value={stats.running} tone={ACCENT} />
              <Metric label="失败" value={stats.failed} tone={DANGER} delta={stats.failed ? '需要复核' : '无'} />
            </div>

            <div className={`${card} overflow-hidden`}>
              <div className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-[17px] font-semibold" style={{ color: INK }}>任务列表</h2>
                  <p className="mt-1 text-[13px]" style={{ color: MUTED }}>每条任务一行，进度与操作都在同一行内完成</p>
                </div>
                <button className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 sm:px-4" style={{ background: ACCENT }}>
                  新建任务 <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="divide-y" style={{ borderColor: '#f2f2f6' }}>
                {loading && <div className="px-6 py-10 text-center text-[13px]" style={{ color: MUTED }}>加载中…</div>}
                {!loading && tasks.length === 0 && (
                  <div className="px-6 py-12 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: '#f4f5f7' }}>
                      <Layers className="h-5 w-5" style={{ color: MUTED }} />
                    </div>
                    <p className="mt-3 text-[14px] font-medium" style={{ color: INK }}>还没有任务</p>
                    <p className="mt-1 text-[13px]" style={{ color: MUTED }}>先在预测页选图提交，任务会出现在这里</p>
                  </div>
                )}
                {tasks.slice(0, 6).map((task) => {
                  const tone = statusTone[task.status] ?? statusTone.pending;
                  return (
                    <div key={task.id} className="grid grid-cols-1 items-center gap-4 px-6 py-4 transition-colors hover:bg-surface-muted lg:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[14px] font-medium" style={{ color: INK }}>{task.name}</p>
                          <Pill color={tone.color}>{tone.label}</Pill>
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                          <Bar percent={task.progress ?? 0} tone={task.status === 'failed' ? DANGER : ACCENT} />
                          <span className="shrink-0 text-[12px] tabular-nums" style={{ color: MUTED }}>
                            {task.progress ?? 0}% · {task.image_count ?? 0} 张
                          </span>
                        </div>
                        {task.error && <p className="mt-2 truncate text-[12px]" style={{ color: DANGER }}>{task.error}</p>}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {[ExternalLink, RotateCcw, Info, Trash2].map((Icon, index) => (
                          <button
                            key={index}
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-hairline text-[color:#687076] transition-colors hover:bg-surface-sunken"
                            title={['查看结果', '重新执行', '详情', '删除'][index]}
                          >
                            <Icon className="h-4 w-4" />
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ) : (
          <section className="mt-8 space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <Metric label="结果总数" value={results.length} tone={ACCENT} />
              <Metric label="平均 PPD" value={fmt(ppd.avg)} suffix="%" tone={WARN} />
              <Metric label="最高 PPD" value={fmt(ppd.max)} suffix="%" tone={DANGER} />
              <Metric label="最低 PPD" value={fmt(ppd.min)} suffix="%" tone={OK} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className={`${card} overflow-hidden`}>
                <div className="flex items-center justify-between px-6 py-5">
                  <h2 className="text-[17px] font-semibold" style={{ color: INK }}>结果列表</h2>
                  <span className="text-[13px]" style={{ color: MUTED }}>最近 {Math.min(results.length, 8)} 条</span>
                </div>
                <div className="divide-y" style={{ borderColor: '#f2f2f6' }}>
                  {!loading && results.length === 0 && (
                    <div className="px-6 py-12 text-center text-[13px]" style={{ color: MUTED }}>还没有结果，先跑一个预测任务</div>
                  )}
                  {results.slice(0, 8).map((item) => {
                    const value = item.prediction?.ppd_value ?? item.ppd_value ?? null;
                    const thumb = item.original_image_url || item.preview_url || item.result_image_url || null;
                    const tone = value === null ? MUTED : value >= 7 ? DANGER : value >= 4 ? WARN : OK;
                    return (
                      <div key={item.id} className="flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-surface-muted">
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[16px] border border-hairline" style={{ background: '#f4f5f7' }}>
                          {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium" style={{ color: INK }}>
                            {item.original_image_name || item.name || item.original_image_name_display || `结果 #${item.id}`}
                          </p>
                          <p className="mt-0.5 truncate text-[12px]" style={{ color: MUTED }}>{item.model_type || item.model || '模型'}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[15px] font-semibold tabular-nums" style={{ color: tone }}>
                            {value === null ? '—' : `${Number(value).toFixed(2)}%`}
                          </p>
                          <p className="text-[11px]" style={{ color: MUTED }}>PPD</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className={`${card} p-6`}>
                <h2 className="text-[17px] font-semibold" style={{ color: INK }}>健康分布</h2>
                <p className="mt-1 text-[13px]" style={{ color: MUTED }}>按 PPD 阈值分档</p>
                <div className="mt-5 space-y-5">
                  {health.map((bucket) => (
                    <div key={bucket.key}>
                      <div className="flex items-center justify-between text-[13px]">
                        <span className="flex items-center gap-2" style={{ color: INK }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: bucket.color }} />
                          {bucket.key}
                        </span>
                        <span className="tabular-nums" style={{ color: MUTED }}>{bucket.count} · {bucket.percent}%</span>
                      </div>
                      <div className="mt-2"><Bar percent={bucket.percent} tone={bucket.color} /></div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 flex items-center gap-2 rounded-[12px] p-3" style={{ background: '#f7f8fa' }}>
                  <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: OK }} />
                  <p className="text-[12px] leading-5" style={{ color: MUTED }}>阈值可在任务配置里调整，改完重新提交即生效。</p>
                </div>
              </div>
            </div>
          </section>
        )}

        <footer className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]" style={{ color: MUTED }}>
          <span className="inline-flex items-center gap-1.5"><Folder className="h-3.5 w-3.5" /> 数据来自真实任务与结果</span>
          <span className="inline-flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> 仅读展示，按钮不触发写操作</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> {t('common.loading', { defaultValue: '加载中' }) && '样板页 · 不接入导航'}</span>
        </footer>
      </div>
    </div>
  );
};

export default HeroSoftPreview;
