/**
 * PPD 风险色统一口径。
 *
 * 背景：图片管理页曾用「高值=蓝、低值=红」，结果中心却是「高值=红、低值=绿」，
 * 同一指标在不同页面表达相反的风险含义。这里把阈值和颜色收敛成唯一来源。
 *
 * 阈值沿用结果中心的语义：>=7 严重、4–7 轻微、<4 健康、未知灰。
 */

export type PpdTone = 'high' | 'mid' | 'low' | 'unknown';

export const PPD_THRESHOLD_HIGH = 7;
export const PPD_THRESHOLD_MID = 4;

export function getPpdTone(ppd?: number | null): PpdTone {
  if (ppd === undefined || ppd === null || Number.isNaN(ppd)) return 'unknown';
  if (ppd >= PPD_THRESHOLD_HIGH) return 'high';
  if (ppd >= PPD_THRESHOLD_MID) return 'mid';
  return 'low';
}

export const PPD_TONE_CLASS: Record<PpdTone, { dot: string; text: string; soft: string }> = {
  high: { dot: 'bg-[#d92d20]', text: 'text-danger-text', soft: 'bg-[rgba(217,45,32,0.10)]' },
  mid: { dot: 'bg-[#b54708]', text: 'text-warn-text', soft: 'bg-[rgba(181,71,8,0.10)]' },
  low: { dot: 'bg-[#12805c]', text: 'text-[#12805c]', soft: 'bg-[rgba(18,128,92,0.10)]' },
  unknown: { dot: 'bg-[#c8ccd2]', text: 'text-muted', soft: 'bg-[rgba(104,112,118,0.10)]' }
};

export function ppdToneClass(ppd?: number | null, key: 'dot' | 'text' | 'soft' = 'dot'): string {
  return PPD_TONE_CLASS[getPpdTone(ppd)][key];
}
