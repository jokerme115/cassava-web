import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, BookOpen, Bot, CheckCircle2, ChevronDown, HelpCircle, Clock, FileText, History, MessageSquare, SquarePen, Sparkles, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { API_BASE_URL } from '../services/rest/client';
import { getAuthToken } from '../utils/authToken';
import { User } from '../types';
import { RichText, ThinkingDots, useTypewriter } from './ppdChat';

type EvidenceCard = {
  fileName: string;
  ppd?: number | null;
  reviewed: boolean;
  reviewStatusText: string;
  model?: string;
  taskName?: string;
  taskTime?: string;
  cassavaPixels?: number | null;
  rottenPixels?: number | null;
  width?: number;
  height?: number;
};

type KbItem = { id: number | string; section?: string; question?: string; source?: string };
type AssistantStats = { total: number; recordHits: number; kbHits: number; noBasis: number };

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: string;
  cards?: EvidenceCard[];
  kb?: KbItem[];
  basisReady?: boolean;
  scopeNote?: string;
  notFound?: string[];
  followup?: string;
  followupFile?: string | null;
  followupDone?: boolean;
  streaming?: boolean;
  error?: boolean;
};

type Session = { id: string; title: string; createdAt: number; updatedAt: number; messages: ChatMessage[] };
type Store = { activeId: string; sessions: Session[] };

export type AssistantLatestRecord = { fileName: string; ppd: number | null };

const FALLBACK_ERROR = '助手服务暂时不可用，请查看结果中心记录列表。';
const SEARCHING_TEXT = '正在检索结果中心记录…';
const INTERRUPTED_TEXT = '上次回答被中断，可以重新提问。';
const HISTORY_ROUNDS = 8;
const MAX_SESSIONS = 30;
const MAX_MESSAGES = 120;
const STORE_KEY = (userId: number | string) => `ppd-assistant:v2:${userId}`;

const ASSISTANT_STYLES = `
.ppd-drawer-top { top: 9rem; }
@media (max-width: 767px) { .ppd-drawer-top { top: 0; } }
.ppd-mask { opacity: 0; visibility: hidden; transition: opacity .28s ease, visibility 0s linear .28s; }
.ppd-mask[data-open="true"] { opacity: 1; visibility: visible; transition: opacity .28s ease; }
.ppd-drawer { transform: translateX(104%); visibility: hidden; transition: transform .34s cubic-bezier(.22,.8,.2,1), visibility 0s linear .34s; }
.ppd-drawer[data-open="true"] { transform: translateX(0); visibility: visible; transition: transform .34s cubic-bezier(.22,.8,.2,1); }
.ppd-history-view { transform: translateX(8%); opacity: 0; visibility: hidden; transition: transform .22s ease, opacity .2s ease, visibility 0s linear .22s; }
.ppd-history-view[data-open="true"] { transform: translateX(0); opacity: 1; visibility: visible; transition: transform .22s ease, opacity .2s ease; }
@keyframes ppd-msg-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes ppd-dot { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
@keyframes ppd-caret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.ppd-msg { animation: ppd-msg-in .26s cubic-bezier(.2,.8,.2,1) both; }
.ppd-dot { display: inline-block; width: 5px; height: 5px; margin-left: 3px; border-radius: 999px; background: currentColor; animation: ppd-dot 1.1s infinite ease-in-out; }
.ppd-dot:nth-child(2) { animation-delay: .15s; }
.ppd-dot:nth-child(3) { animation-delay: .3s; }
.ppd-caret { display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: text-bottom; background: #3d8060; animation: ppd-caret 1s steps(1) infinite; }
.ppd-scroll { scrollbar-width: thin; scrollbar-color: #d5ddcf transparent; }
.ppd-scroll-fade { scroll-padding-top: 16px; -webkit-mask-image: linear-gradient(to bottom, transparent 0, rgba(0,0,0,.4) 20px, #000 64px); mask-image: linear-gradient(to bottom, transparent 0, rgba(0,0,0,.4) 20px, #000 64px); }
@media (prefers-reduced-motion: reduce) {
  .ppd-mask, .ppd-drawer, .ppd-history-view { transition: none; }
  .ppd-msg, .ppd-dot, .ppd-caret { animation: none; }
}
`;

