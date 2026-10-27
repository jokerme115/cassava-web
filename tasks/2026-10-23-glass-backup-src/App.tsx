import { ConfigProvider } from 'antd';
import { BrowserRouter } from 'react-router-dom';
import CassavaApp from './components/CassavaApp';

/**
 * antd 主题：把浮层底色从纯白改为玻璃半透明，
 * 这样 Modal / Dropdown / Select / Table 与自定义的 .glass-panel 才是同一套质感。
 * hashed: false 让 token 以稳定类名（cssVar）输出，便于 glass-antd.css 做精确覆盖。
 */
const glassTheme = {
  cssVar: true as const,
  hashed: false,
  token: {
    colorBgContainer: 'rgba(255,255,255,0.62)',
    colorBgElevated: 'rgba(255,255,255,0.82)',
    colorBorder: 'rgba(255,255,255,0.72)',
    borderRadiusLG: 20,
    boxShadow: '0 20px 60px rgba(15,23,42,0.08)',
  },
  components: {
    Modal: { contentBg: 'rgba(255,255,255,0.82)', headerBg: 'transparent' },
    Table: { headerBg: 'rgba(255,255,255,0.55)', rowHoverBg: 'rgba(255,255,255,0.45)' },
    Dropdown: { colorBgElevated: 'rgba(255,255,255,0.82)' },
    Select: { selectorBg: 'rgba(255,255,255,0.62)' },
  },
};

function App() {
  return (
    <ConfigProvider theme={glassTheme}>
      <BrowserRouter>
        <CassavaApp />
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
