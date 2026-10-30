import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Brain,
  ChevronDown,
  Languages,
  LogOut,
  Menu,
  User,
  X
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface TopNavigationProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  currentUser?: any;
  onLogout?: () => void;
  siteTitle?: string;
}

const TopNavigation: React.FC<TopNavigationProps> = ({
  activeSection,
  onSectionChange,
  currentUser,
  onLogout,
  siteTitle
}) => {
  const { t, i18n } = useTranslation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const userRef = useRef<HTMLDivElement>(null);
  const languageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;


      if (userRef.current && !userRef.current.contains(target)) {
        setUserMenuOpen(false);
      }

      if (languageRef.current && !languageRef.current.contains(target)) {
        setLanguageMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    setLanguageMenuOpen(false);
    setMobileMenuOpen(false);
  };

  const mainItems = useMemo(
    () => [
      { id: 'home', label: t('navigation.home') },
      { id: 'images', label: t('navigation.images') },
      { id: 'contact', label: t('navigation.contact') }
    ],
    [t]
  );

  const analysisItems = useMemo(
    () => [
      { id: 'prediction', label: t('navigation.prediction'), icon: Brain },
      { id: 'tasks', label: t('navigation.tasks'), icon: Activity },
      { id: 'results', label: t('navigation.results'), icon: BarChart3 }
    ],
    [t]
  );

  const displayName = currentUser?.first_name || currentUser?.username || t('navigation.login');
  const accountLabel = currentUser?.is_guest ? t('login.guest_user') : displayName;

  const navButtonClass = (active: boolean) =>
    `inline-flex h-10 items-center rounded-full px-4 text-sm font-medium transition ${
      active
        ? 'bg-brand-fill text-white '
        : 'text-ink-secondary hover:bg-white hover:text-ink'
    }`;

  const handleNavigate = (section: string) => {
    onSectionChange(section);
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
  };

  return (
    <nav className="sticky top-0 z-40 border-b border-hairline bg-white">
      <div className="w-full px-4 sm:px-6">
        <div className="flex h-[72px] items-center justify-between gap-4">
          <button
            onClick={() => handleNavigate('home')}
            aria-label={t('navigation.home')}
            className="flex min-w-0 items-center gap-3 text-left"
          >
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl card shadow-sm">
              <img src="/assets/logo-128.webp" alt={t('system.title')} className="h-full w-full object-cover" />
            </div>
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-xs font-semibold tracking-[0.18em] text-accent-text">
                CASSAVA LAB
              </p>
              <h1 className="truncate text-base font-semibold text-ink">
                {siteTitle || t('system.title')}
              </h1>
            </div>
          </button>

          <div className="hidden items-center gap-2 lg:flex">
            {mainItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={navButtonClass(activeSection === item.id)}
              >
                {item.label}
              </button>
            ))}

            {analysisItems.map(item => <button key={item.id} onClick={() => handleNavigate(item.id)} className={navButtonClass(activeSection === item.id)}>{item.label}</button>)}
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            <div className="relative" ref={languageRef}>
              <button
                onClick={() => setLanguageMenuOpen((open) => !open)}
              aria-label={t('a11y.toggle_language')}
                className="inline-flex h-10 items-center rounded-full border border-hairline px-4 text-sm font-medium text-ink-secondary transition hover:border-hairline-strong hover:bg-white hover:text-ink"
              >
                <Languages className="mr-2 h-4 w-4" />
                {i18n.language === 'zh' ? t('common.languages.zh') : t('common.languages.en')}
                <ChevronDown className="ml-2 h-4 w-4 text-muted" />
              </button>

              {languageMenuOpen && (
                <div className="absolute right-0 top-[calc(100%+12px)] w-40 rounded-3xl card p-2 shadow-[0_4px_16px_rgba(17,24,28,0.05)]">
                  {['zh', 'en'].map((lng) => (
                    <button
                      key={lng}
                      onClick={() => changeLanguage(lng)}
                      className={`block w-full rounded-2xl px-4 py-3 text-left text-sm transition ${
                        i18n.language === lng
                          ? 'bg-brand-fill text-white'
                          : 'text-ink-secondary hover:bg-white'
                      }`}
                    >
                      {lng === 'zh' ? t('common.languages.zh') : t('common.languages.en')}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative" ref={userRef}>
              {currentUser ? (
                <>
                  <button
                    onClick={() => setUserMenuOpen((open) => !open)}
                    className="inline-flex h-10 items-center rounded-full border border-hairline px-4 text-sm font-medium text-ink-secondary transition hover:border-hairline-strong hover:bg-white"
                  >
                    <User className="mr-2 h-4 w-4" />
                    <span className="max-w-[120px] truncate">{accountLabel}</span>
                    <ChevronDown className="ml-2 h-4 w-4 text-muted" />
                  </button>

                  {userMenuOpen && (
                    <div className="absolute right-0 top-[calc(100%+12px)] w-64 rounded-3xl card p-2 shadow-[0_4px_16px_rgba(17,24,28,0.05)]">
                      <div className="rounded-2xl bg-surface-muted px-4 py-4">
                        <p className="text-sm font-semibold text-ink">{accountLabel}</p>
                        <p className="mt-1 text-xs text-muted">{currentUser.username}</p>
                      </div>
                      {!currentUser.is_guest && (
                        <button
                          onClick={() => handleNavigate('profile')}
                          className="mt-2 flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm text-ink-secondary transition hover:bg-white"
                        >
                          <User className="mr-3 h-4 w-4" />
                          {t('navigation.profile')}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          onLogout?.();
                          setUserMenuOpen(false);
                        }}
                        className="mt-1 flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm text-ink-secondary transition hover:bg-white"
                      >
                        <LogOut className="mr-3 h-4 w-4" />
                        {t('navigation.logout')}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={() => handleNavigate('login')}
                  className="inline-flex h-10 items-center rounded-full bg-brand-fill px-4 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  <User className="mr-2 h-4 w-4" />
                  {t('navigation.login')}
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <button
              onClick={() => setLanguageMenuOpen((open) => !open)}
              aria-label={t('a11y.toggle_language')}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full card text-ink-secondary"
            >
              <Languages className="h-4 w-4" />
            </button>
            <button
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-label={t('a11y.toggle_menu')}
              aria-expanded={mobileMenuOpen}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-fill text-white"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {languageMenuOpen && (
          <div className="mt-3 rounded-[16px] border border-hairline bg-white p-2 shadow-[0_10px_30px_rgba(17,17,26,0.045)] lg:hidden">
            {['zh', 'en'].map((lng) => (
              <button
                key={lng}
                onClick={() => changeLanguage(lng)}
                className={`block w-full rounded-2xl px-4 py-3 text-left text-sm transition ${
                  i18n.language === lng ? 'bg-brand-fill text-white' : 'text-ink-secondary hover:bg-white'
                }`}
              >
                {lng === 'zh' ? t('common.languages.zh') : t('common.languages.en')}
              </button>
            ))}
          </div>
        )}

        {mobileMenuOpen && (
          <div className="mt-3 rounded-[16px] border border-hairline bg-white p-4 shadow-[0_10px_30px_rgba(17,17,26,0.045)] lg:hidden">
            <div className="space-y-2">
              {mainItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item.id)}
                  className={`block w-full rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                    activeSection === item.id ? 'bg-brand-fill text-white' : 'text-ink-secondary hover:bg-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="mt-4 border-t border-hairline pt-4">
              <p className="px-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted">
                {t('navigation.analysis')}
              </p>
              <div className="mt-2 space-y-2">
                {analysisItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleNavigate(item.id)}
                    className={`flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                      activeSection === item.id
                        ? 'bg-brand-fill text-white'
                        : 'text-ink-secondary hover:bg-white'
                    }`}
                  >
                    <item.icon className="mr-3 h-4 w-4" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 border-t border-hairline pt-4">
              {currentUser ? (
                <>
                  <div className="rounded-2xl bg-surface-muted px-4 py-4">
                    <p className="text-sm font-semibold text-ink">{accountLabel}</p>
                    <p className="mt-1 text-xs text-muted">{currentUser.username}</p>
                  </div>
                  {!currentUser.is_guest && (
                    <button
                      onClick={() => handleNavigate('profile')}
                      className="mt-2 flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm font-medium text-ink-secondary transition hover:bg-white"
                    >
                      <User className="mr-3 h-4 w-4" />
                      {t('navigation.profile')}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      onLogout?.();
                      setMobileMenuOpen(false);
                    }}
                    className="mt-2 flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm font-medium text-ink-secondary transition hover:bg-white"
                  >
                    <LogOut className="mr-3 h-4 w-4" />
                    {t('navigation.logout')}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleNavigate('login')}
                  className="flex w-full items-center justify-center rounded-2xl bg-brand-fill px-4 py-3 text-sm font-medium text-white"
                >
                  <User className="mr-2 h-4 w-4" />
                  {t('navigation.login')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default TopNavigation;
