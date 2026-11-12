import React, { useEffect, useMemo, useRef, useState } from 'react';

/* 问答与智能体共用的轻量渲染件：Markdown 文本、打字机、等待点。 */

/* ----------------------------- 轻量 Markdown ----------------------------- */

const renderInline = (line: string, keyPrefix: string): React.ReactNode[] => {
  // 打字过程中遇到未闭合的 **：已写出的部分先按加粗显示，避免露出星号
  const marks = (line.match(/\*\*/g) || []).length;
  let text = line;
  if (marks % 2 === 1) text = text.endsWith('**') ? text.slice(0, -2) : `${text}**`;
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|【[^】]*需用户确认[^】]*】)/g).filter(Boolean).map((part, i) => {
    // 知识库里“素材未覆盖”的条目：标记原样保留，只加醒目底色，提示待确认
    if (part.startsWith('【') && part.endsWith('】') && part.includes('需用户确认')) return <mark key={`${keyPrefix}-${i}`} data-testid="pending-mark" className="rounded bg-warning-100 px-1 py-0.5 text-[0.9em] font-medium text-warning-text">{part}</mark>;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={`${keyPrefix}-${i}`} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={`${keyPrefix}-${i}`} className="rounded bg-surface-sunken px-1 py-0.5 text-[0.85em]">{part.slice(1, -1)}</code>;
    return <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>;
  });
};

type Block = { type: 'p'; text: string } | { type: 'ul' | 'ol'; items: string[] };

const parseBlocks = (text: string): Block[] => {
  const blocks: Block[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)、]\s+(.*)$/);
    const kind = bullet ? 'ul' : ordered ? 'ol' : 'p';
    if (kind === 'p') { blocks.push({ type: 'p', text: line }); continue; }
    const itemText = (bullet || ordered)![1];
    const last = blocks[blocks.length - 1];
    if (last && last.type === kind) last.items.push(itemText);
    else blocks.push({ type: kind, items: [itemText] });
  }
  return blocks;
};

export const RichText: React.FC<{ text: string; caret?: boolean; tone?: string }> = ({ text, caret, tone = 'text-ink' }) => {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const tail = caret ? <span className="ppd-caret" /> : null;
  if (blocks.length === 0) return tail ? <p className={`text-sm leading-relaxed ${tone}`}>{tail}</p> : null;
  return (
    <div className={`space-y-2 break-words text-sm leading-relaxed ${tone}`}>
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;
        if (block.type === 'p') return <p key={index}>{renderInline(block.text, `p${index}`)}{isLast && tail}</p>;
        const List = block.type === 'ul' ? 'ul' : 'ol';
        return (
          <List key={index} className={`space-y-1 pl-5 ${block.type === 'ul' ? 'list-disc' : 'list-decimal'} marker:text-accent-line`}>
            {block.items.map((item, i) => <li key={i}>{renderInline(item, `l${index}-${i}`)}{isLast && i === block.items.length - 1 && tail}</li>)}
          </List>
        );
      })}
    </div>
  );
};

/* ----------------------------- 打字机 ----------------------------- */

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// 只有"在本次挂载期间还在流式输出"的消息才做逐字呈现；历史消息直接整段显示。
// 速度随积压量自适应：慢时约 40 字/秒，积压多时最高约 220 字/秒，既不拖沓也不一下蹦出来。
export function useTypewriter(full: string, streaming: boolean) {
  const animated = useRef(streaming && !prefersReducedMotion());
  if (streaming && !prefersReducedMotion()) animated.current = true;
  const [count, setCount] = useState(animated.current ? 0 : full.length);
  const countRef = useRef(count);
  const fullRef = useRef(full);
  fullRef.current = full;

  useEffect(() => {
    if (!animated.current) return undefined;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const target = fullRef.current.length;
      const backlog = target - countRef.current;
      if (backlog > 0) {
        acc += (Math.min(220, 38 + backlog * 1.6) * dt) / 1000;
        const step = Math.floor(acc);
        if (step > 0) {
          acc -= step;
          countRef.current = Math.min(target, countRef.current + step);
          setCount(countRef.current);
        }
      }
      if (countRef.current < target || streaming) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [full, streaming]);

  if (!animated.current) return { shown: full, typing: false };
  return { shown: full.slice(0, count), typing: count < full.length };
}

export const ThinkingDots: React.FC<{ text: string }> = ({ text }) => (
  <span className="inline-flex items-center text-sm text-muted">
    {text}
    <span className="ppd-dot" /><span className="ppd-dot" /><span className="ppd-dot" />
  </span>
);
