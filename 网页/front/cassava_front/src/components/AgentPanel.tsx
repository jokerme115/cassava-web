import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import {
  Activity, AlertCircle, ArrowUp, BarChart3, Bot, CheckCircle2, ChevronDown, FolderOpen, ListChecks,
  Loader2, Play, ShieldCheck, SquarePen, Sparkles, Terminal, X, XCircle,
} from 'lucide-react';
import { API_BASE_URL } from '../services/rest/client';
import { getAuthToken } from '../utils/authToken';
import { shortModelLabel } from '../utils/modelLabels';
import { RichText, ThinkingDots, useTypewriter } from './ppdChat';

/* ----------------------------- 类型 ----------------------------- */

type ConfirmArgs = { taskName?: string; model?: string; count?: number; files?: string[] };
type ConfirmState = 'pending' | 'sending' | 'uploading' | 'starting' | 'done' | 'cancelled' | 'failed';
type ConfirmInfo = {
  requestId: string;
  args: ConfirmArgs;
  state: ConfirmState;
  upload?: { k: number; n: number };
  error?: string;
  skipped?: number;
};
type TaskInfo = { taskId: number; taskName?: string; status: string; progress: number; imageCount?: number; resultCount?: number; stalled?: boolean };
// 后端 step 事件：按「工具 + 入参」去重后，同一 id 只在状态变化时再发一次
type AgentStep = { id: string; tool: string; status: string };
type AgentMsg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: string;
  streaming?: boolean;
  error?: boolean;
  /** 从历史接口回放的消息：没有工具过程，也不套「本轮没有返回内容」的兜底 */
  history?: boolean;
  fileCount?: number;
  confirm?: ConfirmInfo;
  task?: TaskInfo;
  steps?: AgentStep[];
  tokens?: number;
};

/** 历史接口返回的一轮对话（不含工具过程） */
export type AgentHistoryTurn = { role: 'user' | 'assistant'; text: string; time?: string };
export type AgentPanelHandle = {
  /** 把历史会话整段回放进对话区，并把 session 设为后续消息的续聊目标 */
  loadHistory: (session: string, turns: AgentHistoryTurn[]) => void;
  /** 清空当前线程（下一条消息不带 session，由后端新建会话） */
  reset: () => void;
};

const BATCH_SIZE = 10;
const POLL_MS = 3000;
const STALL_TICKS = 2;
const IMAGE_EXT = /\.(jpe?g|png)$/i;
const UPLOAD_INTENT = /上传|文件夹|批量|这批|这些图|传图|图片.{0,6}(预测|分析|识别)|(预测|分析|识别).{0,6}图片/;
const THINKING_TEXT = '正在思考';

const EXAMPLES = [
  '帮我上传一个文件夹的图片，并创建 PPD 预测任务',
  '把这批图片批量上传并用 PBT 模型预测',
];

/* 执行过程：工具名走中文映射，未知工具原样显示 */
const TOOL_LABELS: Record<string, string> = {
  plan_upload: '规划上传清单',
  create_task: '创建预测任务',
  task_status: '查询任务进度',
  prediction_summary: '汇总统计结果',
};

const TOOL_ICONS: Record<string, React.FC<{ className?: string }>> = {
  plan_upload: FolderOpen,
  create_task: Play,
  task_status: Activity,
  prediction_summary: BarChart3,
};

