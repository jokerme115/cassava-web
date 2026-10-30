import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
import { useLayoutEffect, type ReactNode } from 'react';
import { bindFeedback } from '../utils/feedback';
import { colors, overlays, radius, shadows, fontFamily, typography } from './tokens';

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
    fontSize: typography.sizes.control,
    fontSizeSM: typography.sizes.caption,
    fontSizeLG: typography.sizes.body,
    fontSizeHeading1: typography.sizes.page,
    fontSizeHeading2: typography.sizes.page,
    fontSizeHeading3: typography.sizes.panel,
    fontSizeHeading4: typography.sizes.panel,
    fontSizeHeading5: typography.sizes.body,
    lineHeight: typography.lineHeights.control / typography.sizes.control,
    controlHeightSM: 30,
    boxShadow: shadows.card,
    boxShadowSecondary: shadows.float,
  },
  components: {
    Drawer: { fontSizeLG: typography.sizes.panel },
    Card: { headerFontSize: typography.sizes.panel, headerFontSizeSM: typography.sizes.panel },
    Modal: {
      contentBg: colors.surface,
      headerBg: 'transparent',
      titleFontSize: typography.sizes.panel,
    },
    Table: {
      headerBg: colors.surfaceMuted,
      headerColor: colors.muted,
      rowHoverBg: '#fafafc',
      borderColor: colors.surfaceSunken,
    },
    Dropdown: { colorBgElevated: colors.surface },
    Select: { selectorBg: colors.surface, optionSelectedBg: overlays.accent10 },
    Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500, contentFontSize: typography.sizes.control, contentFontSizeSM: typography.sizes.control },
    Input: { activeShadow: `0 0 0 3px ${overlays.accent10}` },
    Tooltip: { colorBgSpotlight: colors.ink },
    Message: { contentBg: colors.surface },
    Pagination: { itemActiveBg: overlays.accent08 },
  },
};

export default function AntdThemeProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  return (
    <ConfigProvider theme={heroTheme} locale={i18n.language.startsWith('zh') ? zhCN : enUS}>
      <AntdApp><FeedbackBridge />{children}</AntdApp>
    </ConfigProvider>
  );
}

function FeedbackBridge() {
  const api = AntdApp.useApp();
  useLayoutEffect(() => bindFeedback(api), [api]);
  return null;
}
