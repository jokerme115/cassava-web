import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, BarChart3, Bot, FolderOpen, History, Loader2, MessageSquare, Play, ShieldCheck, SquarePen, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import AgentPanel, { AgentPanelHandle } from './AgentPanel';
import PageHeader from './PageHeader';
import { API_BASE_URL } from '../services/rest/client';
import { getAuthToken } from '../utils/authToken';
import { getApiErrorMessage } from '../utils/apiError';
import { quotaBadgeText, type AgentQuota } from '../utils/agentQuota';
import { useAgentQuota } from '../hooks/useAgentQuota';
import { User } from '../types';

const GUIDE = [
  { icon: FolderOpen, title: '选择图片文件夹', desc: '只读取文件夹第一层的 jpg / png' },
  { icon: MessageSquare, title: '说清要做什么', desc: '例如「上传这批图片并创建 PPD 预测任务」' },
  { icon: ShieldCheck, title: '核对后执行', desc: '上传和创建任务前，一定先请你确认' },
];

const ABILITIES = [
  { icon: FolderOpen, label: '规划上传清单' },
  { icon: Play, label: '创建预测任务' },
  { icon: Activity, label: '查询任务进度' },
  { icon: BarChart3, label: '汇总统计结果' },
];

type SessionItem = { session: string; title: string; updatedAt: string };

