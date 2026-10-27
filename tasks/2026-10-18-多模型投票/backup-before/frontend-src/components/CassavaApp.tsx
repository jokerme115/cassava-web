import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopNavigation from './TopNavigation';
import { systemSettingsApi } from '../services/api';
import { SystemSetting } from '../types';

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

const CassavaApp: React.FC = () => {
  const [activeSection, setActiveSection] = useState('home');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [systemSettings, setSystemSettings] = useState<Partial<SystemSetting>>({});
  const [pendingSection, setPendingSection] = useState<string | null>(null);
  const { t } = useTranslation();

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
      setActiveSection('login');
      return;
    }

    if (section !== 'login') {
      setPendingSection(null);
    }

    setActiveSection(section);
  };

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
        const token = localStorage.getItem('authToken');
        if (!token) {
          setCurrentUser(null);
          return;
        }

        const response = await fetch('/api/auth/user/', {
          headers: {
            Authorization: `Token ${token}`
          },
          credentials: 'include'
        });

        if (response.status === 401) {
          localStorage.removeItem('authToken');
          setCurrentUser(null);
          return;
        }

        const data = await response.json();
        if (data.id) {
          setCurrentUser(data);
        } else {
          setCurrentUser(null);
        }
      } catch (error) {
        console.error('Failed to check login status:', error);
      } finally {
        setLoading(false);
      }
    };

    checkLoginStatus();

    const handleAuthExpired = () => {
      setCurrentUser(null);
      setPendingSection(null);
      setActiveSection('login');
    };

    window.addEventListener('auth:expired', handleAuthExpired);

    return () => {
      window.removeEventListener('auth:expired', handleAuthExpired);
    };
  }, []);

  const handleLogin = (user: any) => {
    setCurrentUser(user);
    const targetSection =
      pendingSection && !publicSections.has(pendingSection) ? pendingSection : 'home';
    setPendingSection(null);
    setActiveSection(targetSection);
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
      localStorage.removeItem('authToken');
      setCurrentUser(null);
      setPendingSection(null);
      setActiveSection('home');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(17,94,89,0.12),_transparent_42%),linear-gradient(180deg,#f7faf9_0%,#eef3f1_100%)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-700" />
          <p className="text-sm text-slate-500">{t('common.loading') || 'Loading...'}</p>
        </div>
      </div>
    );
  }

  if (systemSettings.maintenance_mode && !currentUser?.is_superuser) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(180,83,9,0.12),_transparent_40%),linear-gradient(180deg,#f9f8f4_0%,#f2f0ea_100%)] px-4 py-10">
        <div className="mx-auto flex min-h-[80vh] max-w-3xl items-center justify-center">
          <div className="w-full rounded-[32px] border border-amber-200/70 bg-white/90 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-10">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="mb-3 text-3xl font-semibold tracking-tight text-slate-900">
              {t('system.maintenance_mode')}
            </h2>
            <p className="mb-8 max-w-xl text-base leading-7 text-slate-600">
              {t('system.maintenance_message') ||
                'The system is currently undergoing maintenance. Please try again later.'}
            </p>
            {currentUser ? (
              <button
                onClick={handleLogout}
                className="inline-flex h-11 items-center justify-center rounded-full border border-slate-300 px-5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
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
      <div className="rounded-[28px] border border-rose-200 bg-white p-8 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
        <h3 className="text-xl font-semibold text-rose-700">{t('permissions.access_denied')}</h3>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          {t('permissions.access_denied_desc') || t('permissions.guest_restricted')}
        </p>
      </div>
    </div>
  );

  const renderContent = () => {
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
        <div className="min-h-[70vh] bg-slate-50 px-4 py-10">
          <div className="mx-auto max-w-xl rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.06)]">
            <h3 className="text-2xl font-semibold text-slate-900">
              {t('register.registration_closed')}
            </h3>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              {t('register.registration_closed_desc')}
            </p>
            <button
              onClick={() => handleSectionChange('login')}
              className="mt-6 inline-flex h-11 items-center justify-center rounded-full border border-emerald-700 px-5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50"
            >
              {t('login.back_to_login')}
            </button>
          </div>
        </div>
      );
    }

    if (currentUser?.is_guest && ['permissions', 'audit', 'users'].includes(activeSection)) {
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
        return <PredictionModule />;
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

  return (
    <div className="min-h-screen bg-[#f5f7f4] text-slate-900">
      <TopNavigation
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        currentUser={currentUser}
        onLogout={handleLogout}
        siteTitle={systemSettings.site_title}
      />
      <Suspense
        fallback={
          <div className="min-h-[70vh] bg-[radial-gradient(circle_at_top,_rgba(17,94,89,0.12),_transparent_42%),linear-gradient(180deg,#f7faf9_0%,#eef3f1_100%)] flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="h-12 w-12 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-700" />
              <p className="text-sm text-slate-500">{t('common.loading') || 'Loading...'}</p>
            </div>
          </div>
        }
      >
        <div className="overflow-x-hidden">{renderContent()}</div>
      </Suspense>
    </div>
  );
};

export default CassavaApp;
