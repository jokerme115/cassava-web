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
import logoImage from '/assets/logo.jpg';

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
  const [analysisMenuOpen, setAnalysisMenuOpen] = useState(false);

  const analysisRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const languageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      if (analysisRef.current && !analysisRef.current.contains(target)) {
        setAnalysisMenuOpen(false);
      }

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

  const isAnalysisActive = analysisItems.some((item) => item.id === activeSection);
  const displayName = currentUser?.first_name || currentUser?.username || t('navigation.login');
  const accountLabel = currentUser?.is_guest ? t('login.guest_user') : displayName;

  const navButtonClass = (active: boolean) =>
    `inline-flex h-10 items-center rounded-full px-4 text-sm font-medium transition ${
      active
        ? 'bg-[#0a84ff] text-white shadow-[0_8px_24px_rgba(10,132,255,0.32)]'
        : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
    }`;

  const handleNavigate = (section: string) => {
    onSectionChange(section);
    setMobileMenuOpen(false);
    setAnalysisMenuOpen(false);
    setUserMenuOpen(false);
  };

  return (
    <nav className="sticky top-0 z-40 border-b border-white/60 bg-white/55 backdrop-blur-2xl backdrop-saturate-150">
      <div className="mx-auto max-w-[1440px] px-4 py-3 sm:px-6 lg:px-8">
        <div className="glass-panel glass-sheen flex items-center justify-between gap-4 rounded-full px-4 py-3">
          <button
            onClick={() => handleNavigate('home')}
            className="flex min-w-0 items-center gap-3 text-left"
          >
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl glass-panel shadow-sm">
              <img src={logoImage} alt={t('system.title')} className="h-full w-full object-cover" />
            </div>
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-sm font-semibold tracking-[0.18em] text-[#0a84ff]">
                CASSAVA LAB
              </p>
              <h1 className="truncate text-base font-semibold text-slate-900">
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

            <div className="relative" ref={analysisRef}>
              <button
                onClick={() => {
                  if (!isAnalysisActive) {
                    onSectionChange('prediction');
                  }
                  setAnalysisMenuOpen((open) => !open);
                }}
                className={navButtonClass(isAnalysisActive || analysisMenuOpen)}
              >
                <Brain className="mr-2 h-4 w-4" />
                {t('navigation.analysis')}
                <ChevronDown
                  className={`ml-2 h-4 w-4 transition-transform ${
                    analysisMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {analysisMenuOpen && (
                <div className="absolute left-0 top-[calc(100%+12px)] w-64 rounded-3xl glass-panel p-2 shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
                  {analysisItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleNavigate(item.id)}
                        className={`flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm transition ${
                          activeSection === item.id
                            ? 'bg-[#0a84ff] text-white'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <Icon className="mr-3 h-4 w-4" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            <div className="relative" ref={languageRef}>
              <button
                onClick={() => setLanguageMenuOpen((open) => !open)}
                className="inline-flex h-10 items-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
              >
                <Languages className="mr-2 h-4 w-4" />
                {i18n.language === 'zh' ? t('common.languages.zh') : t('common.languages.en')}
                <ChevronDown className="ml-2 h-4 w-4 text-slate-400" />
              </button>

              {languageMenuOpen && (
                <div className="absolute right-0 top-[calc(100%+12px)] w-40 rounded-3xl glass-panel p-2 shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
                  {['zh', 'en'].map((lng) => (
                    <button
                      key={lng}
                      onClick={() => changeLanguage(lng)}
                      className={`block w-full rounded-2xl px-4 py-3 text-left text-sm transition ${
                        i18n.language === lng
                          ? 'bg-[#0a84ff] text-white'
                          : 'text-slate-700 hover:bg-slate-50'
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
                    className="inline-flex h-10 items-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <User className="mr-2 h-4 w-4" />
                    <span className="max-w-[120px] truncate">{accountLabel}</span>
                    <ChevronDown className="ml-2 h-4 w-4 text-slate-400" />
                  </button>

                  {userMenuOpen && (
                    <div className="absolute right-0 top-[calc(100%+12px)] w-64 rounded-3xl glass-panel p-2 shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
                      <div className="rounded-2xl bg-slate-50 px-4 py-4">
                        <p className="text-sm font-semibold text-slate-900">{accountLabel}</p>
                        <p className="mt-1 text-xs text-slate-500">{currentUser.username}</p>
                      </div>
                      {!currentUser.is_guest && (
                        <button
                          onClick={() => handleNavigate('profile')}
                          className="mt-2 flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-slate-50"
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
                        className="mt-1 flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-slate-50"
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
                  className="inline-flex h-10 items-center rounded-full bg-[#0a84ff] px-4 text-sm font-medium text-white transition hover:bg-slate-800"
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
              className="inline-flex h-10 w-10 items-center justify-center rounded-full glass-panel text-slate-700"
            >
              <Languages className="h-4 w-4" />
            </button>
            <button
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#0a84ff] text-white"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {languageMenuOpen && (
          <div className="mt-3 rounded-[28px] border border-white/80 bg-white/90 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.06)] lg:hidden">
            {['zh', 'en'].map((lng) => (
              <button
                key={lng}
                onClick={() => changeLanguage(lng)}
                className={`block w-full rounded-2xl px-4 py-3 text-left text-sm transition ${
                  i18n.language === lng ? 'bg-[#0a84ff] text-white' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {lng === 'zh' ? t('common.languages.zh') : t('common.languages.en')}
              </button>
            ))}
          </div>
        )}

        {mobileMenuOpen && (
          <div className="mt-3 rounded-[28px] border border-white/80 bg-white/94 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.06)] lg:hidden">
            <div className="space-y-2">
              {mainItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item.id)}
                  className={`block w-full rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                    activeSection === item.id ? 'bg-[#0a84ff] text-white' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="mt-4 border-t border-slate-200 pt-4">
              <p className="px-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                {t('navigation.analysis')}
              </p>
              <div className="mt-2 space-y-2">
                {analysisItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleNavigate(item.id)}
                    className={`flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                      activeSection === item.id
                        ? 'bg-[#0a84ff] text-white'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <item.icon className="mr-3 h-4 w-4" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 border-t border-slate-200 pt-4">
              {currentUser ? (
                <>
                  <div className="rounded-2xl bg-slate-50 px-4 py-4">
                    <p className="text-sm font-semibold text-slate-900">{accountLabel}</p>
                    <p className="mt-1 text-xs text-slate-500">{currentUser.username}</p>
                  </div>
                  {!currentUser.is_guest && (
                    <button
                      onClick={() => handleNavigate('profile')}
                      className="mt-2 flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
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
                    className="mt-2 flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    <LogOut className="mr-3 h-4 w-4" />
                    {t('navigation.logout')}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleNavigate('login')}
                  className="flex w-full items-center justify-center rounded-2xl bg-[#0a84ff] px-4 py-3 text-sm font-medium text-white"
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
