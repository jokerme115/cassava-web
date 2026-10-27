import { ConfigProvider } from 'antd';
import { BrowserRouter } from 'react-router-dom';
import CassavaApp from './components/CassavaApp';

/**
 * antd 主题：与站内卡片体系一致（HeroUI 口径）。
 * - 浮层统一纯白实底 + 1px 发丝描边 + 极淡投影，不再用半透明/毛玻璃
 * - 强调色只有 #0a84ff 一支；圆角沿用 24/20/14 三档
 * - hashed: false 让 token 以稳定类名（cssVar）输出，便于 styles/glass-antd.css 精确覆盖
 */
const heroTheme = {
  cssVar: true as const,
  hashed: false,
  token: {
    colorPrimary: '#0a84ff',
    colorSuccess: '#17c964',
    colorWarning: '#f5a524',
    colorError: '#f31260',
    colorText: '#11181c',
    colorTextSecondary: '#687076',
    colorTextTertiary: '#8b9199',
    colorBorder: '#ededf2',
    colorBorderSecondary: '#f2f3f6',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f7f8fa',
    colorFillAlter: '#f7f8fa',
    borderRadius: 14,
    borderRadiusLG: 20,
    borderRadiusSM: 10,
    controlHeight: 38,
    fontFamily:
      '"SF Pro Text", -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    boxShadow: '0 18px 44px rgba(17,17,26,0.10)',
    boxShadowSecondary: '0 10px 30px rgba(17,17,26,0.06)',
  },
  components: {
    Modal: {
      contentBg: '#ffffff',
      headerBg: 'transparent',
      titleFontSize: 17,
    },
    Table: {
      headerBg: '#f7f8fa',
      headerColor: '#687076',
      rowHoverBg: '#fafafc',
      borderColor: '#f2f3f6',
    },
    Dropdown: { colorBgElevated: '#ffffff' },
    Select: { selectorBg: '#ffffff', optionSelectedBg: 'rgba(10,132,255,0.10)' },
    Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500 },
    Input: { activeShadow: '0 0 0 3px rgba(10,132,255,0.10)' },
    Tooltip: { colorBgSpotlight: '#11181c' },
    Message: { contentBg: '#ffffff' },
    Pagination: { itemActiveBg: 'rgba(10,132,255,0.08)' },
  },
};

function App() {
  return (
    <ConfigProvider theme={heroTheme}>
      <BrowserRouter>
        <CassavaApp />
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
