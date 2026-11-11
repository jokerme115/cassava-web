/**
 * 设计 token 的 JS 侧镜像（唯一一份）。
 *
 * 为什么需要它：antd 的 ConfigProvider 只接受具体颜色字符串，无法读 CSS 变量，
 * 所以同一批颜色在 JS 里必须有一份可引用的常量。改色时两处同步：
 *   1) src/index.css 的 :root 变量（CSS 用）
 *   2) 本文件（antd 主题、内联 style 用）
 * 除此之外不得在业务代码里直接写十六进制色值。
 *
 * 对比度（白底 WCAG）：
 *   brandFill #245c45 = 4.78 ✅（可承载正文/按钮文字）
 *   accent    #3d8060 = 3.65 ❌（仅作描边、焦点环、图标装饰）
 */

export const colors = {
  /** 实底主色：白字按钮、选中态填充 */
  brandFill: '#245c45',
  brandFillHover: '#173e31',
  /** 文字档主色：白底可读的链接/强调文字 */
  brandText: '#245c45',
  /** 装饰档强调色：描边、焦点环、图表，不承载正文 */
  accent: '#3d8060',

  ok: '#17c964',
  okText: '#12805c',
  warn: '#f5a524',
  warnText: '#b54708',
  danger: '#f31260',
  dangerText: '#d92d20',

  ink: '#20392e',
  inkSecondary: '#48584e',
  muted: '#68756b',
  mutedLight: '#8b9199',

  surface: '#ffffff',
  surfaceMuted: '#f7f6f0',
  surfaceSunken: '#eeefe7',
  hairline: '#e3e7dd',
  hairlineStrong: '#d5ddcf',
} as const;

/** 主色的半透明覆盖层（选中背景、输入框光晕等） */
export const overlays = {
  accent10: 'rgba(61,128,96,0.10)',
  accent08: 'rgba(61,128,96,0.08)',
} as const;

export const radius = {
  hero: 24,
  xl: 16,
  md: 12,
  sm: 10,
  pill: 999,
} as const;

export const shadows = {
  card: '0 18px 44px rgba(17,17,26,0.10)',
  float: '0 10px 30px rgba(17,17,26,0.06)',
} as const;

export { typography } from './typography';
import { typography } from './typography';
export const fontFamily = typography.fontFamily;
