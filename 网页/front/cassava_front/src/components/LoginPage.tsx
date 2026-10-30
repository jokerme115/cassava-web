import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Lock, User2 } from 'lucide-react';
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
    <div className="login-page flex min-h-full items-center justify-center bg-surface-muted px-4 py-6 sm:px-8">
      <div className="login-shell grid w-full max-w-[1040px] overflow-hidden rounded-[28px] border border-hairline bg-white shadow-[0_16px_60px_rgba(27,60,43,0.07)] lg:grid-cols-[1fr_1fr]">
        <section aria-label="木薯研究工作台" className="login-visual relative hidden min-h-[580px] overflow-hidden bg-brand-fill text-white lg:flex lg:flex-col lg:justify-between">
          <img src="/cases/ppd-example.png" alt="木薯切面轮廓图" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,46,34,.35),rgba(15,46,34,.05)_40%,rgba(15,46,34,.95))]" />
          <div className="relative flex items-center gap-3 p-8"><img src="/assets/logo-128.webp" alt="" className="h-10 w-10 rounded-full bg-white" /><span className="text-xs font-medium tracking-[.2em]">CASSAVA LAB</span></div>
          <div className="relative p-9"><p className="text-xs tracking-[.2em] text-white/70">CASSAVA · PPD</p><h1 className="mt-4 text-3xl font-semibold">木薯图像<br />研究工作台</h1><div className="mt-7 h-px w-12 bg-white/40" /><p className="mt-5 text-xs leading-6 text-white/75">中国热带农业科学院<br />海南师范大学</p></div>
        </section>
        <section className="flex flex-col justify-center px-6 py-8 sm:px-10 lg:px-12 lg:py-10">
          <div className="flex h-full flex-col justify-center">
            <div className="mb-7"><p className="mb-2 text-xs font-medium tracking-[.2em] text-accent-text lg:hidden">CASSAVA LAB</p><h2 className="text-2xl font-semibold tracking-normal text-ink">{t('login.sign_in')}</h2></div>
            {loginError && (
              <div className="mb-6 rounded-3xl border border-[rgba(243,18,96,0.24)] bg-[rgba(243,18,96,0.08)] px-4 py-3 text-sm text-danger-text">
                {loginError}
              </div>
            )}

            <form className="space-y-5" onSubmit={handlePasswordLogin}>
              <div>
                <label htmlFor="loginId" className="mb-2 block text-sm font-medium text-ink-secondary">
                  {t('login.username_or_email')}
                </label>
                <div className="relative">
                  <User2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    id="loginId"
                    name="loginId"
                    type="text"
                    required
                    autoComplete="username"
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                    className="h-12 w-full rounded-xl border border-hairline bg-white pl-11 pr-4 text-sm text-ink outline-none transition placeholder:text-muted focus:border-accent-line focus:bg-white focus:ring-4 focus:ring-accent-line/15"
                    placeholder={t('login.username_or_email_placeholder')}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-medium text-ink-secondary">
                  {t('login.password_label')}
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 w-full rounded-xl border border-hairline bg-white pl-11 pr-4 text-sm text-ink outline-none transition placeholder:text-muted focus:border-accent-line focus:bg-white focus:ring-4 focus:ring-accent-line/15"
                    placeholder={t('login.password_placeholder')}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 text-sm">
                <label className="inline-flex items-center gap-2 text-ink-secondary">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-hairline-strong text-accent-text focus:ring-ok"
                  />
                  {t('login.remember_me')}
                </label>
                <button type="button" className="font-medium text-accent-text transition hover:text-brand-fill-hover">
                  {t('login.forgot_password')}
                </button>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-brand-fill px-5 text-sm font-medium text-white transition hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isLoading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-hairline border-t-white" />
                ) : (
                  <>
                    {t('login.sign_in')}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <div className="my-5 flex items-center gap-4">
              <div className="h-px flex-1 bg-hairline" />
              <span className="text-xs uppercase tracking-[0.22em] text-muted">{t('login.or')}</span>
              <div className="h-px flex-1 bg-hairline" />
            </div>

            <div className="space-y-3">
              {systemSettings.enable_guest_access !== false && (
                <button
                  onClick={handleGuestLogin}
                  className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-hairline bg-white px-5 text-sm font-medium text-ink-secondary transition hover:border-hairline-strong hover:bg-white"
                >
                  {t('login.guest_login')}
                </button>
              )}

              <button
                onClick={() => onNavigate('home')}
                className="inline-flex h-12 w-full items-center justify-center rounded-full text-sm font-medium text-muted transition hover:bg-white hover:text-ink-secondary"
              >
                返回首页
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default LoginPage;
