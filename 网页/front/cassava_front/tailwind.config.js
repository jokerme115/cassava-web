import colors from 'tailwindcss/colors';
import typography from './src/theme/typography.json';

const typeRole = role => [`${typography.sizes[role]}px`, { lineHeight: `${typography.lineHeights[role]}px` }];

/**
 * 全站视觉基线：HeroUI 口径（柔和现代 · 单一强调色 · 实底卡片）。
 *
 * 设计约束：
 * - 页面底是纯色 #f7f6f0，卡片是纯白实底 + 1px 发丝描边 + 极淡投影；
 * - 强调色只有一支：#3d8060 做图标/描边/装饰，#245c45（--brand-fill/--brand-text）做底与文字；
 * - 语义色沿用 status 口径：绿=完成、蓝=进行中、橙=等待/警告、红=失败/危险；
 * - 色阶仍由系统色按固定比例生成，保证同一色相内明度一致，避免脏色。
 *
 * 历史说明：本文件曾以「iOS 26 Liquid Glass 磨砂玻璃」为基线（glass 半透明白、
 * 28px 模糊、28px 圆角、玻璃投影）。全站已切到实底卡片，glass 系列类名在本仓库
 * 已无消费者，故移除，避免新代码再写回去。色阶生成保留——历史页面大量使用
 * text-blue-600 / bg-green-50 这类既有类名，重新映射到系统色才能保持观感一致。
 */

/** 以 iOS 系统色为 500，生成 50→950 的完整色阶。 */
const ramp = (base, dark = '#000000', light = '#ffffff') => {
  const hexToRgb = (hex) => {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const mix = (from, to, weight) => {
    const a = hexToRgb(from);
    const b = hexToRgb(to);
    const out = a.map((v, i) => Math.round(v + (b[i] - v) * weight));
    return `rgb(${out[0]} ${out[1]} ${out[2]})`;
  };
  return {
    50: mix(base, light, 0.92),
    100: mix(base, light, 0.84),
    200: mix(base, light, 0.68),
    300: mix(base, light, 0.48),
    400: mix(base, light, 0.24),
    500: base,
    600: mix(base, dark, 0.16),
    700: mix(base, dark, 0.32),
    800: mix(base, dark, 0.46),
    900: mix(base, dark, 0.58),
    950: mix(base, dark, 0.72),
  };
};

const iosBlue = ramp('#3d8060');
const iosGreen = ramp('#34c759');
const iosOrange = ramp('#ff9500');
const iosRed = ramp('#ff3b30');
const iosPurple = ramp('#af52de');
const iosPink = ramp('#ff2d55');
const iosTeal = ramp('#30b0c7');
const iosIndigo = ramp('#5856d6');
const iosYellow = ramp('#ffcc00');

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    fontFamily: { sans: [typography.fontFamily], serif: [typography.fontFamily] },
    fontSize: {
      xs: typeRole('caption'), sm: typeRole('control'), base: typeRole('body'),
      lg: typeRole('panel'), xl: typeRole('panel'), '2xl': typeRole('page'),
      '3xl': typeRole('metric'), '4xl': typeRole('metric'), '5xl': typeRole('hero'),
      '6xl': typeRole('hero'), '7xl': typeRole('hero'), '8xl': typeRole('hero'), '9xl': typeRole('hero'),
    },
    fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '600', extrabold: '600', black: '600' },
    extend: {
      // 补 480px 断点：原代码里已有 8 处 xs: 前缀，未定义会被 Tailwind 直接丢弃
      screens: {
        xs: '480px',
      },
      colors: {
        // iOS 系统色板：同名色族全部归一到同一系统色，历史代码不用改也能协调
        blue: iosBlue,
        sky: iosBlue,
        cyan: iosTeal,
        teal: iosTeal,
        green: iosGreen,
        emerald: iosGreen,
        lime: iosGreen,
        amber: iosOrange,
        yellow: iosYellow,
        orange: iosOrange,
        red: iosRed,
        rose: iosRed,
        pink: iosPink,
        fuchsia: iosPink,
        purple: iosPurple,
        violet: iosPurple,
        indigo: iosIndigo,

        // 语义别名，新代码建议直接用这几个
        accent: iosBlue,
        success: iosGreen,
        warning: iosOrange,
        danger: iosRed,

        // 实底主色（白字按钮/选中填充，白底 4.78 达标）
        'brand-fill': '#245c45',
        'brand-fill-hover': '#173e31',
        // 文字档语义色（白底对比 ≥4.5:1，可承载正文）
        'accent-text': '#245c45',
        // 描边/焦点环/装饰档（不承载正文，对应 --accent）
        'accent-line': '#3d8060',
        'success-text': '#12805c',
        'warning-text': '#b54708',
        'danger-text': '#d92d20',
        // 浅粉底（rgba(243,18,96,0.08) 叠白）上仍 ≥4.5 的深一档
        'danger-strong': '#b3122f',

        // 中性面：与 index.css 的 CSS 变量一一对应，方便在 className 里直接用
        ink: '#20392e',
        'ink-secondary': '#48584e',
        muted: '#68756b',
        'muted-light': '#8b9199',
        surface: '#ffffff',
        'surface-muted': '#f7f6f0',
        'surface-sunken': '#eeefe7',
        hairline: '#e3e7dd',
        'hairline-strong': '#d5ddcf',
      },
      boxShadow: {
        // 普通卡片一层极淡投影；只有浮层才用大投影（与 --shadow-card/--shadow-float 对齐）
        card: '0 4px 16px rgba(17, 24, 28, 0.05)',
        float: '0 18px 44px rgba(17, 17, 26, 0.09), 0 0 0 1px rgba(17, 17, 26, 0.03)',
      },
      borderRadius: {
        // 与 index.css 的 --radius-* 对齐
        hero: '24px',
        xl: '16px',
        md: '12px',
        sm: '10px',
        pill: '999px',
      },
    },
  },
  plugins: [],
};
