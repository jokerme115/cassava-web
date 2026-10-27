import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Lock, Sparkles, User2 } from 'lucide-react';
import logoImage from '/assets/logo.jpg';
import { SystemSetting, User } from '../types';
import { setAuthToken } from '../utils/authToken';
import { saveGuestSession, clearGuestSession } from '../utils/guestSession';
import { authApi } from '../services/api';

interface LoginPageProps {
  onLogin: (user: any) => void;
  onNavigate: (section: string) => void;
  systemSettings?: Partial<SystemSetting>;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin, onNavigate, systemSettings = {} }) => {
  const { t } = useTranslation();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

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

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    if (!loginId.trim() || !password.trim()) {
      setLoginError(t('login.errors.empty_fields'));
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken') || ''
        },
        credentials: 'include',
        body: JSON.stringify({ username: loginId, password })
      });

      const data = await response.json();

      if (data.success && data.user) {
        if (data.token) {
          setAuthToken(data.token, rememberMe);
        }
        clearGuestSession();

        onLogin(data.user);
      } else {
        setLoginError(data.error || t('login.errors.login_failed'));
      }
    } catch (error) {
      console.error('Login failed:', error);
      setLoginError(t('login.errors.try_again'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestLogin = async () => {    setLoginError('');
    setIsLoading(true);
    try {
      const data = await authApi.guestSession();
      const guestUser: User = {
        id: 0,
        username: 'Guest',
        email: '',
        first_name: t('login.guest_user'),
        is_active: true,
        is_guest: true,
        roles: []
      };
      saveGuestSession(data.guest_token, { ...guestUser, ...(data.user || {}) });
      onLogin(guestUser);
    } catch (error: any) {
      // 访客入口被管理员关闭时后端返回 403
      const detail = error?.response?.data?.message;
      setLoginError(detail || t('login.errors.try_again'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-92px)] bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.07),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(15,23,42,0.05),_transparent_32%),linear-gradient(180deg,#f6f7f9_0%,#eceef2_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-140px)] max-w-6xl items-stretch gap-6 lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative overflow-hidden rounded-[36px] bg-[linear-gradient(135deg,#0a84ff_0%,#5856d6_58%,#af52de_100%)] px-6 py-8 text-white shadow-[0_28px_100px_rgba(15,23,42,0.18)] sm:px-8 sm:py-10 lg:px-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(15,23,42,0.10),_transparent_30%),radial-gradient(circle_at_20%_80%,_rgba(15,23,42,0.06),_transparent_26%)]" />
          <div className="relative flex h-full flex-col justify-between">
            <div>
              <div className="inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-slate-100 backdrop-blur">
                <Sparkles className="h-4 w-4 text-emerald-300" />
                {t('system.subtitle')}
              </div>
              <div className="mt-8 flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/95 shadow-lg">
                  <img src={logoImage} alt={t('system.title')} className="h-full w-full object-cover" />
                </div>
                <div>
                  <p className="text-sm tracking-[0.24em] text-emerald-200">{t('login.hero_badge')}</p>
                  <h1 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">
                    {t('system.title')}
                  </h1>
                </div>
              </div>
              <p className="mt-8 max-w-xl text-base leading-8 text-slate-300 sm:text-lg">
                {t('homepage.hero.description')}
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                { label: t('navigation.prediction'), value: t('login.feature_segmentation') },
                { label: t('navigation.results'), value: t('login.feature_results') },
                { label: t('navigation.contact'), value: t('login.feature_support') }
              ].map((item) => (
                <div key={item.label} className="rounded-3xl border border-white/10 bg-white/8 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                  <p className="mt-3 text-sm font-medium text-slate-100">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[36px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-8">
          <div className="flex h-full flex-col">
            <div className="mb-8">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-700">
                {t('login.account_access')}
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                {t('login.title')}
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                {t('login.login_hint')}
              </p>
            </div>

            {loginError && (
              <div className="mb-6 rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {loginError}
              </div>
            )}

            <form className="space-y-5" onSubmit={handlePasswordLogin}>
              <div>
                <label htmlFor="loginId" className="mb-2 block text-sm font-medium text-slate-700">
                  {t('login.username_or_email')}
                </label>
                <div className="relative">
                  <User2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="loginId"
                    name="loginId"
                    type="text"
                    required
                    autoComplete="username"
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white/45 pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white/80 focus:ring-4 focus:ring-emerald-100"
                    placeholder={t('login.username_or_email_placeholder')}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700">
                  {t('login.password_label')}
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white/45 pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white/80 focus:ring-4 focus:ring-emerald-100"
                    placeholder={t('login.password_placeholder')}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 text-sm">
                <label className="inline-flex items-center gap-2 text-slate-600">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  {t('login.remember_me')}
                </label>
                <button type="button" className="font-medium text-emerald-700 transition hover:text-emerald-800">
                  {t('login.forgot_password')}
                </button>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex h-12 w-full items-center justify-center rounded-full bg-[#0a84ff] px-5 text-sm font-medium text-white transition hover:bg-[#0070d6] disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isLoading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <>
                    {t('login.sign_in')}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <div className="my-8 flex items-center gap-4">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs uppercase tracking-[0.22em] text-slate-400">{t('login.or')}</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <div className="space-y-3">
              {systemSettings.enable_guest_access !== false && (
                <button
                  onClick={handleGuestLogin}
                  className="inline-flex h-12 w-full items-center justify-center rounded-full glass-panel px-5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white/45"
                >
                  {t('login.guest_login')}
                </button>
              )}

              <button
                onClick={() => onNavigate('home')}
                className="inline-flex h-12 w-full items-center justify-center rounded-full text-sm font-medium text-slate-500 transition hover:bg-white/45 hover:text-slate-700"
              >
                返回首页继续浏览
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default LoginPage;