/* ----------------------------- 工具函数 ----------------------------- */

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const formatCount = (value?: number | null) => (typeof value === 'number' ? value.toLocaleString('en-US') : null);
const emptySession = (): Session => ({ id: uid(), title: '', createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
const makeTitle = (text: string) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 22 ? `${t.slice(0, 22)}…` : t;
};

const formatWhen = (ts: number) => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  const y = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const sanitizeSession = (raw: any): Session | null => {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.messages)) return null;
  const messages: ChatMessage[] = raw.messages
    .filter((m: any) => m && typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .map((m: any): ChatMessage => {
      const next: ChatMessage = { ...m, content: typeof m.content === 'string' ? m.content : '' };
      if (next.streaming) {
        next.streaming = false;
        next.status = undefined;
        if (!next.content.trim()) { next.content = INTERRUPTED_TEXT; next.error = true; }
      }
      return next;
    });
  if (messages.length === 0) return null;
  return { id: raw.id, title: String(raw.title || ''), createdAt: Number(raw.createdAt) || Date.now(), updatedAt: Number(raw.updatedAt) || Date.now(), messages };
};

const loadStore = (key: string): Store => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    const sessions: Session[] = Array.isArray(parsed?.sessions) ? parsed.sessions.map(sanitizeSession).filter(Boolean) : [];
    if (sessions.length && sessions.some((s) => s.id === parsed.activeId)) return { activeId: parsed.activeId, sessions };
    const fresh = emptySession();
    return { activeId: fresh.id, sessions: [fresh, ...sessions] };
  } catch {
    const fresh = emptySession();
    return { activeId: fresh.id, sessions: [fresh] };
  }
};

const saveStore = (key: string, store: Store) => {
  try {
    const sessions = store.sessions
      .filter((s) => s.messages.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS)
      .map((s) => ({ ...s, messages: s.messages.slice(-MAX_MESSAGES) }));
    localStorage.setItem(key, JSON.stringify({ activeId: store.activeId, sessions }));
  } catch { /* 存储满或被禁用：忽略，不影响对话 */ }
};

const mapSession = (store: Store, sid: string, update: (s: Session) => Session): Store => ({
  ...store,
  sessions: store.sessions.map((s) => (s.id === sid ? update(s) : s)),
});

/* ----------------------------- 依据卡片 ----------------------------- */

