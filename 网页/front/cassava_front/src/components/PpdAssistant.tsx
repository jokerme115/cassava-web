import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Clock, Send, Sparkles, X } from 'lucide-react';
import { API_BASE_URL } from '../services/rest/client';
import { getAuthToken } from '../utils/authToken';
import { User } from '../types';

type EvidenceCard = {
  fileName: string;
  ppd?: number | null;
  reviewed: boolean;
  reviewStatusText: string;
  model?: string;
  taskName?: string;
  taskTime?: string;
  cassavaPixels?: number;
  rottenPixels?: number;
  width?: number;
  height?: number;
};

type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  status?: string;
  cards?: EvidenceCard[];
  scopeNote?: string;
  notFound?: string[];
  followup?: string;
  followupFile?: string | null;
  followupDone?: boolean;
  streaming?: boolean;
  error?: boolean;
};

const QUICK_PROMPTS = ['S286 (1).jpg 的 PPD 是多少？', '这个 10.42% 是怎么算出来的？', '哪些结果还没复核？'];
const FALLBACK_ERROR = '助手服务暂时不可用，请查看结果中心记录列表。';
const SEARCHING_TEXT = '正在检索结果中心记录…';
const HISTORY_ROUNDS = 8;

const ASSISTANT_STYLES = `
@keyframes ppd-assistant-in { from { opacity: 0; transform: translateY(16px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes ppd-assistant-msg { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes ppd-assistant-dot { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
@keyframes ppd-assistant-caret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.ppd-assistant-panel { animation: ppd-assistant-in .26s cubic-bezier(.2,.8,.2,1) both; }
.ppd-assistant-msg { animation: ppd-assistant-msg .22s ease-out both; }
.ppd-assistant-dot { display: inline-block; width: 4px; height: 4px; margin-left: 3px; border-radius: 999px; background: currentColor; animation: ppd-assistant-dot 1.1s infinite ease-in-out; }
.ppd-assistant-dot:nth-child(2) { animation-delay: .15s; }
.ppd-assistant-dot:nth-child(3) { animation-delay: .3s; }
.ppd-assistant-caret { display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: text-bottom; background: #3d8060; animation: ppd-assistant-caret 1s steps(1) infinite; }
@media (prefers-reduced-motion: reduce) {
  .ppd-assistant-panel, .ppd-assistant-msg, .ppd-assistant-dot, .ppd-assistant-caret { animation: none; }
}
`;

const formatCount = (value?: number) => (typeof value === 'number' ? value.toLocaleString('en-US') : null);

const EvidenceCards: React.FC<{ cards: EvidenceCard[]; scopeNote?: string; notFound?: string[] }> = ({ cards, scopeNote, notFound }) => (
  <div className="space-y-2">
    {cards.map((card, index) => {
      const rotten = formatCount(card.rottenPixels);
      const cassava = formatCount(card.cassavaPixels);
      return (
        <div key={`${card.fileName}-${index}`} className="rounded-md border border-hairline bg-surface-muted px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-ink" title={card.fileName}>{card.fileName}</span>
            <span className="shrink-0 rounded-pill bg-surface-sunken px-2 py-0.5 text-xs text-muted">口径：有效切面劣变像素面积加权</span>
          </div>
          <div className="mt-1.5 flex items-end justify-between gap-2">
            <span className="text-3xl font-semibold leading-none text-ink">
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
            {rotten && cassava && <div>劣变像素 {rotten} · 切面像素 {cassava}</div>}
          </div>
        </div>
      );
    })}
    {scopeNote && <p className="px-0.5 text-xs text-muted">{scopeNote}</p>}
    {notFound && notFound.length > 0 && <p className="px-0.5 text-xs text-warning-text">以下文件未命中结果中心记录：{notFound.join('、')}</p>}
  </div>
);

const ThinkingDots: React.FC<{ text: string }> = ({ text }) => (
  <span className="inline-flex items-center text-sm text-muted">
    {text}
    <span className="ppd-assistant-dot" /><span className="ppd-assistant-dot" /><span className="ppd-assistant-dot" />
  </span>
);

const AssistantPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  messagesRef.current = messages;

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const patch = useCallback((id: number, update: (m: ChatMessage) => ChatMessage) => {
    setMessages((list) => list.map((m) => (m.id === id ? update(m) : m)));
  }, []);

  const send = useCallback(async (raw: string, lastFileName: string | null = null) => {
    const text = raw.trim();
    if (!text || busy) return;

    const history = messagesRef.current
      .filter((m) => !m.streaming && !m.error && m.content.trim())
      .slice(-HISTORY_ROUNDS * 2)
      .map((m) => ({ role: m.role, content: m.content }));

    const assistantId = ++idRef.current + 1;
    idRef.current = assistantId;
    const userId = assistantId - 1;
    setMessages((list) => [
      ...list.map((m) => (m.followup && !m.followupDone ? { ...m, followupDone: true } : m)),
      { id: userId, role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '', status: SEARCHING_TEXT, streaming: true },
    ]);
    setInput('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let finished = false;

    const fail = (message: string) => {
      finished = true;
      patch(assistantId, (m) => ({ ...m, content: m.content ? `${m.content}\n${message}` : message, streaming: false, error: true, status: undefined }));
    };

    const handleEvent = (event: any) => {
      switch (event?.type) {
        case 'status':
          patch(assistantId, (m) => ({ ...m, status: event.text || SEARCHING_TEXT }));
          break;
        case 'evidence':
          patch(assistantId, (m) => ({
            ...m,
            cards: Array.isArray(event.cards) ? event.cards : [],
            scopeNote: event.scopeNote || undefined,
            notFound: Array.isArray(event.notFound) ? event.notFound : [],
          }));
          break;
        case 'delta':
          patch(assistantId, (m) => ({ ...m, content: m.content + (event.text || '') }));
          break;
        case 'followup':
          patch(assistantId, (m) => ({ ...m, followup: event.text || '', followupFile: m.cards?.[0]?.fileName ?? null }));
          break;
        case 'done':
          finished = true;
          patch(assistantId, (m) => ({ ...m, streaming: false, status: undefined }));
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
        body: JSON.stringify({ message: text, history, lastFileName }),
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
      if (abortRef.current === controller) abortRef.current = null;
      patch(assistantId, (m) => (m.streaming ? { ...m, streaming: false, status: undefined } : m));
      setBusy(false);
    }
  }, [busy, patch]);

  const answerFollowup = (message: ChatMessage, yes: boolean) => {
    patch(message.id, (m) => ({ ...m, followupDone: true }));
    if (yes) void send('是', message.followupFile ?? null);
  };

  return (
    <div
      className="ppd-assistant-panel fixed bottom-5 right-5 z-40 flex w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-hairline bg-white shadow-float"
      style={{ height: 'min(620px, calc(100vh - 11rem))' }}
      role="dialog"
      aria-label="PPD 助手"
    >
      <header className="flex items-start justify-between gap-3 border-b border-hairline bg-surface-muted px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-fill text-white"><Bot className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-ink">PPD 助手</h2>
            <p className="mt-0.5 text-xs text-muted">基于结果中心记录 · 回答附数据口径</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭助手" className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-surface-sunken hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-surface-muted/50 px-4 py-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted">
            <Sparkles className="h-6 w-6 text-accent-line" />
            <p className="text-sm text-ink-secondary">可以问我某张图的 PPD、计算口径，或哪些结果还没复核。</p>
            <p className="text-xs">回答中的数字均来自结果中心当前记录。</p>
          </div>
        )}
        {messages.map((m) => m.role === 'user' ? (
          <div key={m.id} className="ppd-assistant-msg flex justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-[#dcebe2] px-3 py-2 text-sm text-ink">{m.content}</div>
          </div>
        ) : (
          <div key={m.id} className="ppd-assistant-msg flex justify-start">
            <div className="w-full max-w-[95%] space-y-2 rounded-xl rounded-bl-sm border border-hairline bg-white px-3 py-2.5 shadow-card">
              {m.cards && m.cards.length > 0 && <EvidenceCards cards={m.cards} scopeNote={m.scopeNote} notFound={m.notFound} />}
              {(!m.cards || m.cards.length === 0) && (m.scopeNote || (m.notFound && m.notFound.length > 0)) && (
                <div className="space-y-0.5 text-xs text-muted">
                  {m.scopeNote && <p>{m.scopeNote}</p>}
                  {m.notFound && m.notFound.length > 0 && <p className="text-warning-text">以下文件未命中结果中心记录：{m.notFound.join('、')}</p>}
                </div>
              )}
              {m.streaming && !m.content ? (
                <ThinkingDots text={m.status || SEARCHING_TEXT} />
              ) : (
                <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${m.error ? 'text-danger-text' : 'text-ink'}`}>
                  {m.content}
                  {m.streaming && <span className="ppd-assistant-caret" />}
                </p>
              )}
              {m.followup && !m.followupDone && !m.streaming && (
                <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-2">
                  <span className="text-xs text-ink-secondary">{m.followup}</span>
                  <button type="button" disabled={busy} onClick={() => answerFollowup(m, true)} className="rounded-pill bg-brand-fill px-3 py-0.5 text-xs font-medium text-white transition-colors hover:bg-brand-fill-hover disabled:opacity-50">是</button>
                  <button type="button" disabled={busy} onClick={() => answerFollowup(m, false)} className="rounded-pill border border-hairline-strong bg-white px-3 py-0.5 text-xs text-ink-secondary transition-colors hover:bg-surface-muted disabled:opacity-50">否</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-hairline bg-white px-4 pb-3 pt-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => { event.preventDefault(); void send(input); }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="输入问题，例如某张图的 PPD"
            maxLength={500}
            className="min-w-0 flex-1 rounded-md border border-hairline-strong bg-white px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted-light focus:border-accent-line"
          />
          <button type="submit" disabled={busy || !input.trim()} aria-label="发送" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-fill text-white transition-colors hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:opacity-40">
            <Send className="h-4 w-4" />
          </button>
        </form>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((prompt) => (
            <button key={prompt} type="button" disabled={busy} onClick={() => void send(prompt)} className="rounded-pill border border-hairline-strong bg-surface-muted px-2.5 py-1 text-xs text-ink-secondary transition-colors hover:border-accent-line hover:text-accent-text disabled:opacity-50">
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const PpdAssistant: React.FC<{ currentUser?: User }> = ({ currentUser }) => {
  const [open, setOpen] = useState(false);

  // 未登录（无用户或访客）不渲染
  if (!currentUser || currentUser.is_guest) return null;

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
      {open && <AssistantPanel onClose={() => setOpen(false)} />}
    </>
  );
};

export default PpdAssistant;
