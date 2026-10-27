import { ConfigProvider, App as AntdApp } from 'antd';
import type { ReactNode } from 'react';
import { colors, overlays, radius, shadows, fontFamily } from './tokens';

/**
 * antd 主题：与站内卡片体系一致（HeroUI 口径）。
 * - 浮层统一纯白实底 + 1px 发丝描边 + 极淡投影，不再用半透明/毛玻璃
 * - 颜色一律从 theme/tokens 取，禁止在本文件写十六进制
 * - colorPrimary 用 brandFill(#0070e0) 而非 accent(#0a84ff)：后者白字对比仅 3.65，撑不住按钮文字
 * - hashed: false 让 token 以稳定类名（cssVar）输出，便于 styles/ 下样式精确覆盖
 *
 * 这个文件被 CassavaApp 用 lazy() 加载，目的只有一个：首屏（首页/登录/联系我们）
 * 不import antd。antd + rc-* 打包出来约 285 kB gzip，占首屏 JS 的 2/3。
 */
export const heroTheme = {
  cssVar: true as const,
  hashed: false,
  token: {
    colorPrimary: colors.brandFill,
    colorSuccess: colors.ok,
    colorWarning: colors.warn,
    colorError: colors.danger,
    colorText: colors.ink,
    colorTextSecondary: colors.muted,
    colorTextTertiary: colors.mutedLight,
    colorBorder: colors.hairline,
    colorBorderSecondary: colors.surfaceSunken,
    colorBgContainer: colors.surface,
    colorBgElevated: colors.surface,
    colorBgLayout: colors.surfaceMuted,
    colorFillAlter: colors.surfaceMuted,
    borderRadius: radius.md,
    borderRadiusLG: radius.xl,
    borderRadiusSM: radius.sm,
    controlHeight: 38,
    fontFamily,
    boxShadow: shadows.card,
    boxShadowSecondary: shadows.float,
  },
  components: {
    Modal: {
      contentBg: colors.surface,
      headerBg: 'transparent',
      titleFontSize: 17,
    },
    Table: {
      headerBg: colors.surfaceMuted,
      headerColor: colors.muted,
      rowHoverBg: '#fafafc',
      borderColor: colors.surfaceSunken,
    },
    Dropdown: { colorBgElevated: colors.surface },
    Select: { selectorBg: colors.surface, optionSelectedBg: overlays.accent10 },
    Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500 },
    Input: { activeShadow: `0 0 0 3px ${overlays.accent10}` },
    Tooltip: { colorBgSpotlight: colors.ink },
    Message: { contentBg: colors.surface },
    Pagination: { itemActiveBg: overlays.accent08 },
  },
};

export default function AntdThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider theme={heroTheme}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