const EvidenceCards: React.FC<{ cards: EvidenceCard[]; scopeNote?: string; notFound?: string[] }> = ({ cards, scopeNote, notFound }) => {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? cards : cards.slice(0, 3);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <span className="h-px w-3 bg-accent-line/60" />
        依据 · 结果中心 {cards.length} 条记录
      </div>
      {visible.map((card, index) => {
        const rotten = formatCount(card.rottenPixels);
        const cassava = formatCount(card.cassavaPixels);
        return (
          <div key={`${card.fileName}-${index}`} className="relative overflow-hidden rounded-lg border border-hairline bg-white py-2.5 pl-4 pr-3 shadow-card">
            <span className={`absolute inset-y-0 left-0 w-1 ${card.reviewed ? 'bg-accent-line' : 'bg-warning-text/60'}`} />
            <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
              <span className="max-w-full min-w-0 truncate text-sm font-semibold text-ink" title={card.fileName}>{card.fileName}</span>
              <span className="shrink-0 rounded-pill bg-surface-sunken px-2 py-0.5 text-xs text-muted">口径：有效切面劣变像素面积加权</span>
            </div>
            <div className="mt-1.5 flex items-end justify-between gap-2">
              <span className="text-3xl font-semibold leading-none tabular-nums text-ink">
                {typeof card.ppd === 'number' ? `${card.ppd.toFixed(2)}%` : '—'}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-medium ${card.reviewed ? 'bg-success-50 text-success-text' : 'bg-warning-100 text-warning-text'}`}>
                {card.reviewed ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                {card.reviewStatusText || (card.reviewed ? '已复核' : '待复核')}
              </span>
            </div>
            <div className="mt-2 space-y-0.5 text-xs text-muted">
              {card.model && <div>模型：{card.model}</div>}
              {(card.taskTime || card.taskName) && <div className="truncate" title={card.taskName}>任务时间：{card.taskTime || card.taskName}</div>}
              {rotten && cassava
                ? <div>劣变像素 {rotten} · 切面像素 {cassava}</div>
                : <div className="text-[11px] text-muted-light">像素统计：暂无人工修订</div>}
            </div>
          </div>
        );
      })}
      {cards.length > 3 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1 text-xs text-accent-text hover:underline">
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? '收起' : `展开其余 ${cards.length - 3} 条`}
        </button>
      )}
      {scopeNote && <p className="text-xs text-muted">{scopeNote}</p>}
      {notFound && notFound.length > 0 && <p className="text-xs text-warning-text">以下文件未命中结果中心记录：{notFound.join('、')}</p>}
    </div>
  );
};

/* ----------------------------- 依据徽章（三态） ----------------------------- */

const BasisBadge: React.FC<{ kb?: KbItem[]; hasCards: boolean }> = ({ kb, hasCards }) => {
  const items = (kb || []).slice(0, 3);
  if (items.length > 0) {
    const detail = items.map((it) => [`§${it.id}`, it.section, it.question].filter(Boolean).join(' ')).join('\n');
    const source = items.find((it) => it.source)?.source;
    return (
      <span data-testid="basis-badge" data-basis="kb" title={source ? `${detail}\n来源：${source}` : detail} className="inline-flex max-w-full items-center gap-1 rounded-pill border border-hairline-strong px-2 py-0.5 text-[11px] text-muted">
        <BookOpen className="h-3 w-3 shrink-0" />
        <span className="truncate">依据：领域知识库 {items.map((it) => `§${it.id}`).join('、')}</span>
      </span>
    );
  }
  if (hasCards) {
    return (
      <span data-testid="basis-badge" data-basis="record" className="inline-flex items-center gap-1 rounded-pill border border-hairline-strong px-2 py-0.5 text-[11px] text-muted">
        <FileText className="h-3 w-3 shrink-0" />依据：任务记录（见卡片）
      </span>
    );
  }
  return (
    <span data-testid="basis-badge" data-basis="none" className="inline-flex items-center gap-1 rounded-pill border border-warning-text/50 bg-warning-100/50 px-2 py-0.5 text-[11px] font-medium text-warning-text">
      <HelpCircle className="h-3 w-3 shrink-0" />依据：无（未命中记录与知识库）
    </span>
  );
};

/* ----------------------------- 单条消息 ----------------------------- */

const AssistantBubble: React.FC<{
  message: ChatMessage;
  busy: boolean;
  onFollowup: (message: ChatMessage) => void;
  onDismiss: (message: ChatMessage) => void;
}> = ({ message: m, busy, onFollowup, onDismiss }) => {
  const { shown, typing } = useTypewriter(m.content, !!m.streaming);
  const hasCards = !!m.cards && m.cards.length > 0;
  const hasNotes = !hasCards && (!!m.scopeNote || (!!m.notFound && m.notFound.length > 0));
  const waiting = !!m.streaming && !m.content;
  return (
    <div className="ppd-msg flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-fill/10 text-brand-fill"><Bot className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1 space-y-2.5">
        {hasCards && <EvidenceCards cards={m.cards!} scopeNote={m.scopeNote} notFound={m.notFound} />}
        {hasNotes && (
          <div className="space-y-0.5 text-xs text-muted">
            {m.scopeNote && <p>{m.scopeNote}</p>}
            {m.notFound && m.notFound.length > 0 && <p className="text-warning-text">以下文件未命中结果中心记录：{m.notFound.join('、')}</p>}
          </div>
        )}
        {waiting ? <ThinkingDots text={m.status || SEARCHING_TEXT} /> : (
          <RichText text={shown} caret={!!m.streaming || typing} tone={m.error ? 'text-danger-text' : 'text-ink'} />
        )}
        {m.basisReady && !m.error && !m.streaming && !typing && (
          <div className="ppd-msg"><BasisBadge kb={m.kb} hasCards={hasCards} /></div>
        )}
        {m.followup && !m.followupDone && !m.streaming && !typing && (
          <div className="ppd-msg flex flex-wrap items-center gap-1.5 pt-0.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => onFollowup(m)}
              className="inline-flex items-center gap-1.5 rounded-pill border border-accent-line/40 bg-white px-3 py-1 text-xs text-accent-text transition-colors hover:border-accent-line hover:bg-surface-muted disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3" />
              看看这张的复检状态
            </button>
            <button type="button" onClick={() => onDismiss(m)} aria-label="不用了" title="不用了" className="rounded-full p-1 text-muted-light transition-colors hover:bg-surface-sunken hover:text-muted">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ----------------------------- 抽屉主体 ----------------------------- */

const AssistantShell: React.FC<{ currentUser: User; latestRecord?: AssistantLatestRecord | null }> = ({ currentUser, latestRecord }) => {
  const storeKey = STORE_KEY(currentUser.id);
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [store, setStore] = useState<Store>(() => loadStore(storeKey));
  const [input, setInput] = useState('');
  const storeRef = useRef(store);
  const controllersRef = useRef(new Map<string, AbortController>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  storeRef.current = store;
  const active = store.sessions.find((s) => s.id === store.activeId) ?? store.sessions[0];
  const messages = active.messages;
  const busy = messages.some((m) => m.streaming);
  const history = useMemo(
    () => store.sessions.filter((s) => s.messages.length > 0).sort((a, b) => b.updatedAt - a.updatedAt),
    [store.sessions],
  );

  // 持久化：轻微防抖 + 页面关闭前落盘
  useEffect(() => {
    const timer = window.setTimeout(() => saveStore(storeKey, store), 250);
    return () => window.clearTimeout(timer);
  }, [store, storeKey]);
  useEffect(() => {
    const flush = () => saveStore(storeKey, storeRef.current);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [storeKey]);
  useEffect(() => () => controllersRef.current.forEach((c) => c.abort()), []);

  // 打开时聚焦；Esc 收起（历史视图打开时先退回对话）
  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 200);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (historyOpen) setHistoryOpen(false); else setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', onKey); };
  }, [open, historyOpen]);

  // 内容变高（含打字过程）时，若用户停留在底部则跟随滚动
  useLayoutEffect(() => {
    const content = contentRef.current;
    const scroller = scrollRef.current;
    if (!content || !scroller || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => { if (stickRef.current) scroller.scrollTop = scroller.scrollHeight; });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    stickRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [store.activeId, open]);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [input, open]);

  const patch = useCallback((sid: string, mid: string, update: (m: ChatMessage) => ChatMessage) => {
    setStore((s) => mapSession(s, sid, (sess) => ({ ...sess, messages: sess.messages.map((m) => (m.id === mid ? update(m) : m)) })));
  }, []);

  const send = useCallback(async (raw: string, opts: { lastFileName?: string | null; display?: string } = {}) => {
    const text = raw.trim();
    if (!text) return;
    const sid = storeRef.current.activeId;
    const session = storeRef.current.sessions.find((s) => s.id === sid);
    if (!session || session.messages.some((m) => m.streaming)) return;

    // 多轮指代：没有显式指定时，沿用本会话最近一次回答里出现的文件，保证“这张/这批”不丢上下文
    const lastCardFile = [...session.messages].reverse().find((m) => m.role === 'assistant' && m.cards && m.cards.length > 0)?.cards?.[0]?.fileName ?? null;
    const lastFileName = opts.lastFileName ?? lastCardFile;

    const historyPayload = session.messages
      .filter((m) => !m.streaming && !m.error && m.content.trim())
      .slice(-HISTORY_ROUNDS * 2)
      .map((m) => ({ role: m.role, content: m.content }));

    const userMsg: ChatMessage = { id: uid(), role: 'user', content: opts.display ?? text };
    const assistantId = uid();
    stickRef.current = true;
    setStore((s) => mapSession(s, sid, (sess) => ({
      ...sess,
      title: sess.title || makeTitle(userMsg.content),
      updatedAt: Date.now(),
      messages: [
        ...sess.messages.map((m) => (m.followup && !m.followupDone ? { ...m, followupDone: true } : m)),
        userMsg,
        { id: assistantId, role: 'assistant', content: '', status: SEARCHING_TEXT, streaming: true },
      ],
    })));
    setInput('');

    const controller = new AbortController();
    controllersRef.current.set(sid, controller);
    let finished = false;
    const upd = (update: (m: ChatMessage) => ChatMessage) => patch(sid, assistantId, update);

    const fail = (message: string) => {
      finished = true;
      upd((m) => ({ ...m, content: m.content ? `${m.content}\n${message}` : message, streaming: false, error: true, status: undefined }));
    };

    const handleEvent = (event: any) => {
      switch (event?.type) {
        case 'status':
          upd((m) => ({ ...m, status: event.text || SEARCHING_TEXT }));
          break;
        case 'evidence':
          upd((m) => ({
            ...m,
            cards: Array.isArray(event.cards) ? event.cards : [],
            scopeNote: event.scopeNote || undefined,
            notFound: Array.isArray(event.notFound) ? event.notFound : [],
          }));
          break;
        case 'kb':
          upd((m) => ({ ...m, kb: Array.isArray(event.items) ? event.items.filter((it: any) => it && it.id !== undefined && it.id !== null) : [] }));
          break;
        case 'delta':
          upd((m) => ({ ...m, content: m.content + (event.text || '') }));
          break;
        case 'followup':
          upd((m) => ({ ...m, followup: event.text || '', followupFile: m.cards?.[0]?.fileName ?? null }));
          break;
        case 'done':
          finished = true;
          upd((m) => ({ ...m, streaming: false, status: undefined, basisReady: true }));
          break;
        case 'error':
          fail(event.text || FALLBACK_ERROR);
          break;
        default:
          break;
      }
    };

    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/assistant/chat/`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify({ message: text, history: historyPayload, lastFileName }),
      });
      if (!response.ok || !response.body) {
        fail(FALLBACK_ERROR);
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const flush = (chunk: string) => {
          const data = chunk
            .split('\n')
            .map((line) => line.replace(/\r$/, ''))
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).replace(/^ /, ''))
            .join('\n');
          if (!data) return;
          try { handleEvent(JSON.parse(data)); } catch { /* 忽略无法解析的片段 */ }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.search(/\r?\n\r?\n/);
          while (boundary >= 0) {
            const sep = buffer.slice(boundary).match(/^\r?\n\r?\n/)![0].length;
            flush(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + sep);
            boundary = buffer.search(/\r?\n\r?\n/);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) flush(buffer);
        if (!finished) fail(FALLBACK_ERROR);
      }
    } catch (error) {
      if ((error as any)?.name !== 'AbortError') fail(FALLBACK_ERROR);
    } finally {
      if (controllersRef.current.get(sid) === controller) controllersRef.current.delete(sid);
      upd((m) => (m.streaming ? { ...m, streaming: false, status: undefined } : m));
      setStore((s) => mapSession(s, sid, (sess) => ({ ...sess, updatedAt: Date.now() })));
    }
  }, [patch]);

  const startNew = () => {
    setHistoryOpen(false);
    setConfirmDeleteId(null);
    if (active.messages.length === 0) { inputRef.current?.focus(); return; }
    const fresh = emptySession();
    setStore((s) => ({ activeId: fresh.id, sessions: [fresh, ...s.sessions.filter((x) => x.messages.length > 0)] }));
    window.setTimeout(() => inputRef.current?.focus(), 50);
  };

  const switchTo = (sid: string) => {
    setStore((s) => ({ activeId: sid, sessions: s.sessions.filter((x) => x.messages.length > 0 || x.id === sid) }));
    setHistoryOpen(false);
    setConfirmDeleteId(null);
  };

  const removeSession = (sid: string) => {
    controllersRef.current.get(sid)?.abort();
    controllersRef.current.delete(sid);
    setConfirmDeleteId(null);
    setStore((s) => {
      const rest = s.sessions.filter((x) => x.id !== sid);
      if (s.activeId !== sid) return { ...s, sessions: rest };
      const next = rest.filter((x) => x.messages.length > 0).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? emptySession();
      return { activeId: next.id, sessions: rest.some((x) => x.id === next.id) ? rest : [next, ...rest] };
    });
  };

  const onFollowup = (message: ChatMessage) => {
    patch(store.activeId, message.id, (m) => ({ ...m, followupDone: true }));
    void send('是', { lastFileName: message.followupFile ?? null, display: '看看这张的复检状态' });
  };
  const onDismiss = (message: ChatMessage) => patch(store.activeId, message.id, (m) => ({ ...m, followupDone: true }));

  const prompts = useMemo(() => {
    const list: string[] = [];
    if (latestRecord?.fileName) list.push(`「${latestRecord.fileName}」的 PPD 是多少？`);
    list.push(
      'PPD 是怎么计算的？',
      '切面发黑但边缘整齐，是 PPD 还是机械伤？',
      '4% 和 7% 这两个分级阈值是凭什么定的？',
      '哪些结果还没复核？',
    );
    return list;
  }, [latestRecord?.fileName]);

  // 问答留痕统计：每次打开抽屉拉一次，失败（401/网络）静默不显示
  const [stats, setStats] = useState<AssistantStats | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const token = getAuthToken();
    if (!token) { setStats(null); return undefined; }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/assistant/stats/`, {
          signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: `Token ${token}` },
        });
        if (!res.ok) { setStats(null); return; }
        const d = await res.json();
        const n = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        if (n(d?.total) === null) { setStats(null); return; }
        setStats({ total: d.total, recordHits: n(d.recordHits) ?? 0, kbHits: n(d.kbHits) ?? 0, noBasis: n(d.noBasis) ?? 0 });
      } catch { /* 静默 */ }
    })();
    return () => controller.abort();
  }, [open, historyOpen]);

  const submit = () => { if (!busy) void send(input); };
  const displayName = (currentUser.first_name || currentUser.username || '').trim();

  return (
    <>
      <style>{ASSISTANT_STYLES}</style>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="打开 PPD 助手"
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-pill bg-brand-fill px-4 py-2.5 text-sm font-medium text-white shadow-float transition-all hover:-translate-y-0.5 hover:bg-brand-fill-hover"
        >
          <Sparkles className="h-4 w-4" />
          助手
        </button>
      )}

      {/* 遮罩与抽屉都从工具栏下沿开始，导出等工具栏按钮不会被盖住 */}
      <div
        className="ppd-mask ppd-drawer-top fixed inset-x-0 bottom-0 z-30 bg-[#17201a]/25"
        data-open={open}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside
        className="ppd-drawer ppd-drawer-top fixed bottom-0 right-0 z-40 flex w-[min(440px,100vw)] flex-col overflow-hidden border-l border-hairline bg-[#fbfaf6] shadow-[-12px_0_32px_-12px_rgba(23,32,26,0.28)]"
        data-open={open}
        role="dialog"
        aria-label="PPD 助手"
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between gap-2 border-b border-hairline bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-fill text-white"><Bot className="h-4 w-4" /></span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold leading-tight text-ink" title={active.title || undefined}>{active.title || 'PPD 助手'}</h2>
              <p className="mt-0.5 truncate text-xs text-muted">{active.title ? 'PPD 助手 · 基于结果中心记录' : '基于结果中心记录 · 回答附数据口径'}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" onClick={() => { setHistoryOpen((v) => !v); setConfirmDeleteId(null); }} aria-label="历史对话" aria-pressed={historyOpen} className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-surface-sunken ${historyOpen ? 'bg-surface-sunken text-ink' : 'text-ink-secondary'}`}>
              <History className="h-4 w-4" />历史{history.length > 0 && <span className="tabular-nums text-muted">{history.length}</span>}
            </button>
            <button type="button" onClick={startNew} aria-label="新对话" className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-surface-sunken">
              <SquarePen className="h-4 w-4" />新对话
            </button>
            <button type="button" onClick={() => setOpen(false)} aria-label="关闭助手" className="ml-0.5 rounded-md p-1.5 text-muted transition-colors hover:bg-surface-sunken hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        {/* 智能体已从抽屉迁出成独立页：这里只留一句入口，不再占一个 tab */}
        <div data-testid="agent-entry" className="flex items-center gap-1.5 border-b border-hairline bg-white px-4 py-1.5 text-[11px] leading-snug text-muted">
          <span className="min-w-0 flex-1 truncate">智能体已升级为独立页面</span>
          <Link to="/agent" onClick={() => setOpen(false)} className="inline-flex shrink-0 items-center gap-0.5 font-medium text-accent-text underline-offset-2 hover:underline">
            去试试 →
          </Link>
        </div>

        <div className="flex min-h-0 flex-1 flex-col" data-testid="qa-panel">
        <div data-testid="capability-strip" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-hairline bg-surface-muted/60 px-4 py-1.5 text-[11px] leading-snug text-muted">
          <span><b className="font-medium text-accent-text">我会：</b>查记录 · 解释口径 · 判读建议</span>
          <span aria-hidden="true" className="text-hairline-strong">｜</span>
          <span><b className="font-medium text-warning-text">我不会：</b>预测产量 · 诊断病害种类</span>
        </div>
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={(e) => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}
            className="ppd-scroll ppd-scroll-fade absolute inset-0 overflow-y-auto px-4 py-4"
          >
            <div ref={contentRef} className="space-y-5">
              {messages.length === 0 && (
                <div className="pt-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-fill/10 text-brand-fill"><Sparkles className="h-5 w-5" /></span>
                  <h3 className="mt-3 text-lg font-semibold text-ink">{displayName ? `${displayName}，想查点什么？` : '想查点什么？'}</h3>
                  <p className="mt-1 text-sm text-muted">可以问某张图的 PPD、计算口径、判读依据，或哪些结果还没复核。数字来自结果中心当前记录，口径与判读来自领域知识库。</p>
                  <div className="mt-5 space-y-2">
                    {prompts.map((prompt) => (
                      <button key={prompt} type="button" disabled={busy} onClick={() => void send(prompt)} className="group flex w-full items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-3.5 py-2.5 text-left text-sm text-ink-secondary shadow-card transition-all hover:-translate-y-px hover:border-accent-line/60 hover:text-ink disabled:opacity-50">
                        <span className="min-w-0 truncate">{prompt}</span>
                        <ArrowUp className="h-3.5 w-3.5 shrink-0 rotate-45 text-muted-light transition-colors group-hover:text-accent-line" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m) => m.role === 'user' ? (
                <div key={m.id} className="ppd-msg flex justify-end">
                  <div className="max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-fill px-3.5 py-2 text-sm leading-relaxed text-white">{m.content}</div>
                </div>
              ) : (
                <AssistantBubble key={m.id} message={m} busy={busy} onFollowup={onFollowup} onDismiss={onDismiss} />
              ))}
            </div>
          </div>

          {/* 历史对话：覆盖在对话区之上 */}
          <div className="ppd-history-view absolute inset-0 z-10 flex flex-col bg-[#fbfaf6]" data-open={historyOpen} aria-hidden={!historyOpen}>
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
              <button type="button" onClick={() => setHistoryOpen(false)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-secondary hover:bg-surface-sunken"><ArrowLeft className="h-3.5 w-3.5" />返回对话</button>
              <span className="text-xs text-muted">共 {history.length} 个会话</span>
            </div>
            {stats && (
              <div data-testid="assistant-stats" className="flex flex-wrap items-center gap-x-1.5 border-b border-hairline bg-white/70 px-4 py-1.5 text-[11px] tabular-nums text-muted">
                <span className="font-medium text-ink-secondary">问答 {stats.total} 次</span>
                <span aria-hidden="true">·</span><span>命中记录 {stats.recordHits}</span>
                <span aria-hidden="true">·</span><span>领域知识 {stats.kbHits}</span>
                <span aria-hidden="true">·</span><span className={stats.noBasis > 0 ? 'text-warning-text' : ''}>无依据 {stats.noBasis}</span>
              </div>
            )}
            <div className="ppd-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {history.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted">
                  <MessageSquare className="h-6 w-6 text-muted-light" />
                  还没有历史对话
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {history.map((s) => {
                    const isActive = s.id === store.activeId;
                    const confirming = confirmDeleteId === s.id;
                    const last = s.messages[s.messages.length - 1];
                    const preview = (last?.content || '').replace(/\s+/g, ' ').slice(0, 120);
                    return (
                      <li key={s.id} className={`group relative flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${isActive ? 'border-accent-line/50 bg-white shadow-card' : 'border-transparent hover:border-hairline hover:bg-white'}`}>
                        <button type="button" onClick={() => switchTo(s.id)} className="block min-w-0 flex-1 overflow-hidden text-left">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-medium text-ink">{s.title || '新对话'}</span>
                            <span className="shrink-0 text-[11px] text-muted">{formatWhen(s.updatedAt)}</span>
                          </div>
                          <p className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted">{preview || `${s.messages.length} 条消息`}</p>
                        </button>
                        {confirming ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <button type="button" onClick={() => removeSession(s.id)} className="rounded-pill bg-danger-text px-2 py-0.5 text-xs text-white">删除</button>
                            <button type="button" onClick={() => setConfirmDeleteId(null)} className="rounded-pill px-2 py-0.5 text-xs text-muted hover:bg-surface-sunken">取消</button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setConfirmDeleteId(s.id)} aria-label={`删除对话：${s.title || '新对话'}`} className="shrink-0 rounded-md p-1.5 text-muted-light opacity-60 transition-all hover:bg-surface-sunken hover:text-danger-text group-hover:opacity-100">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="border-t border-hairline px-3 py-3">
              <button type="button" onClick={startNew} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-fill py-2 text-sm font-medium text-white transition-colors hover:bg-brand-fill-hover"><SquarePen className="h-4 w-4" />新建对话</button>
            </div>
          </div>
        </div>

        <div className="border-t border-hairline bg-white px-4 pb-3.5 pt-2.5">
          {messages.length > 0 && (
            <div className="ppd-scroll -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1" data-testid="prompt-chips">
              {prompts.map((prompt) => (
                <button key={prompt} type="button" title={prompt} disabled={busy} onClick={() => void send(prompt)} className="max-w-[80%] shrink-0 truncate rounded-pill border border-hairline-strong bg-surface-muted px-2.5 py-1 text-xs text-ink-secondary transition-colors hover:border-accent-line hover:text-accent-text disabled:opacity-50">
                  {prompt}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex items-end gap-2 rounded-2xl border border-hairline-strong bg-white py-1.5 pl-3.5 pr-1.5 transition-colors focus-within:border-accent-line"
            onSubmit={(event) => { event.preventDefault(); submit(); }}
          >
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
              }}
              placeholder="问点什么，比如某张图的 PPD…"
              maxLength={500}
              aria-label="输入问题"
              className="max-h-28 min-h-[1.75rem] min-w-0 flex-1 resize-none self-center bg-transparent py-1 text-sm leading-relaxed text-ink outline-none placeholder:text-muted-light"
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="发送" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-fill text-white transition-colors hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:opacity-35">
              <ArrowUp className="h-4 w-4" />
            </button>
          </form>
          <p className="mt-1.5 px-1 text-[11px] text-muted-light">Enter 发送 · Shift+Enter 换行 · 复核结论以人工复核为准</p>
        </div>
        </div>
      </aside>
    </>
  );
};

const PpdAssistant: React.FC<{ currentUser?: User; latestRecord?: AssistantLatestRecord | null }> = ({ currentUser, latestRecord }) => {
  // 未登录（无用户或访客）不渲染
  if (!currentUser || currentUser.is_guest) return null;
  return <AssistantShell key={currentUser.id} currentUser={currentUser} latestRecord={latestRecord} />;
};

export default PpdAssistant;
