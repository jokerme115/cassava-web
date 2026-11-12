import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, BarChart3, Bot, FolderOpen, History, Loader2, MessageSquare, Play, ShieldCheck, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import AgentPanel, { AgentPanelHandle } from './AgentPanel';
import PageHeader from './PageHeader';
import { API_BASE_URL } from '../services/rest/client';
import { getAuthToken } from '../utils/authToken';
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

const HISTORY_STYLE = `
.agent-history { transform: translateX(-102%); visibility: hidden; transition: transform .3s cubic-bezier(.22,.8,.2,1), visibility 0s linear .3s; }
.agent-history[data-open="true"] { transform: translateX(0); visibility: visible; transition: transform .3s cubic-bezier(.22,.8,.2,1); }
.agent-scrim { opacity: 0; visibility: hidden; transition: opacity .24s ease, visibility 0s linear .24s; }
.agent-scrim[data-open="true"] { opacity: 1; visibility: visible; transition: opacity .24s ease; }
@media (prefers-reduced-motion: reduce) { .agent-history, .agent-scrim { transition: none; } }
`;

/**
 * 智能体独立页：左侧对话主区（执行过程、确认卡、进度都在气泡里），
 * 右侧是使用说明与能力清单，窄屏（<1280）只留对话，说明由空态承担。
 * 历史会话从左上角滑出，覆盖在对话区之上，不挤压正文。
 */
const AgentPage: React.FC<{ currentUser?: User }> = ({ currentUser }) => {
  const displayName = (currentUser?.first_name || currentUser?.username || '').trim();
  const panelRef = useRef<AgentPanelHandle>(null);
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

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
  const canLoadHistory = !currentUser?.is_guest;

  useEffect(() => {
    if (!canLoadHistory) return;
    void loadSessions();
  }, [canLoadHistory, loadSessions]);

  // 打开历史时顺手刷新一次，刚聊完的会话才会出现在最上面
  useEffect(() => {
    if (!canLoadHistory || !railOpen) return;
    void loadSessions();
  }, [canLoadHistory, railOpen, loadSessions]);

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

  const showHistoryEntry = (sessions?.length ?? 0) > 0 || historyError;

  return (
    <div className="flex h-full min-h-0 flex-col px-3 py-3 sm:px-5 lg:px-6">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 gap-5 xl:gap-6">
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
              actions={showHistoryEntry ? (
                <button
                  type="button"
                  onClick={() => setRailOpen((open) => !open)}
                  aria-expanded={railOpen}
                  aria-label="历史会话"
                  className={`inline-flex h-9 items-center gap-1.5 rounded-pill border px-3 text-xs transition-colors ${railOpen ? 'border-accent-line/50 bg-surface-muted text-ink' : 'border-hairline bg-white text-ink-secondary hover:bg-surface-muted'}`}
                >
                  <History className="h-3.5 w-3.5" />
                  历史
                  {sessions && sessions.length > 0 && <span className="tabular-nums text-muted">{sessions.length}</span>}
                </button>
              ) : undefined}
            />
            </div>
          </header>

          {historyError && (
            <div data-testid="agent-history-error" className="flex shrink-0 border-b border-hairline px-4 py-1.5 text-[11px] text-muted">
              <span className="mx-auto flex w-full max-w-[760px] items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-muted-light" />
                <span className="min-w-0 flex-1 truncate">历史记录加载失败</span>
                <button type="button" onClick={() => void loadSessions()} className="shrink-0 text-accent-text underline-offset-2 hover:underline">重试</button>
              </span>
            </div>
          )}

          <div className="relative flex min-h-0 flex-1">
            <AgentPanel ref={panelRef} displayName={displayName} onSessionChange={setActiveSession} />

            <div
              className="agent-scrim absolute inset-0 z-10 bg-[#17201a]/15"
              data-open={railOpen}
              onClick={() => setRailOpen(false)}
              aria-hidden="true"
            />
            <aside
              data-testid="agent-history-rail"
              data-open={railOpen}
              aria-label="历史会话"
              aria-hidden={!railOpen}
              className="agent-history absolute inset-y-0 left-0 z-20 flex w-[280px] max-w-[85%] flex-col border-r border-hairline bg-[#fbfaf6] shadow-[10px_0_28px_-20px_rgba(23,32,26,0.4)]"
            >
              <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2.5">
                <span className="text-xs font-semibold tracking-[0.08em] text-ink-secondary">历史会话</span>
                <button type="button" onClick={() => setRailOpen(false)} aria-label="收起历史会话" className="rounded-md p-1 text-muted transition-colors hover:bg-surface-sunken hover:text-ink">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="ppd-scroll min-h-0 flex-1 overflow-y-auto p-2">
                {sessions === null && !historyError ? (
                  <p className="flex items-center gap-1.5 px-2 py-3 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin text-accent-line" />正在加载…</p>
                ) : !sessions || sessions.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted">{historyError ? '历史记录加载失败' : '暂无历史会话'}</p>
                ) : (
                  <ul className="space-y-1">
                    {sessions.map((item) => {
                      const isActive = item.session === activeSession;
                      return (
                        <li key={item.session}>
                          <button
                            type="button"
                            data-active={isActive}
                            onClick={() => void openSession(item.session)}
                            disabled={!!opening}
                            className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                              isActive
                                ? 'border-accent-line/50 bg-white shadow-card'
                                : 'border-transparent hover:border-hairline hover:bg-white'
                            }`}
                          >
                            <span className="flex items-baseline gap-1.5">
                              <span className={`min-w-0 flex-1 truncate text-sm ${isActive ? 'font-semibold text-ink' : 'text-ink-secondary'}`} title={item.title || '未命名会话'}>
                                {item.title || '未命名会话'}
                              </span>
                              {opening === item.session && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent-line" />}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-muted">{relativeTime(item.updatedAt)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {sessions && sessions.length > 0 && (
                <p className="border-t border-hairline px-3 py-2 text-[11px] leading-relaxed text-muted-light">点一条会话继续聊，输入会接着那段对话。</p>
              )}
            </aside>
          </div>
        </section>

        <aside className="hidden w-[288px] shrink-0 flex-col gap-3 overflow-y-auto pb-1 xl:flex" aria-label="智能体使用说明">
          <section className="rounded-[16px] border border-hairline bg-white p-4 shadow-card">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">怎么用</h2>
            <ol className="mt-3 space-y-3">
              {GUIDE.map((item, index) => (
                <li key={item.title} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-fill/10 text-[11px] font-semibold tabular-nums text-accent-text">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{item.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-[16px] border border-hairline bg-white p-4 shadow-card">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">智能体会做</h2>
            <ul className="mt-2.5 space-y-1.5">
              {ABILITIES.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-xs text-ink-secondary">
                  <item.icon className="h-3.5 w-3.5 shrink-0 text-muted-light" />
                  <span className="truncate">{item.label}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-hairline pt-2.5 text-[11px] leading-relaxed text-muted-light">
              每个动作都会以「执行过程」形式显示在回复顶部，全部结束后收成一行摘要。上百张的批量会自动分批上传，进度条就在确认卡里。
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-light">
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