const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/$/, '')}${path}`;
const authHeaders = (extra: Record<string, string> = {}): Record<string, string> => {
  const token = getAuthToken();
  return { ...extra, ...(token ? { Authorization: `Token ${token}` } : {}) };
};

/** 历史列表里的相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / 7月3日 */
const relativeTime = (value: string) => {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const when = new Date(ts);
  const now = new Date();
  if (when.toDateString() === new Date(now.getTime() - 86_400_000).toDateString()) return '昨天';
  if (when.getFullYear() === now.getFullYear()) return `${when.getMonth() + 1}月${when.getDate()}日`;
  return `${when.getFullYear()}年${when.getMonth() + 1}月${when.getDate()}日`;
};

/**
 * 页头额度徽标：一颗胶囊说清「今天还能用几次」。
 * 取不到额度时整块不渲染，页头不留空位、不报错。
 */
const QuotaBadge: React.FC<{ quota: AgentQuota }> = ({ quota }) => {
  const text = quotaBadgeText(quota);
  const exhausted = !quota.allowed && quota.reason === 'quota_exhausted';
  const denied = !quota.allowed && !exhausted;
  const shell = denied
    ? 'border-hairline bg-white text-muted'
    : exhausted
      ? 'border-warning/30 bg-warning-100/45 text-warning-text'
      : 'border-accent-line/30 bg-[#f1f5ef] text-ink-secondary';
  const dot = denied ? 'bg-muted-light' : exhausted ? 'bg-warning' : 'bg-accent-line';
  const tip = denied
    ? '当前账号没有使用智能体的权限，请联系管理员开通'
    : exhausted
      ? `今日已用 ${quota.used} / ${quota.quota} 次，明日 0 点恢复`
      : quota.unlimited
        ? '这个账号不限制智能体次数'
        : `${quota.today ? `${quota.today} · ` : ''}今日已用 ${quota.used} / ${quota.quota} 次，每日 0 点重置`;

  return (
    <span
      data-testid="agent-quota-badge"
      data-state={quota.unlimited ? 'unlimited' : quota.allowed ? 'allowed' : quota.reason || 'denied'}
      title={tip}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 text-[11px] leading-none ${shell}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span>{text.main}</span>
      {text.value && (
        <span className="flex items-baseline gap-1">
          <span className="text-[12px] font-semibold tabular-nums text-ink">{text.value}</span>
          <span className="text-ink-secondary">{text.suffix}</span>
        </span>
      )}
    </span>
  );
};

const HISTORY_STYLE = `
/* 窄屏：历史栏是从右侧滑出的浮层；≥1024 时变成常驻右栏，不再受 data-open 控制 */
.agent-history { transform: translateX(104%); visibility: hidden; transition: transform .3s cubic-bezier(.22,.8,.2,1), visibility 0s linear .3s; }
.agent-history[data-open="true"] { transform: translateX(0); visibility: visible; transition: transform .3s cubic-bezier(.22,.8,.2,1); }
.agent-scrim { opacity: 0; visibility: hidden; transition: opacity .24s ease, visibility 0s linear .24s; }
.agent-scrim[data-open="true"] { opacity: 1; visibility: visible; transition: opacity .24s ease; }
@media (min-width: 1024px) {
  .agent-history, .agent-history[data-open="true"], .agent-history[data-open="false"] { transform: none; visibility: visible; transition: none; }
  /* 窗口很矮时右栏需要竖向滚动：底部渐隐，提示下面还有内容 */
  .agent-rail-scroll {
    -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 12px), transparent 100%);
    mask-image: linear-gradient(to bottom, #000 calc(100% - 12px), transparent 100%);
  }
}
/* 列表底部做 14px 渐隐：条数超出一屏时，被裁掉的那一行看起来是「还有更多」，而不是断掉 */
.hist-scroll {
  scrollbar-width: thin;
  scrollbar-color: #d5ddcf transparent;
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 20px), transparent 100%);
  mask-image: linear-gradient(to bottom, #000 calc(100% - 20px), transparent 100%);
}
.hist-scroll::-webkit-scrollbar { width: 6px; }
.hist-scroll::-webkit-scrollbar-thumb { background: #dfe4d8; border-radius: 999px; }
.hist-scroll::-webkit-scrollbar-track { background: transparent; }
.agent-rail-card { animation: agentRailIn .44s cubic-bezier(.22,.8,.2,1) both; }
@keyframes agentRailIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .agent-history, .agent-scrim { transition: none; }
  .agent-rail-card { animation: none; }
}
`;

/**
 * 智能体独立页：中间是对话主区（执行过程、确认卡、进度都在气泡里），
 * 右侧一列从上到下是「历史会话」「怎么用」「智能体会做」。
 * 历史会话常驻右栏（零会话时也给空态，不让功能看起来消失）；
 * 窄屏（<1024）右栏收起成右侧滑出浮层，由页头「历史」按钮唤出。
 */
const AgentPage: React.FC<{ currentUser?: User }> = ({ currentUser }) => {
  const displayName = (currentUser?.first_name || currentUser?.username || '').trim();
  const panelRef = useRef<AgentPanelHandle>(null);
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ session: string; text: string } | null>(null);
  const deletingRef = useRef<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/agent/sessions/'), { headers: authHeaders({ Accept: 'application/json' }) });
      if (!res.ok) { setHistoryError(true); return; }
      const raw = await res.json();
      const data = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
      const items: any[] = Array.isArray(data?.items) ? data.items : [];
      setSessions(items
        .filter((item) => item && item.session)
        .map((item) => ({
          session: String(item.session),
          title: String(item.title ?? '').trim(),
          updatedAt: String(item.updatedAt ?? item.updated_at ?? ''),
        })));
      setHistoryError(false);
    } catch {
      setHistoryError(true);
    }
  }, []);

  // 游客没有 agent 会话（上传本身也需要登录），不去打这个接口，免得空报一条「加载失败」
  const isGuest = !!currentUser?.is_guest;
  const canLoadHistory = !isGuest;
  // 额度只在登录态有意义：游客连对话入口都不该有
  const { quota, refresh: refreshQuota } = useAgentQuota(canLoadHistory);
  const handleTurnSettled = useCallback(() => { void refreshQuota(); }, [refreshQuota]);

  useEffect(() => {
    if (!canLoadHistory) return;
    void loadSessions();
  }, [canLoadHistory, loadSessions]);

  useEffect(() => {
    if (!railOpen) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setRailOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [railOpen]);

  const openSession = useCallback(async (session: string) => {
    if (opening) return;
    setOpening(session);
    try {
      const res = await fetch(apiUrl(`/agent/history/?session=${encodeURIComponent(session)}`), {
        headers: authHeaders({ Accept: 'application/json' }),
      });
      if (!res.ok) { setHistoryError(true); return; }
      const raw = await res.json();
      const data = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
      const messages: any[] = Array.isArray(data?.messages) ? data.messages : [];
      const turns = messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
        .map((m) => ({ role: m.role as 'user' | 'assistant', text: String(m.text ?? ''), time: m.time ? String(m.time) : undefined }));
      panelRef.current?.loadHistory(session, turns);
      setActiveSession(session);
      setHistoryError(false);
      setRailOpen(false);
    } catch {
      setHistoryError(true);
    } finally {
      setOpening(null);
    }
  }, [opening]);

  const startNewSession = useCallback(() => {
    if (opening) return;
    panelRef.current?.reset();
    setActiveSession(null);
    setRailOpen(false);
  }, [opening]);

  /* 删除历史会话：轻量二次确认 → 后端删除 → 从列表移除；
     删掉的正好是当前打开的会话，就把对话区清空回新会话空态。 */
  const deleteSession = useCallback(async (session: string) => {
    if (deletingRef.current) return;
    deletingRef.current = session;
    setDeleting(session);
    setDeleteError(null);
    try {
      const res = await fetch(apiUrl('/agent/sessions/delete/'), {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ session }),
      });
      if (!res.ok) {
        let payload: unknown = null;
        try { payload = await res.json(); } catch { payload = null; }
        const text = getApiErrorMessage(
          { response: { status: res.status, data: payload } },
          res.status === 404 ? '这个会话已经不存在了' : '删除失败，请重试',
        );
        setDeleteError({ session, text });
        return;
      }
      setSessions((list) => (list ? list.filter((item) => item.session !== session) : list));
      setConfirmDelete(null);
      if (activeSession === session) {
        panelRef.current?.reset();
        setActiveSession(null);
      }
    } catch {
      setDeleteError({ session, text: '网络出错了，删除失败' });
    } finally {
      deletingRef.current = null;
      setDeleting(null);
    }
  }, [activeSession]);

  const sessionCount = sessions?.length ?? 0;

  const emptyBlock = 'flex h-full min-h-[120px] flex-col items-center justify-center gap-1 px-2 py-6 text-center';

  const historyBody = isGuest ? (
    <div className={emptyBlock}>
      <History className="h-4 w-4 text-muted-light" />
      <p className="text-xs text-muted">登录后可查看历史会话</p>
      <p className="text-[11px] leading-relaxed text-muted-light">登录后每次对话都会自动保存</p>
    </div>
  ) : historyError ? (
    <div data-testid="agent-history-error" className={`${emptyBlock} gap-1.5`}>
      <AlertCircle className="h-4 w-4 text-muted-light" />
      <p className="text-xs text-muted">历史记录加载失败</p>
      <button type="button" onClick={() => void loadSessions()} className="text-[11px] text-accent-text underline-offset-2 hover:underline">重试</button>
    </div>
  ) : sessions === null ? (
    <p className="flex h-full min-h-[120px] items-center justify-center gap-1.5 px-2 py-6 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin text-accent-line" />正在加载…</p>
  ) : sessionCount === 0 ? (
    <div className={emptyBlock}>
      <MessageSquare className="h-4 w-4 text-muted-light" />
      <p className="text-xs text-muted">暂无历史会话</p>
      <p className="text-[11px] leading-relaxed text-muted-light">发起对话后自动保存</p>
    </div>
  ) : (
    <ul className="space-y-1">
      {sessions.map((item) => {
        const isActive = item.session === activeSession;
        const askingDelete = confirmDelete === item.session;
        const rowError = deleteError?.session === item.session ? deleteError.text : '';
        return (
          <li key={item.session} data-testid="agent-session-item" data-session={item.session} className="group relative">
            {askingDelete ? (
              <div data-testid="agent-session-confirm" className="rounded-xl border border-hairline bg-surface-muted/80 px-2.5 py-2">
                <p className="text-[12px] font-medium leading-[17px] text-ink">删除这个会话？</p>
                <p className="mt-0.5 truncate text-[11px] leading-[15px] text-muted" title={item.title || '未命名会话'}>{item.title || '未命名会话'}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void deleteSession(item.session)}
                    disabled={deleting === item.session}
                    className="inline-flex h-6 items-center gap-1 rounded-pill bg-danger-text px-2.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {deleting === item.session ? <><Loader2 className="h-3 w-3 animate-spin" />删除中</> : '删除'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setConfirmDelete(null); setDeleteError(null); }}
                    disabled={deleting === item.session}
                    className="inline-flex h-6 items-center rounded-pill border border-hairline-strong bg-white px-2.5 text-[11px] text-ink-secondary transition-colors hover:bg-surface-sunken disabled:opacity-60"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  data-active={isActive}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => void openSession(item.session)}
                  disabled={!!opening}
                  className={`w-full rounded-xl py-2 pl-2.5 pr-8 text-left transition-colors disabled:opacity-60 ${
                    isActive
                      ? 'bg-[#f1f5ef] shadow-[inset_3px_0_0_0_#3d8060] ring-1 ring-inset ring-accent-line/25'
                      : 'hover:bg-surface-muted'
                  }`}
                >
                  <span className="flex items-baseline gap-1.5">
                    <span className={`min-w-0 flex-1 truncate text-[13px] leading-[18px] ${isActive ? 'font-semibold text-ink' : 'text-ink-secondary'}`} title={item.title || '未命名会话'}>
                      {item.title || '未命名会话'}
                    </span>
                    {opening === item.session && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent-line" />}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-[15px] text-muted-light">{relativeTime(item.updatedAt)}</span>
                </button>
                <button
                  type="button"
                  data-testid="agent-session-delete"
                  onClick={() => { setConfirmDelete(item.session); setDeleteError(null); }}
                  disabled={!!opening || !!deleting}
                  aria-label={`删除会话：${item.title || '未命名会话'}`}
                  title="删除会话"
                  className="absolute right-1 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-muted-light opacity-100 transition-all hover:bg-white hover:text-danger-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-text/25 disabled:opacity-0 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {rowError && <p data-testid="agent-session-delete-error" className="mt-1 px-2.5 text-[11px] leading-[15px] text-danger-text">{rowError}</p>}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex h-full min-h-0 flex-col px-3 py-3 sm:px-5 lg:px-6">
      <div className="relative mx-auto flex min-h-0 w-full max-w-7xl flex-1 gap-5 xl:gap-6">
        <section
          data-testid="agent-workspace"
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-hairline bg-white shadow-card"
        >
          <style>{HISTORY_STYLE}</style>
          <header className="shrink-0 border-b border-hairline px-4 py-3 sm:px-5">
            <div className="mx-auto w-full max-w-[760px]">
              <PageHeader
                leading={<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-fill text-white"><Bot className="h-5 w-5" /></span>}
                title="智能体"
                subtitle="上传图片、创建预测任务、跟踪进度，执行前一律由你确认。"
                actions={isGuest ? undefined : (
                  <>
                    {quota && <QuotaBadge quota={quota} />}
                    <button
                      type="button"
                      onClick={() => setRailOpen(true)}
                      aria-expanded={railOpen}
                      aria-label="历史会话"
                      className="inline-flex h-9 items-center gap-1.5 rounded-pill border border-hairline bg-white px-3 text-xs text-ink-secondary transition-colors hover:bg-surface-muted lg:hidden"
                    >
                      <History className="h-3.5 w-3.5" />
                      历史
                      {sessionCount > 0 && <span className="tabular-nums text-muted">{sessionCount}</span>}
                    </button>
                  </>
                )}
              />
            </div>
          </header>

          <div className="relative flex min-h-0 flex-1">
            <AgentPanel
              ref={panelRef}
              displayName={displayName}
              onSessionChange={setActiveSession}
              quota={quota}
              onTurnSettled={handleTurnSettled}
            />
          </div>
        </section>

        <div
          className="agent-scrim absolute inset-0 z-10 bg-[#17201a]/15 lg:hidden"
          data-open={railOpen}
          onClick={() => setRailOpen(false)}
          aria-hidden="true"
        />

        <aside
          data-testid="agent-history-rail"
          data-open={railOpen}
          aria-label="历史会话"
          className="agent-history agent-rail-scroll absolute inset-y-0 right-0 z-20 flex w-[280px] max-w-[85%] flex-col gap-0 overflow-hidden rounded-[16px] border border-hairline bg-white shadow-float lg:static lg:z-auto lg:w-[272px] lg:max-w-none lg:flex-none lg:shrink-0 lg:gap-3 lg:overflow-y-auto lg:overflow-x-hidden lg:rounded-none lg:border-0 lg:bg-transparent lg:pb-3 lg:shadow-none xl:w-[288px]"
        >
          <section
            data-testid="agent-history-card"
            className="agent-rail-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-hairline bg-white shadow-card lg:min-h-[232px]"
          >
            <div className="flex shrink-0 items-center gap-1.5 border-b border-hairline px-2.5 py-2">
              <History className="h-3.5 w-3.5 shrink-0 text-muted-light" />
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">历史会话</h2>
              {sessionCount > 0 && (
                <span className="rounded-pill bg-surface-sunken px-1.5 text-[10px] font-medium leading-[16px] tabular-nums text-ink-secondary">{sessionCount}</span>
              )}
              <span className="min-w-0 flex-1" />
              <button
                type="button"
                onClick={startNewSession}
                disabled={!!opening}
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-pill px-1.5 text-[11px] text-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-50"
              >
                <SquarePen className="h-3 w-3" />
                新会话
              </button>
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                aria-label="收起历史会话"
                className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-surface-sunken hover:text-ink lg:hidden"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="hist-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-2">{historyBody}</div>
          </section>

          <section className="agent-rail-card hidden shrink-0 rounded-[16px] border border-hairline bg-white px-3 py-2.5 shadow-card lg:block" style={{ animationDelay: '60ms' }}>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">怎么用</h2>
            <ol className="mt-2 space-y-1.5">
              {GUIDE.map((item, index) => (
                <li key={item.title} className="flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-fill/10 text-[11px] font-semibold tabular-nums text-accent-text">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium leading-[18px] text-ink">{item.title}</p>
                    <p className="mt-0.5 text-[11px] leading-[15px] text-muted">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="agent-rail-card hidden shrink-0 rounded-[16px] border border-hairline bg-white px-3 py-2.5 shadow-card lg:block" style={{ animationDelay: '120ms' }}>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">智能体会做</h2>
            <ul className="mt-2 grid grid-cols-2 gap-1.5">
              {ABILITIES.map((item) => (
                <li key={item.label} className="flex items-center gap-1.5 text-[11px] leading-[15px] text-ink-secondary">
                  <item.icon className="h-3.5 w-3.5 shrink-0 text-muted-light" />
                  <span className="truncate">{item.label}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 border-t border-hairline pt-2 text-[11px] leading-[15px] text-muted-light">
              每个动作都以「执行过程」显示在回复顶部，结束后收成一行摘要；上百张会自动分批上传。
            </p>
            <p className="mt-1.5 text-[11px] leading-[15px] text-muted-light">
              创建的任务到
              <Link to="/tasks" className="mx-0.5 font-medium text-accent-text underline-offset-2 hover:underline">任务中心</Link>
              看进度，结果到
              <Link to="/results" className="mx-0.5 font-medium text-accent-text underline-offset-2 hover:underline">结果中心</Link>
              查 PPD。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default AgentPage;
