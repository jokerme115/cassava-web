import { setWorkspaceUser } from '../utils/workspaceContext';
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopNavigation from './TopNavigation';
import { systemSettingsApi } from '../services/api';
import { SystemSetting } from '../types';
import { getAuthToken, clearAuthToken } from '../utils/authToken';
import { loadGuestSession, clearGuestSession } from '../utils/guestSession';
import { useLocation, useNavigate } from 'react-router-dom';

const AntdThemeProvider = lazy(() => import('../theme/AntdThemeProvider'));
const HomePage = lazy(() => import('./HomePage'));
const ImageManagement = lazy(() => import('./ImageManagement'));
const PredictionModule = lazy(() => import('./PredictionModule'));
const TaskCenter = lazy(() => import('./TaskCenter'));
const ResultsCenter = lazy(() => import('./ResultsCenter'));
const ContactUs = lazy(() => import('./ContactUs'));
const LoginPage = lazy(() => import('./LoginPage'));
const PermissionManagement = lazy(() => import('./PermissionManagement'));
const AuditLogs = lazy(() => import('./AuditLogs'));
const UserProfile = lazy(() => import('./UserProfile'));
// 风格样板页：只做视觉对比，不接入导航、不触碰主流程

const KNOWN_SECTIONS = new Set([
  'home', 'images', 'prediction', 'tasks', 'results', 'contact',
  'login', 'register', 'profile', 'permissions', 'audit'
]);

// 页面由网址决定：/ 为首页，/prediction 等为对应页面；未知网址按首页处理
const sectionFromPath = (pathname: string): string => {
  const segment = pathname.split('/').filter(Boolean)[0] ?? '';
  return KNOWN_SECTIONS.has(segment) ? segment : 'home';
};

/** 是否为站点里不存在的路径（用于显示 404 页面而不是静默回落到首页） */
const isUnknownPathname = (pathname: string): boolean => {
  const segment = pathname.split('/').filter(Boolean)[0] ?? '';
  if (!segment) return false;
  return !KNOWN_SECTIONS.has(segment);
};

const pathFromSection = (section: string): string => (section === 'home' ? '/' : `/${section}`);