type StepState = 'running' | 'done' | 'failed';
const stepStateOf = (status: string): StepState => {
  const value = (status || '').toLowerCase();
  if (/fail|error|cancel|abort|reject/.test(value)) return 'failed';
  if (/complet|done|success|finish|end|ok/.test(value)) return 'done';
  return 'running';
};

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/$/, '')}${path}`;
const authHeaders = (extra: Record<string, string> = {}): Record<string, string> => {
  const token = getAuthToken();
  return { ...extra, ...(token ? { Authorization: `Token ${token}` } : {}) };
};

/* ----------------------------- 选文件夹 ----------------------------- */

const isUsableImage = (name: string) => !name.startsWith('.') && IMAGE_EXT.test(name);
const sortFiles = (files: File[]) => files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));

// 返回 null 表示用户取消。仅取所选文件夹第一层的图片，避免不同子文件夹里的同名文件互相冲突。
const pickFolder = async (fallbackInput: HTMLInputElement | null): Promise<File[] | null> => {
  const picker = (window as any).showDirectoryPicker;
  if (typeof picker === 'function') {
    try {
      const dir = await picker.call(window, { mode: 'read' });
      const out: File[] = [];
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== 'file' || !isUsableImage(name)) continue;
        out.push(await handle.getFile());
      }
      return sortFiles(out);
    } catch (error) {
      if ((error as any)?.name === 'AbortError') return null;
      // 其它失败（权限、浏览器限制）退回到 input 方式
    }
  }
  if (!fallbackInput) return null;
  return new Promise<File[] | null>((resolve) => {
    const input = fallbackInput;
    input.value = '';
    const cleanup = () => { input.removeEventListener('change', onChange); input.removeEventListener('cancel', onCancel); };
    const onChange = () => {
      cleanup();
      const list = Array.from(input.files || []).filter((f) => {
        const parts = (f.webkitRelativePath || f.name).split('/');
        return parts.length <= 2 && isUsableImage(f.name);
      });
      resolve(input.files && input.files.length ? sortFiles(list) : null);
    };
    const onCancel = () => { cleanup(); resolve(null); };
    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    input.click();
  });
};

const chipText = (files: File[]) => {
  const names = files.slice(0, 3).map((f) => f.name).join('、');
  return `已选 ${files.length} 张图片（${names}${files.length > 3 ? '…等' : ''}）`;
};

/* ----------------------------- SSE 解析 ----------------------------- */

const readSse = async (res: Response, onFrame: (name: string, data: any) => void) => {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = (chunk: string) => {
    let name = 'message';
    const dataLines: string[] = [];
    for (const raw of chunk.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (!dataLines.length) return;
    let data: any;
    try { data = JSON.parse(dataLines.join('\n')); } catch { onFrame('__parse_error', null); return; }
    onFrame(name, data);
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
};

const httpErrorText = (status: number) => (status === 401 ? '登录已过期，请重新登录后再试。' : `智能体服务暂时不可用（${status}），请稍后重试。`);

/* ----------------------------- Markdown 预处理（只作用于智能体气泡） ----------------------------- */

// RichText 只认得段落 / 加粗 / 行内码 / 有序无序列表，遇到 Markdown 表格和标题会原样露出管道符和井号。
// 这里把表格按行拆成「指标：数值」列表项、把行首井号去掉改成加粗行，问答 tab 的渲染件完全不动。
const isTableRow = (line: string) => {
  const t = line.trim();
  return t.startsWith('|') && t.split('|').length >= 3;
};
const splitRow = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const isSeparatorRow = (cells: string[]) => cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
const plain = (text: string) => text.replace(/\*\*/g, '');

const tableToList = (rows: string[][]): string[] => {
  const hasHead = rows.length >= 2 && isSeparatorRow(rows[1]);
  const head = hasHead ? rows[0] : null;
  const body = (hasHead ? rows.slice(2) : rows).filter((cells) => cells.some((cell) => cell));
  if (!body.length) return [];
  return body.map((cells) => {
    const label = plain(cells[0] || '').replace(/[：:]\s*$/, '');
    const rest = cells.slice(1);
    // 两列就是最常见的「指标｜数值」，读起来最顺
    if (rest.length <= 1) {
      const value = (rest[0] || '').trim();
      if (!label) return `- ${value}`;
      return value ? `- **${label}**：${value}` : `- **${label}**`;
    }
    // 多列：首列当行名加粗，其余列带上自己的表头，避免读者不知道数字是哪一列的
    const detail = rest
      .map((cell, index) => {
        if (!cell) return '';
        const column = head?.[index + 1] ? plain(head[index + 1]).replace(/[：:]\s*$/, '') : '';
        return column ? `${column} ${cell}` : cell;
      })
      .filter(Boolean)
      .join(' · ');
    if (!label) return `- ${detail}`;
    return detail ? `- **${label}**：${detail}` : `- **${label}**`;
  });
};

const preprocessMarkdown = (text: string): string => {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const title = heading[2].trim();
      if (title) out.push(`**${title}**`);
      continue;
    }
    if (isTableRow(line)) {
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      i -= 1;
      out.push(...tableToList(rows));
      continue;
    }
    // 纯分隔线（--- / *** / ___）在气泡里只会露出一串符号，去掉
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n');
};

/* ----------------------------- 子组件 ----------------------------- */

const TaskRow: React.FC<{ task: TaskInfo }> = ({ task }) => {
  const polled = task.imageCount !== undefined || task.status !== 'created';
  const done = task.status === 'completed';
  const failed = task.status === 'failed' || task.status === 'cancelled';
  const pct = Math.max(0, Math.min(100, Math.round(task.progress || 0)));
  // 后端 progress 只有 0 / 100 两档时，进度条会长时间钉在原地；连续几轮没变化就换成流光条，避免像卡死
  const flowing = !!task.stalled && !done && !failed;
  const counts = `已完成 ${task.resultCount ?? 0}/${task.imageCount ?? '—'}`;
  return (
    <div data-testid="agent-task" className="space-y-1.5 rounded-xl border border-hairline bg-white px-3 py-2.5 shadow-card">
      {!polled ? (
        <div className="flex items-center gap-2 text-sm text-ink-secondary"><Loader2 className="h-3.5 w-3.5 animate-spin text-accent-line" />任务已创建，正在预测…</div>
      ) : done ? (
        <div className="flex items-center gap-2 text-sm font-medium text-success-text"><CheckCircle2 className="h-4 w-4" />预测完成<span className="font-normal text-muted">（{counts}）</span></div>
      ) : failed ? (
        <div className="flex items-center gap-2 text-sm font-medium text-danger-text"><AlertCircle className="h-4 w-4" />预测{task.status === 'cancelled' ? '已取消' : '失败'}<span className="font-normal text-muted">（{counts}）</span></div>
      ) : (
        <div className="flex items-center justify-between gap-2 text-sm text-ink-secondary">
          <span className="flex items-center gap-2" aria-live="polite">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-line" />
            {flowing ? '预测中…' : `预测中 ${pct}%`}
            <span className="text-xs text-muted">（{counts}）</span>
          </span>
        </div>
      )}
      {(polled || done) && (
        <div
          data-testid="agent-task-bar"
          data-mode={flowing ? 'indeterminate' : 'determinate'}
          className="h-1.5 overflow-hidden rounded-pill bg-surface-sunken"
        >
          {flowing ? (
            <span className="agent-flow-run" aria-label="正在预测，进度暂时未知" />
          ) : (
            <div className={`h-full rounded-pill transition-all duration-500 ${failed ? 'bg-danger-text' : 'bg-accent-line'}`} style={{ width: `${done ? 100 : pct}%` }} />
          )}
        </div>
      )}
      {task.taskName && <div className="truncate text-xs text-muted" title={task.taskName}>任务：{task.taskName}</div>}
    </div>
  );
};

const ConfirmCard: React.FC<{ info: ConfirmInfo; onExecute: () => void; onReject: () => void }> = ({ info, onExecute, onReject }) => {
  const { args, state } = info;
  // 大清单模式下 files 可能缺失，也可能只给前 ≤8 个样例，count 才是全量
  const files = Array.isArray(args.files) ? args.files : [];
  const count = typeof args.count === 'number' && args.count > 0 ? args.count : files.length;
  const samples = files.slice(0, 3).join('、');
  const sampleOnly = files.length > 0 && files.length < count;
  const working = state === 'sending' || state === 'uploading' || state === 'starting';
  return (
    <div data-testid="agent-confirm" data-state={state} data-file-mode={files.length ? 'samples' : 'count'} className="relative overflow-hidden rounded-xl border border-accent-line/40 bg-white py-3 pl-4 pr-3 shadow-card">
      <span className="absolute inset-y-0 left-0 w-1 bg-accent-line" />
      <div className="flex items-center gap-1.5 text-sm font-semibold text-ink"><ShieldCheck className="h-4 w-4 text-accent-line" />即将执行</div>
      <ul className="mt-2 space-y-1 text-sm text-ink-secondary">
        <li className="flex items-baseline gap-1.5"><span className="h-1 w-1 shrink-0 translate-y-[-3px] rounded-full bg-accent-line" />上传 <b className="tabular-nums text-ink">{count}</b> 张图片</li>
        <li className="flex items-baseline gap-1.5"><span className="h-1 w-1 shrink-0 translate-y-[-3px] rounded-full bg-accent-line" />创建 <b className="text-ink">1</b> 个预测任务</li>
      </ul>
      <dl className="mt-2.5 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 rounded-lg bg-surface-muted/70 px-3 py-2 text-xs">
        <dt className="text-muted">任务名</dt><dd className="min-w-0 truncate text-ink" title={args.taskName}>{args.taskName || '—'}</dd>
        <dt className="text-muted">模型</dt><dd className="text-ink">{args.model ? shortModelLabel(args.model) : '—'}</dd>
        <dt className="text-muted">文件数</dt>
        <dd className="min-w-0">
          {files.length > 0 ? (
            <span className="block truncate text-ink" title={files.join('\n')}>
              {samples}{count > files.length || count > 3 ? ` 等 ${count} 张` : `（${count} 张）`}
            </span>
          ) : (
            <span className="tabular-nums text-ink">{count} 张图片</span>
          )}
        </dd>
      </dl>
      {sampleOnly && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-light">只列出前 {files.length} 张样例，实际按所选文件夹里的 {count} 张全部上传。</p>
      )}
      {state === 'pending' && (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={onExecute} className="rounded-pill bg-brand-fill px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-fill-hover">执行</button>
          <button type="button" onClick={onReject} className="rounded-pill border border-hairline-strong bg-white px-4 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-surface-sunken">取消</button>
        </div>
      )}
      {working && (
        <div className="mt-3 space-y-1.5 text-sm text-ink-secondary">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-line" />
            {state === 'sending' && '正在提交确认…'}
            {state === 'uploading' && `上传中 ${info.upload?.k ?? 0}/${info.upload?.n ?? count}`}
            {state === 'starting' && '上传完成，正在创建任务…'}
          </div>
          {state === 'uploading' && info.upload && (
            <div className="h-1.5 overflow-hidden rounded-pill bg-surface-sunken"><div className="h-full rounded-pill bg-accent-line transition-all duration-300" style={{ width: `${Math.round((info.upload.k / Math.max(1, info.upload.n)) * 100)}%` }} /></div>
          )}
        </div>
      )}
      {state === 'done' && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 text-xs font-medium text-success-text"><span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />已确认执行</span>{!!info.skipped && <span className="font-normal text-warning-text">{info.skipped} 张已存在，已跳过上传</span>}</div>
      )}
      {state === 'cancelled' && <div className="mt-3 text-xs font-medium text-muted">已取消，不会上传也不会创建任务</div>}
      {state === 'failed' && <div className="mt-3 flex items-start gap-1.5 text-xs text-danger-text"><AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />{info.error || '执行失败，请稍后重试。'}</div>}
    </div>
  );
};

/* 执行过程时间线：固定在气泡顶部，工具按出现顺序逐行追加；全部结束后自动收成一行摘要 */
const StepTimeline: React.FC<{ steps: AgentStep[] }> = ({ steps }) => {
  const running = steps.some((step) => stepStateOf(step.status) === 'running');
  // 首帧就已经全部结束（快速轮次）时直接收成摘要；否则先展开，等最后一步结束再收
  const [collapsed, setCollapsed] = useState(() => !running);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (running) setCollapsed(false);
    else if (wasRunning.current) setCollapsed(true);
    wasRunning.current = running;
  }, [running]);

  const doneCount = steps.filter((step) => stepStateOf(step.status) === 'done').length;
  const failedCount = steps.filter((step) => stepStateOf(step.status) === 'failed').length;

  if (!running && collapsed) {
    const summary = failedCount ? `已完成 ${doneCount} 步，${failedCount} 步失败` : `已完成 ${steps.length} 步`;
    return (
      <button
        type="button"
        data-testid="agent-steps-summary"
        onClick={() => setCollapsed(false)}
        className="group inline-flex max-w-full items-center gap-1.5 self-start rounded-pill border border-hairline bg-surface-muted/60 px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-hairline-strong hover:bg-surface-muted hover:text-ink-secondary"
      >
        {failedCount ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-danger-text" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent-line" />}
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-light transition-transform group-hover:translate-y-0.5" />
      </button>
    );
  }

  return (
    <div data-testid="agent-steps" className="rounded-xl border border-hairline bg-white/70 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
          {running ? <Loader2 className="h-3 w-3 animate-spin text-accent-line" /> : <ListChecks className="h-3 w-3 text-accent-line/70" />}
          执行过程
        </span>
        {!running && (
          <button type="button" onClick={() => setCollapsed(true)} className="text-[11px] text-muted-light transition-colors hover:text-muted">收起</button>
        )}
      </div>
      <ol className="space-y-0.5">
        {steps.map((step) => {
          const state = stepStateOf(step.status);
          const Icon = TOOL_ICONS[step.tool] || Terminal;
          return (
            <li key={step.id} data-testid="agent-step" className="flex items-center gap-2 py-0.5 text-xs">
              <Icon className={`h-3.5 w-3.5 shrink-0 ${state === 'running' ? 'text-accent-line' : 'text-muted-light'}`} />
              <span className={`min-w-0 truncate ${state === 'running' ? 'font-medium text-ink-secondary' : 'text-muted'}`}>{TOOL_LABELS[step.tool] || step.tool}</span>
              {state === 'running' && (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted">
                  <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin text-accent-line" />进行中
                </span>
              )}
              {state === 'done' && <><CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-accent-line" /><span className="sr-only">完成</span></>}
              {state === 'failed' && <><XCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-danger-text" /><span className="sr-only">失败</span></>}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

const AgentBubble: React.FC<{ message: AgentMsg; onExecute: (id: string) => void; onReject: (id: string) => void }> = ({ message: m, onExecute, onReject }) => {
  const { shown, typing } = useTypewriter(m.content, !!m.streaming);
  const hasSteps = !!m.steps && m.steps.length > 0;
  const waiting = !!m.streaming && !m.content && !m.task && !m.confirm && !hasSteps;
  const body = m.error ? shown : preprocessMarkdown(shown);
  // turn_end 之后仍然一个字都没有：给一条灰字，避免留下空气泡（历史回放不算）
  const empty = !m.streaming && !m.content && !m.task && !m.confirm && !m.history;
  // 阅读顺序：先说话（要做什么），再给确认卡（请你点执行），执行过程时间线放卡片后面当日志。
  // 没有确认卡时（events 流、纯汇报）时间线仍在顶部，先看过程再看结论。
  const steps = hasSteps ? <StepTimeline steps={m.steps!} /> : null;
  const stepsFirst = !m.confirm;
  return (
    <div className="ppd-msg flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-fill/10 text-brand-fill"><Bot className="h-4 w-4" /></span>
      <div className="flex min-w-0 flex-1 flex-col space-y-2.5">
        {stepsFirst && steps}
        {waiting ? <ThinkingDots text={m.status || THINKING_TEXT} /> : (
          (m.content || m.streaming) && (m.error
            ? <div className="flex items-start gap-1.5 rounded-lg bg-danger-text/5 px-2.5 py-2"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger-text" /><RichText text={body} tone="text-danger-text" /></div>
            : <RichText text={body} caret={!!m.streaming || typing} tone="text-ink" />)
        )}
        {m.confirm && <ConfirmCard info={m.confirm} onExecute={() => onExecute(m.id)} onReject={() => onReject(m.id)} />}
        {!stepsFirst && steps}
        {empty && <p data-testid="agent-empty-turn" className="text-sm text-muted">本轮没有返回内容，请重试</p>}
        {m.task && <TaskRow task={m.task} />}
        {typeof m.tokens === 'number' && !m.streaming && <p className="text-[11px] text-muted-light">本轮用量 {m.tokens.toLocaleString('en-US')} tokens</p>}
      </div>
    </div>
  );
};

/* 进度未知时的流光条：只在本文件内定义，不碰问答 tab 的样式块。
   底色恒定铺满（任何时刻都不会像空条），一条柔光在轨道上循环扫过。 */
const FLOW_STYLE = `
@keyframes agent-flow-sweep { 0% { background-position: -120% 0; } 100% { background-position: 130% 0; } }
.agent-flow-run { display: block; height: 100%; width: 100%; border-radius: 999px;
  background-color: rgba(61,128,96,.16);
  background-image: linear-gradient(90deg, rgba(61,128,96,0) 0%, rgba(61,128,96,.55) 45%, #3d8060 60%, rgba(61,128,96,0) 100%);
  background-size: 45% 100%; background-repeat: no-repeat; background-position: -120% 0;
  animation: agent-flow-sweep 1.7s cubic-bezier(.4,0,.3,1) infinite; }
@media (prefers-reduced-motion: reduce) { .agent-flow-run { animation: none; background-image: none; background-color: rgba(61,128,96,.35); } }
`;

/* ----------------------------- 智能体面板 ----------------------------- */

// 独立页里不再需要 active：保留为可选参数，兼容旧的抽屉调用方式
const AgentPanel = forwardRef<AgentPanelHandle, { displayName?: string; onSessionChange?: (session: string | null) => void }>(
  function AgentPanel({ displayName, onSessionChange }, ref) {
  const [msgs, setMsgs] = useState<AgentMsg[]>([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [turnActive, setTurnActive] = useState(false);
  const [picking, setPicking] = useState(false);
  const [hint, setHint] = useState<null | { kind: 'need' | 'empty'; text: string }>(null);

  const msgsRef = useRef(msgs);
  const filesRef = useRef(files);
  const sessionRef = useRef<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const pollRef = useRef<{ timer: number; ctrl: AbortController } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  msgsRef.current = msgs;
  filesRef.current = files;

  const hasPending = msgs.some((m) => m.confirm?.state === 'pending');
  const busy = turnActive || hasPending || picking;

  const patch = useCallback((id: string, update: (m: AgentMsg) => AgentMsg) => {
    setMsgs((list) => list.map((m) => (m.id === id ? update(m) : m)));
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { window.clearInterval(pollRef.current.timer); pollRef.current.ctrl.abort(); pollRef.current = null; }
  }, []);

  useEffect(() => () => { ctrlRef.current?.abort(); stopPolling(); }, [stopPolling]);

  // 滚动：停在底部时跟随新内容；程序化滚动期间不改跟随状态，避免内容收缩时误判为“用户上滑”
  useLayoutEffect(() => {
    const content = contentRef.current;
    const scroller = scrollRef.current;
    if (!content || !scroller || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (!stickRef.current) return;
      scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    stickRef.current = true;
    const el = scrollRef.current;
    if (el) { el.scrollTop = el.scrollHeight; }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [input]);

  /* ---- 任务进度轮询（用浏览器 token，每 3 秒） ---- */
  const startPolling = useCallback((taskId: number, mid: string) => {
    stopPolling();
    const ctrl = new AbortController();
    // 后端 progress 可能长时间停在同一个值（只有 0 / 100 两档），连续 STALL_TICKS 轮询没变化就点亮流光条
    let lastProgress: number | null = null;
    let flatTicks = 0;
    const tick = async () => {
      try {
        const res = await fetch(apiUrl(`/tasks/${taskId}/`), { signal: ctrl.signal, headers: authHeaders({ Accept: 'application/json' }) });
        if (!res.ok) return;
        const raw = await res.json();
        const d = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
        const status = String(d?.status || 'running');
        const progress = Number(d?.progress) || 0;
        const settle = status === 'completed' || status === 'failed' || status === 'cancelled';
        if (progress !== lastProgress) { lastProgress = progress; flatTicks = 0; }
        else if (!settle) flatTicks += 1;
        patch(mid, (m) => ({
          ...m,
          task: {
            ...(m.task || { taskId }),
            taskId,
            status,
            progress,
            stalled: !settle && flatTicks >= STALL_TICKS,
            imageCount: typeof d?.image_count === 'number' ? d.image_count : m.task?.imageCount,
            resultCount: typeof d?.result_count === 'number' ? d.result_count : m.task?.resultCount,
          },
        }));
        if (settle) stopPolling();
      } catch { /* 单次轮询失败忽略，下一轮继续 */ }
    };
    pollRef.current = { timer: window.setInterval(() => void tick(), POLL_MS), ctrl };
    void tick();
  }, [patch, stopPolling]);

  /* ---- 统一消费一条 SSE（chat 与 events 共用） ---- */
  const consume = useCallback(async (res: Response, target: { id: string | null }, ensure: () => string) => {
    let ended = false;
    let confirmed = false;
    let parseWarned = false;
    const tid = () => target.id ?? (target.id = ensure());
    await readSse(res, (name, d) => {
      switch (name) {
        case 'meta':
          if (typeof d?.session === 'string') {
            sessionRef.current = d.session;
            onSessionChange?.(d.session);
          }
          break;
        case 'delta': {
          const id = tid();
          patch(id, (m) => ({ ...m, content: m.content + (typeof d?.text === 'string' ? d.text : '') }));
          break;
        }
        // 工具调用过程：同 id 只更新状态，新 id 才追加一行（同一工具多轮出现就是多行）
        case 'step': {
          const tool = typeof d?.tool === 'string' ? d.tool : '';
          if (!tool) break;
          const status = typeof d?.status === 'string' && d.status ? d.status : 'running';
          const stepId = typeof d?.id === 'string' && d.id ? d.id : `${tool}-${status}-${Date.now().toString(36)}`;
          const id = tid();
          patch(id, (m) => {
            const list = m.steps ? [...m.steps] : [];
            const at = list.findIndex((step) => step.id === stepId);
            if (at >= 0) list[at] = { ...list[at], status };
            else list.push({ id: stepId, tool, status });
            return { ...m, steps: list };
          });
          break;
        }
        case 'confirm': {
          confirmed = true;
          const id = tid();
          const args: ConfirmArgs = d?.args && typeof d.args === 'object' ? d.args : {};
          patch(id, (m) => ({ ...m, streaming: false, status: undefined, confirm: { requestId: String(d?.requestId ?? ''), args, state: 'pending' } }));
          break;
        }
        case 'task_created': {
          const id = tid();
          const taskId = Number(d?.taskId);
          if (!Number.isFinite(taskId)) break;
          patch(id, (m) => ({ ...m, task: { taskId, taskName: d?.taskName, status: 'created', progress: 0 } }));
          startPolling(taskId, id);
          break;
        }
        case 'turn_end':
          ended = true;
          setTurnActive(false);
          break;
        case 'done':
          if (typeof d?.tokens === 'number' && target.id) patch(target.id, (m) => ({ ...m, tokens: d.tokens }));
          break;
        case 'error': {
          const id = tid();
          const text = typeof d?.message === 'string' && d.message ? d.message : '智能体出错了，请稍后重试。';
          ended = true;
          patch(id, (m) => ({ ...m, content: m.content ? `${m.content}\n${text}` : text, error: true, streaming: false, status: undefined }));
          setTurnActive(false);
          break;
        }
        case '__parse_error':
          if (!parseWarned) {
            parseWarned = true;
            const id = tid();
            patch(id, (m) => ({ ...m, content: `${m.content}${m.content ? '\n' : ''}收到一段无法解析的数据，已忽略。` }));
          }
          break;
        default:
          break;
      }
    });
    return { ended, confirmed };
  }, [onSessionChange, patch, startPolling]);

  const failBubble = useCallback((id: string, text: string) => {
    patch(id, (m) => ({ ...m, content: m.content ? `${m.content}\n${text}` : text, error: true, streaming: false, status: undefined }));
    setTurnActive(false);
  }, [patch]);

  /* ---- 发送 ---- */
  const send = useCallback(async (raw: string, skipPick = false) => {
    const text = raw.trim();
    if (!text) return;
    let chosen = filesRef.current;
    if (!skipPick && chosen.length === 0 && UPLOAD_INTENT.test(text)) {
      setPicking(true);
      let picked: File[] | null = null;
      try { picked = await pickFolder(folderInputRef.current); } finally { setPicking(false); }
      if (!picked) { setHint({ kind: 'need', text: '这条消息涉及上传，需要先选择图片文件夹。' }); return; }
      if (picked.length === 0) { setHint({ kind: 'empty', text: '这个文件夹里没有 jpg / jpeg / png 图片，请换一个。' }); return; }
      chosen = picked;
      setFiles(picked);
    }
    setHint(null);

    const assistantId = uid();
    stickRef.current = true;
    setMsgs((list) => [
      ...list,
      { id: uid(), role: 'user', content: text, fileCount: chosen.length || undefined },
      { id: assistantId, role: 'assistant', content: '', streaming: true, status: THINKING_TEXT },
    ]);
    setInput('');
    setTurnActive(true);

    ctrlRef.current?.abort();
    const controller = new AbortController();
    ctrlRef.current = controller;
    try {
      const res = await fetch(apiUrl('/agent/chat/'), {
        method: 'POST',
        signal: controller.signal,
        headers: authHeaders({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
        body: JSON.stringify({
          message: text,
          ...(chosen.length ? { fileNames: chosen.map((f) => f.name) } : {}),
          ...(sessionRef.current ? { session: sessionRef.current } : {}),
        }),
      });
      if (!res.ok || !res.body) { failBubble(assistantId, httpErrorText(res.status)); return; }
      const target = { id: assistantId as string | null };
      const { ended, confirmed } = await consume(res, target, () => assistantId);
      patch(assistantId, (m) => (m.streaming ? { ...m, streaming: false, status: undefined } : m));
      if (!ended && !confirmed) {
        setTurnActive(false);
        patch(assistantId, (m) => (m.content || m.task || m.confirm ? m : { ...m, content: '没有收到回复，请重试。', error: true }));
      }
    } catch (error) {
      if ((error as any)?.name !== 'AbortError') failBubble(assistantId, '连接中断了，请检查网络后重试。');
    }
  }, [consume, failBubble, patch]);

  /* ---- 确认卡：执行 / 取消 ---- */
  const execute = useCallback(async (mid: string) => {
    const info = msgsRef.current.find((m) => m.id === mid)?.confirm;
    const session = sessionRef.current;
    if (!info || info.state !== 'pending') return;
    const setCf = (p: Partial<ConfirmInfo>) => patch(mid, (m) => (m.confirm ? { ...m, confirm: { ...m.confirm, ...p } } : m));
    const fail = (text: string) => { setCf({ state: 'failed', error: text }); setTurnActive(false); };
    if (!session) { fail('会话已丢失，请重新发起。'); return; }

    setTurnActive(true);
    setCf({ state: 'sending' });
    const controller = new AbortController();
    ctrlRef.current?.abort();
    ctrlRef.current = controller;
    try {
      // 1) 确认
      const confirmRes = await fetch(apiUrl('/agent/confirm/'), {
        method: 'POST', signal: controller.signal,
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ session, requestId: info.requestId, reply: 'once' }),
      });
      if (!confirmRes.ok) { fail(confirmRes.status === 401 ? '登录已过期，请重新登录后再试。' : `确认失败（${confirmRes.status}），请重试。`); return; }

      // 2) 分批上传
      // args.files 可能只是前 ≤8 个样例：少于 count 时不能当白名单用，否则会漏传
      const listed = info.args.files || [];
      const completeList = listed.length > 0 && listed.length >= (info.args.count ?? 0);
      const wanted = completeList ? new Set(listed) : null;
      const toUpload = filesRef.current.filter((f) => !wanted || wanted.has(f.name));
      if (toUpload.length === 0) { fail('没有找到要上传的图片，请重新选择文件夹。'); return; }
      const imageIds: number[] = [];
      let skipped = 0;
      let processed = 0;
      setCf({ state: 'uploading', upload: { k: 0, n: toUpload.length } });
      for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
        const batch = toUpload.slice(i, i + BATCH_SIZE);
        const form = new FormData();
        batch.forEach((f) => form.append('files', f));
        const upRes = await fetch(apiUrl('/images/upload-files/'), { method: 'POST', signal: controller.signal, headers: authHeaders({ Accept: 'application/json' }), body: form });
        if (upRes.status !== 201 && upRes.status !== 207) { fail(`第 ${i + 1}-${i + batch.length} 张上传失败（${upRes.status}），任务未创建。`); return; }
        const body = await upRes.json();
        const uploaded: any[] = Array.isArray(body) ? body : body?.images || body?.results || [];
        uploaded.forEach((img) => { if (img && img.id !== undefined && img.id !== null) imageIds.push(img.id); });
        skipped += Array.isArray(body?.duplicates) ? body.duplicates.length : 0;
        processed += batch.length;
        setCf({ upload: { k: processed, n: toUpload.length } });
      }
      if (imageIds.length === 0) { fail('图片都没有上传成功（可能已存在），任务未创建。'); return; }

      // 3) 上传完成
      setCf({ state: 'starting', skipped });
      const doneRes = await fetch(apiUrl('/agent/upload-complete/'), {
        method: 'POST', signal: controller.signal,
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ session, imageIds }),
      });
      if (!doneRes.ok) { fail(`通知智能体失败（${doneRes.status}），请重试。`); return; }
      setCf({ state: 'done' });
      setFiles([]);

      // 4) 事件流：任务创建、进度与最终汇报
      const runId = uid();
      setMsgs((list) => [...list, { id: runId, role: 'assistant', content: '', streaming: true, status: '正在创建预测任务' }]);
      const evRes = await fetch(apiUrl(`/agent/events/?session=${encodeURIComponent(session)}`), {
        signal: controller.signal, headers: authHeaders({ Accept: 'text/event-stream' }),
      });
      if (!evRes.ok || !evRes.body) { failBubble(runId, httpErrorText(evRes.status)); return; }
      const { ended } = await consume(evRes, { id: runId }, () => runId);
      patch(runId, (m) => (m.streaming ? { ...m, streaming: false, status: undefined } : m));
      if (!ended) setTurnActive(false);
    } catch (error) {
      if ((error as any)?.name === 'AbortError') return;
      const cur = msgsRef.current.find((m) => m.id === mid)?.confirm?.state;
      if (cur === 'done') {
        const last = msgsRef.current[msgsRef.current.length - 1];
        if (last?.role === 'assistant') failBubble(last.id, '连接中断了，任务进度可能未能继续显示。');
        else setTurnActive(false);
      } else fail('网络出错了，请重试。');
    }
  }, [consume, failBubble, patch]);

  const reject = useCallback(async (mid: string) => {
    const info = msgsRef.current.find((m) => m.id === mid)?.confirm;
    const session = sessionRef.current;
    if (!info || info.state !== 'pending') return;
    patch(mid, (m) => (m.confirm ? { ...m, confirm: { ...m.confirm, state: 'cancelled' } } : m));
    setTurnActive(false);
    if (!session) return;
    try {
      await fetch(apiUrl('/agent/confirm/'), {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ session, requestId: info.requestId, reply: 'reject' }),
      });
    } catch { /* 卡片已显示取消；后端会话超时自行回收 */ }
  }, [patch]);

  const startNew = useCallback(() => {
    ctrlRef.current?.abort();
    stopPolling();
    sessionRef.current = null;
    setMsgs([]); setFiles([]); setHint(null); setInput(''); setTurnActive(false);
    onSessionChange?.(null);
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [onSessionChange, stopPolling]);

  /* ---- 历史会话：整段回放 + 续聊 ---- */
  useImperativeHandle(ref, () => ({
    loadHistory: (session, turns) => {
      ctrlRef.current?.abort();
      stopPolling();
      sessionRef.current = session;
      const mapped: AgentMsg[] = (turns || [])
        .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant'))
        .map((turn) => ({ id: uid(), role: turn.role, content: String(turn.text ?? ''), history: true }));
      setMsgs(mapped);
      setFiles([]); setHint(null); setInput(''); setTurnActive(false);
      stickRef.current = true;
      onSessionChange?.(session);
      window.setTimeout(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        inputRef.current?.focus();
      }, 60);
    },
    reset: () => startNew(),
  }), [onSessionChange, startNew, stopPolling]);

  const chooseFolder = async () => {
    if (busy) return;
    setPicking(true);
    try {
      const picked = await pickFolder(folderInputRef.current);
      if (!picked) return;
      if (picked.length === 0) { setHint({ kind: 'empty', text: '这个文件夹里没有 jpg / jpeg / png 图片，请换一个。' }); return; }
      setFiles(picked); setHint(null);
    } finally { setPicking(false); }
  };

  const submit = () => { if (!busy) void send(input); };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="agent-panel">
      <style>{FLOW_STYLE}</style>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={(e) => {
            // 只在真的回到最底部时重新跟随；内容收缩引起的滚动事件不改跟随状态
            const el = e.currentTarget;
            if (el.scrollHeight - el.scrollTop - el.clientHeight <= 2) stickRef.current = true;
          }}
          onWheel={(e) => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}
          onTouchMove={(e) => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}
          onPointerDown={(e) => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}
          className="ppd-scroll ppd-scroll-fade absolute inset-0 overflow-y-auto px-4 py-4"
        >
          <div ref={contentRef} className="mx-auto flex min-h-full w-full max-w-[760px] flex-col space-y-5">
            {msgs.length === 0 && (
              <div className="my-auto pb-14 pt-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-fill/10 text-brand-fill"><Sparkles className="h-5 w-5" /></span>
                <h3 className="mt-3 text-lg font-semibold text-ink">{displayName ? `${displayName}，要我帮你做什么？` : '要我帮你做什么？'}</h3>
                <p className="mt-1 text-sm text-muted">告诉我要预测哪批图片，我会请你选择文件夹，核对任务名、模型和数量，你点「执行」后才会上传并创建预测任务。</p>
                <div className="mt-5 space-y-2">
                  {EXAMPLES.map((ex) => (
                    <button key={ex} type="button" onClick={() => { setInput(ex); inputRef.current?.focus(); }} className="group flex w-full items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-3.5 py-2.5 text-left text-sm text-ink-secondary shadow-card transition-all hover:-translate-y-px hover:border-accent-line/60 hover:text-ink">
                      <span className="min-w-0 truncate">{ex}</span>
                      <ArrowUp className="h-3.5 w-3.5 shrink-0 rotate-45 text-muted-light transition-colors group-hover:text-accent-line" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m) => m.role === 'user' ? (
              <div key={m.id} className="ppd-msg flex justify-end">
                <div className="max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-fill px-3.5 py-2 text-sm leading-relaxed text-white">
                  {m.content}
                  {!!m.fileCount && <div className="mt-1 inline-flex items-center gap-1 rounded-pill bg-white/15 px-2 py-0.5 text-[11px]"><FolderOpen className="h-3 w-3" />{m.fileCount} 张图片</div>}
                </div>
              </div>
            ) : (
              <AgentBubble key={m.id} message={m} onExecute={(id) => void execute(id)} onReject={(id) => void reject(id)} />
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-hairline bg-white px-4 pb-3.5 pt-2.5">
        <div className="mx-auto w-full max-w-[760px]">
        {files.length > 0 && (
          <div data-testid="agent-folder-chip" className="mb-2 flex items-center gap-1.5">
            <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-pill border border-accent-line/40 bg-surface-muted px-2.5 py-1 text-xs text-accent-text">
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate" title={files.map((f) => f.name).join('\n')}>{chipText(files)}</span>
              <button type="button" disabled={busy} onClick={() => setFiles([])} aria-label="清除已选文件夹" title="清除，重新选择" className="shrink-0 rounded-full p-0.5 text-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40"><X className="h-3 w-3" /></button>
            </span>
          </div>
        )}
        {hint && (
          <div data-testid="agent-hint" className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-warning-100/60 px-2.5 py-1.5 text-xs text-warning-text">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{hint.text}</span>
            {hint.kind === 'need' && (
              <>
                <button type="button" onClick={() => void chooseFolder()} className="font-medium underline-offset-2 hover:underline">选择文件夹</button>
                <button type="button" onClick={() => void send(input, true)} className="underline-offset-2 hover:underline">直接发送</button>
              </>
            )}
          </div>
        )}
        <form
          className="flex items-end gap-2 rounded-2xl border border-hairline-strong bg-white py-1.5 pl-1.5 pr-1.5 transition-colors focus-within:border-accent-line"
          onSubmit={(event) => { event.preventDefault(); submit(); }}
        >
          <button type="button" disabled={busy} onClick={() => void chooseFolder()} aria-label="选择图片文件夹" title="选择图片文件夹" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-sunken hover:text-accent-text disabled:cursor-not-allowed disabled:opacity-35">
            {picking ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
          </button>
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
            }}
            placeholder={hasPending ? '请先确认或取消上面的操作…' : '告诉我要做什么，比如上传并预测一批图片…'}
            maxLength={500}
            aria-label="输入指令"
            className="max-h-28 min-h-[1.75rem] min-w-0 flex-1 resize-none self-center bg-transparent py-1 text-sm leading-relaxed text-ink outline-none placeholder:text-muted-light disabled:cursor-not-allowed"
          />
          <button type="submit" disabled={busy || !input.trim()} aria-label="发送指令" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-fill text-white transition-colors hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:opacity-35">
            <ArrowUp className="h-4 w-4" />
          </button>
        </form>
        <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[11px] text-muted-light">
          <span>Enter 发送 · 上传和创建任务前会先请你确认</span>
          {msgs.length > 0 && (
            <button type="button" onClick={startNew} disabled={turnActive && !hasPending} className="inline-flex items-center gap-1 text-muted hover:text-ink disabled:opacity-40"><SquarePen className="h-3 w-3" />新会话</button>
          )}
        </div>
        </div>
      </div>
      <input ref={folderInputRef} type="file" className="hidden" tabIndex={-1} aria-hidden="true" {...({ webkitdirectory: '', directory: '' } as any)} multiple />
    </div>
  );
  },
);

export default AgentPanel;
