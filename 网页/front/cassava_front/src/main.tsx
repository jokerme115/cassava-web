import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './styles/glass-antd.css';
import './styles/typography.css';
import './i18n.ts';
import { applyTypography } from './theme/typography';

applyTypography();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
