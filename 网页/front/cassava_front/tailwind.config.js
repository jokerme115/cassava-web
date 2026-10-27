import colors from 'tailwindcss/colors';

/**
 * 全站视觉基线：iOS 26「Liquid Glass」取向的磨砂玻璃体系。
 *
 * 设计约束：
 * - 底色是带极淡冷色渐变的雾面白，卡片是半透明白 + 大半径模糊 + 内高光；
 * - 品牌/强调色采用 iOS 系统色（蓝 #0A84FF 为主），不再使用纯黑白；
 * - 语义色沿用 iOS 习惯：绿=完成、蓝=进行中、橙=等待/警告、红=失败/危险；
 * - 所有色阶由系统色按固定比例调配，保证同一色相内明度一致，避免出现脏色。
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

const iosBlue = ramp('#0a84ff');
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

        // 玻璃层叠用到的半透明白/雾面灰
        glass: {
          DEFAULT: 'rgba(255, 255, 255, 0.62)',
          soft: 'rgba(255, 255, 255, 0.44)',
          strong: 'rgba(255, 255, 255, 0.82)',
          line: 'rgba(255, 255, 255, 0.72)',
        },
      },
      boxShadow: {
        glass: '0 20px 60px rgba(15, 23, 42, 0.06)',
        'glass-lg': '0 30px 120px rgba(15, 23, 42, 0.12)',
        'glass-inset': 'inset 0 1px 0 rgba(255,255,255,0.9)',
        float: '0 12px 40px rgba(15, 23, 42, 0.08), 0 2px 8px rgba(15, 23, 42, 0.04)',
      },
      borderRadius: {
        glass: '28px',
      },
      backdropBlur: {
        glass: '28px',
      },
      backgroundImage: {
        'glass-sheen':
          'linear-gradient(135deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.36) 42%, rgba(255,255,255,0.58) 100%)',
      },
    },
  },
  plugins: [],
};
