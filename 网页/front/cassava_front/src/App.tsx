import { BrowserRouter } from 'react-router-dom';
import CassavaApp from './components/CassavaApp';

/**
 * 注意：这里刻意不 import antd。
 * antd（含 rc-*）打包约 285 kB gzip，是首屏 JS 的大头；主题提供者
 * 放在 theme/AntdThemeProvider.tsx，由 CassavaApp 用 lazy() 挂载，
 * 首页 / 登录 / 联系我们这些不用 antd 的路由就不会加载它。
 */
function App() {
  return (
    <BrowserRouter>
      <CassavaApp />
    </BrowserRouter>
  );
}

export default App;