const CassavaApp: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const activeSection = sectionFromPath(location.pathname);
  const isUnknownPath = isUnknownPathname(location.pathname);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [systemSettings, setSystemSettings] = useState<Partial<SystemSetting>>({});
  const [pendingSection, setPendingSection] = useState<string | null>(null);
  const { t } = useTranslation();
  const activeSectionRef = useRef(activeSection);
  // 标记“刚刚完成登录”的时间戳，避免登录后回跳原页面的动作被“已登录不该停在 /login”的守卫覆盖
  const justLoggedInRef = useRef(0);

  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  const publicSections = useMemo(() => new Set(['home', 'contact', 'login']), []);

  const getCookie = (name: string): string | null => {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
      const cookies = document.cookie.split(';');
      for (let i = 0; i < cookies.length; i += 1) {
        const cookie = cookies[i].trim();
        if (cookie.substring(0, name.length + 1) === `${name}=`) {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
  };

  const handleSectionChange = (section: string) => {
    if (!currentUser && !publicSections.has(section)) {
      setPendingSection(section);
      navigate('/login');
      return;
    }

    if (section !== 'login') {
      setPendingSection(null);
    }

    navigate(pathFromSection(section));
  };

  // 直接输入网址访问需要登录的页面时，先登录，登录后回到该页面
  useEffect(() => {
    if (loading || currentUser || publicSections.has(activeSection)) return;
    setPendingSection(activeSection);
    navigate('/login', { replace: true });
  }, [loading, currentUser, activeSection, navigate, publicSections]);

  // 访客入口被管理员关闭后，已经持有旧访客身份的浏览器也要失效
  useEffect(() => {
    if (loading || !currentUser?.is_guest) return;
    if (systemSettings.enable_guest_access !== false) return;
    clearGuestSession();
    setWorkspaceUser(); setCurrentUser(null);
    setPendingSection(null);
    navigate('/login', { replace: true });
  }, [loading, currentUser, systemSettings.enable_guest_access, navigate]);

  // 已登录用户访问登录页时回到首页，避免出现“已登录却停在登录页”
  // 刚完成登录（handleLogin）时不介入，否则会盖掉“登录后回到原页面”的跳转
  useEffect(() => {
    if (loading || !currentUser || activeSection !== 'login') return;
    // 刚完成登录（2 秒内）时让 handleLogin 自己的跳转生效，不抢去首页
    if (Date.now() - justLoggedInRef.current < 2000) return;
    navigate('/', { replace: true });
  }, [loading, currentUser, activeSection, navigate]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await systemSettingsApi.getPublic();
        setSystemSettings(settings);

        if (settings.site_title) {
          document.title = settings.site_title;
        }
      } catch (error) {
        console.error('Failed to load public settings', error);
      }
    };

    loadSettings();

    const handleSettingsUpdate = () => loadSettings();
    window.addEventListener('systemSettings:updated', handleSettingsUpdate);

    return () => {
      window.removeEventListener('systemSettings:updated', handleSettingsUpdate);
    };
  }, []);

  useEffect(() => {
    const checkLoginStatus = async () => {
      try {
        const token = getAuthToken();
        if (!token) {
          // 没有登录 token 时，尝试恢复本地保存的访客会话（刷新页面不丢访客身份）
          setCurrentUser(loadGuestSession());
          return;
        }

        const response = await fetch('/api/auth/user/', {
          headers: {
            Authorization: `Token ${token}`
          },
          credentials: 'include'
        });

        if (response.status === 401) {
          clearAuthToken();
          setWorkspaceUser(); setCurrentUser(null);
          return;
        }

        const data = await response.json();
        if (data.id) {
          setWorkspaceUser(data?.id); setCurrentUser(data);
        } else {
          setWorkspaceUser(); setCurrentUser(null);
        }
      } catch (error) {
        console.error('Failed to check login status:', error);
      } finally {
        setLoading(false);
      }
    };

    checkLoginStatus();

    const handleAuthExpired = () => {
      // 会话过期后记住当前页面，重新登录后回到原页
      const current = activeSectionRef.current;
      setWorkspaceUser(); setCurrentUser(null);
      setPendingSection(!publicSections.has(current) ? current : null);
      navigate('/login');
    };

    window.addEventListener('auth:expired', handleAuthExpired);

    return () => {
      window.removeEventListener('auth:expired', handleAuthExpired);
    };
  }, []);

  const handleLogin = (user: any) => {
    justLoggedInRef.current = Date.now();
    setWorkspaceUser(user?.id); setCurrentUser(user);
    const targetSection =
      pendingSection && !publicSections.has(pendingSection) ? pendingSection : 'home';
    setPendingSection(null);
    navigate(pathFromSection(targetSection));
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout/', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRFToken': getCookie('csrftoken') || ''
        }
      });
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      clearAuthToken();
      clearGuestSession();
      setWorkspaceUser(); setCurrentUser(null);
      setPendingSection(null);
      navigate('/');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-hairline border-t-accent-line" />
          <p className="text-sm text-muted">{t('common.loading') || 'Loading...'}</p>
        </div>
      </div>
    );
  }

  // 维护模式下放行登录页；否则非管理员无法登录，管理员登录按钮也会失效
  if (systemSettings.maintenance_mode && !currentUser?.is_superuser && activeSection !== 'login') {
    return (
      <div className="min-h-screen px-4 py-10">
        <div className="mx-auto flex min-h-[80vh] max-w-3xl items-center justify-center">
          <div className="card-float w-full rounded-[24px] p-8 sm:p-10">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(245,165,36,0.18)] text-warn-text">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="mb-3 text-2xl font-semibold tracking-normal text-ink">
              {t('system.maintenance_mode')}
            </h2>
            <p className="mb-8 max-w-xl text-base leading-7 text-ink-secondary">
              {t('system.maintenance_message') ||
                'The system is currently undergoing maintenance. Please try again later.'}
            </p>
            {currentUser ? (
              <button
                onClick={handleLogout}
                className="inline-flex h-11 items-center justify-center rounded-full border border-hairline-strong px-5 text-sm font-medium text-ink-secondary transition hover:border-slate-400 hover:bg-white"
              >
                {t('navigation.logout')}
              </button>
            ) : (
              <button
                onClick={() => handleSectionChange('login')}
                className="inline-flex h-11 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                {t('login.admin_login') || 'Admin Login'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const renderDenied = () => (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="rounded-[16px] border border-[rgba(243,18,96,0.24)] bg-white p-8 shadow-[0_10px_30px_rgba(17,17,26,0.045)]">
        <h3 className="text-xl font-semibold text-danger-text">{t('permissions.access_denied')}</h3>
        <p className="mt-3 text-sm leading-7 text-ink-secondary">
          {t('permissions.access_denied_desc') || t('permissions.guest_restricted')}
        </p>
      </div>
    </div>
  );

  const renderNotFound = (pathname: string) => (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <div className="rounded-[16px] card p-10 text-center shadow-[0_10px_30px_rgba(17,17,26,0.045)]">
        <p className="text-5xl font-semibold tracking-normal text-muted">404</p>
        <h3 className="mt-4 text-xl font-semibold text-ink">{t('not_found.title')}</h3>
        <p className="mt-3 text-sm leading-7 text-ink-secondary">{t('not_found.desc')}</p>
        <p className="mt-2 break-all text-xs text-muted">{pathname}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="inline-flex h-11 items-center justify-center rounded-full bg-brand-fill px-5 text-sm font-medium text-white transition hover:bg-brand-fill-hover"
          >
            {t('not_found.back_home')}
          </button>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex h-11 items-center justify-center rounded-full border border-hairline-strong px-5 text-sm font-medium text-ink-secondary transition hover:bg-white"
          >
            {t('not_found.back_prev')}
          </button>
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    if (isUnknownPath) {
      return renderNotFound(location.pathname);
    }

    if (activeSection === 'login') {
      return (
        <LoginPage
          onLogin={handleLogin}
          onNavigate={handleSectionChange}
          systemSettings={systemSettings}
        />
      );
    }

    if (activeSection === 'register') {
      return (
        <div className="min-h-[70vh] bg-surface-muted px-4 py-10">
          <div className="mx-auto max-w-xl rounded-xl border border-hairline bg-white p-8 text-center shadow-card">
            <h2 className="text-xl font-semibold text-ink">
              {t('register.registration_closed')}
            </h2>
            <p className="mt-3 text-sm leading-7 text-ink-secondary">
              {t('register.registration_closed_desc')}
            </p>
            <button
              onClick={() => handleSectionChange('login')}
              className="mt-6 inline-flex h-11 items-center justify-center rounded-full border border-accent-line px-5 text-sm font-medium text-accent-text transition hover:bg-[rgba(10,132,255,0.08)]"
            >
              {t('login.back_to_login')}
            </button>
          </div>
        </div>
      );
    }

    if (currentUser?.is_guest && ['permissions', 'audit', 'users', 'profile'].includes(activeSection)) {
      return renderDenied();
    }

    if (activeSection === 'permissions') {
      const isAdmin = currentUser?.role_names?.includes('Admin');
      if (currentUser?.is_superuser || isAdmin) {
        return <PermissionManagement />;
      }
      return renderDenied();
    }

    if (activeSection === 'audit') {
      if (!currentUser?.is_superuser) {
        return renderDenied();
      }
      return <AuditLogs />;
    }

    switch (activeSection) {
      case 'home':
        return <HomePage onSectionChange={handleSectionChange} />;
      case 'images':
        return <ImageManagement currentUser={currentUser} />;
      case 'prediction':
        return <PredictionModule currentUser={currentUser} />;
      case 'tasks':
        return <TaskCenter currentUser={currentUser} />;
      case 'results':
        return <ResultsCenter currentUser={currentUser} />;
      case 'contact':
        return <ContactUs />;
      case 'profile':
        return (
          <UserProfile
            currentUser={currentUser}
            onLogout={handleLogout}
            onUpdateUser={setCurrentUser}
          />
        );
      default:
        return <HomePage onSectionChange={handleSectionChange} />;
    }
  };

  // 首页/联系我们/登录/注册不引用 antd，套主题提供者会把 antd（含 rc-*，约 285 kB gzip）
  // 一起拉进首屏；其余路由（图片、预测、结果、任务、权限、个人中心）需要它。
  const needsAntd = !['home', 'contact', 'login', 'register'].includes(activeSection);
  const pageShell = (
    <div
      className="flex h-[calc(100vh-95px)] min-h-0 flex-col overflow-x-hidden"
      role="region"
      aria-label={t('a11y.main_region')}
      tabIndex={0}
    >
      {renderContent()}
    </div>
  );

  return (
    <div className="min-h-screen text-ink">
      <TopNavigation
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        currentUser={currentUser}
        onLogout={handleLogout}
        siteTitle={systemSettings.site_title}
      />
      <Suspense
        fallback={
          <div className="flex min-h-[70vh] items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="h-12 w-12 animate-spin rounded-full border-2 border-hairline border-t-accent-line" />
              <p className="text-sm text-muted">{t('common.loading') || 'Loading...'}</p>
            </div>
          </div>
        }
      >
        {needsAntd ? <AntdThemeProvider>{pageShell}</AntdThemeProvider> : pageShell}
      </Suspense>
    </div>
  );
};

export default CassavaApp;
