import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Mail, ShieldCheck, User2 } from 'lucide-react';
import { User } from '../types';

interface RegisterPageProps {
  onRegister: (user: User) => void;
  onNavigate: (section: string) => void;
}

const RegisterPage: React.FC<RegisterPageProps> = ({ onRegister, onNavigate }) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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

  const getCsrfToken = async () => {
    try {
      await fetch('/api/auth/csrf/', {
        credentials: 'include'
      });
    } catch (error) {
      console.error('Failed to get CSRF token:', error);
    }
  };

  useEffect(() => {
    getCsrfToken();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setCooldown((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [cooldown]);

  const validateForm = () => {
    if (!email.trim()) {
      setRegisterError(t('register.email_required'));
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRegisterError(t('register.email_invalid'));
      return false;
    }

    if (!emailCode.trim()) {
      setRegisterError(t('register.code_required'));
      return false;
    }

    if (!password.trim()) {
      setRegisterError(t('register.password_required'));
      return false;
    }

    if (password.length < 6) {
      setRegisterError(t('register.password_too_short'));
      return false;
    }

    if (password !== confirmPassword) {
      setRegisterError(t('register.passwords_not_match'));
      return false;
    }

    return true;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError('');
    setRegisterSuccess('');

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/register/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken') || ''
        },
        credentials: 'include',
        body: JSON.stringify({
          email,
          username: email,
          password,
          first_name: firstName,
          email_code: emailCode
        })
      });

      const data = await response.json();

      if (data.success && data.user) {
        if (data.token) {
          localStorage.setItem('authToken', data.token);
        }

        setRegisterSuccess(t('register.register_success'));
        setTimeout(() => {
          onRegister(data.user);
        }, 1200);
      } else {
        setRegisterError(data.error || t('register.register_failed'));
      }
    } catch (error) {
      console.error('Register failed:', error);
      setRegisterError(t('register.register_failed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendCode = async () => {
    setRegisterError('');
    setRegisterSuccess('');

    if (!email.trim()) {
      setRegisterError(t('register.email_required'));
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRegisterError(t('register.email_invalid'));
      return;
    }

    if (cooldown > 0 || isSendingCode) {
      return;
    }

    setIsSendingCode(true);

    try {
      const response = await fetch('/api/auth/email/code/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken') || ''
        },
        credentials: 'include',
        body: JSON.stringify({ email, purpose: 'register' })
      });

      const data = await response.json();

      if (data.success) {
        setRegisterSuccess(t('register.code_sent'));
        setCooldown(60);
      } else {
        setRegisterError(data.error || t('register.code_send_failed'));
      }
    } catch (error) {
      console.error('Failed to send code:', error);
      setRegisterError(t('register.code_send_failed'));
    } finally {
      setIsSendingCode(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-92px)] bg-surface-muted px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-140px)] max-w-6xl items-stretch gap-6 lg:grid-cols-[0.94fr_1.06fr]">
        <section className="rounded-[24px] border border-hairline bg-white p-6 shadow-card sm:p-8">
          <div className="flex h-full flex-col">
            <div className="mb-8">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-3xl card shadow-sm">
                  <img src="/assets/logo-128.webp" alt={t('system.title')} className="h-full w-full object-cover" />
                </div>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-accent-text">
                    Create Account
                  </p>
                  <h2 className="mt-2 text-3xl font-semibold tracking-normal text-ink">
                    {t('register.title')}
                  </h2>
                </div>
              </div>
              <p className="mt-5 text-sm leading-7 text-muted">
                注册后可以继续进入任务、结果和数据管理页面，浏览首页与联系我们无需账号。
              </p>
            </div>

            {registerError && (
              <div className="mb-5 rounded-3xl border border-[rgba(243,18,96,0.24)] bg-[rgba(243,18,96,0.08)] px-4 py-3 text-sm text-danger-text">
                {registerError}
              </div>
            )}

            {registerSuccess && (
              <div className="mb-5 rounded-3xl border border-[rgba(23,201,100,0.28)] bg-[rgba(10,132,255,0.08)] px-4 py-3 text-sm text-accent-text">
                {registerSuccess}
              </div>
            )}

            <form className="space-y-5" onSubmit={handleRegister}>
              <div>
                <label htmlFor="firstName" className="mb-2 block text-sm font-medium text-ink-secondary">
                  {t('register.first_name')}
                </label>
                <div className="relative">
                  <User2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="h-12 w-full rounded-2xl border border-hairline bg-white pl-11 pr-4 text-sm text-ink outline-none transition focus:border-accent-line focus:bg-white focus:ring-4 focus:ring-accent-line/15"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-medium text-ink-secondary">
                  {t('register.email')}
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 w-full rounded-2xl border border-hairline bg-white pl-11 pr-4 text-sm text-ink outline-none transition focus:border-accent-line focus:bg-white focus:ring-4 focus:ring-accent-line/15"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="emailCode" className="mb-2 block text-sm font-medium text-ink-secondary">
                  {t('register.email_code')}
                </label>
                <div className="flex gap-3">
                  <input
                    id="emailCode"
                    name="emailCode"
                    type="text"
                    autoComplete="one-time-code"
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value)}
                    className="h-12 min-w-0 flex-1 rounded-2xl border border-hairline bg-white px-4 text-sm text-ink outline-none transition placeholder:text-muted focus:border-accent-line focus:bg-white focus:ring-4 focus:ring-accent-line/15"
                    placeholder={t('register.email_code_placeholder')}
                  />
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={cooldown > 0 || isSendingCode}
                    className="inline-flex h-12 shrink-0 items-center justify-center rounded-2xl border border-hairline px-4 text-sm font-medium text-ink-secondary transition hover:border-hairline-strong hover:bg-white disabled:cursor-not-allowed disabled:text-muted"
                  >
                    {cooldown > 0
                      ? t('register.resend_code', { seconds: cooldown })
                      : t('register.send_code')}
                  </button>
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="password" className="mb-2 block text-sm font-medium text-ink-secondary">
                    {t('register.password')}
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 w-full rounded-2xl border border-hairline bg-white px-4 text-sm text-ink outline-none transition focus:border-accent-line focus:bg-white focus:ring-4 focus:ring-accent-line/15"
                  />
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="mb-2 block text-sm font-medium text-ink-secondary">
                    {t('register.confirm_password')}
                  </label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-12 w-full rounded-2xl border border-hairline bg-white px-4 text-sm text-ink outline-none transition focus:border-accent-line focus:bg-white focus:ring-4 focus:ring-accent-line/15"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex h-12 w-full items-center justify-center rounded-full bg-brand-fill px-5 text-sm font-medium text-white transition hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isLoading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-hairline border-t-white" />
                ) : (
                  <>
                    {t('register.register')}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <div className="my-8 flex items-center gap-4">
              <div className="h-px flex-1 bg-hairline" />
              <span className="text-xs uppercase tracking-[0.22em] text-muted">{t('register.or')}</span>
              <div className="h-px flex-1 bg-hairline" />
            </div>

            <button
              onClick={() => onNavigate('login')}
              className="inline-flex h-12 w-full items-center justify-center rounded-full card px-5 text-sm font-medium text-ink-secondary transition hover:border-hairline-strong hover:bg-white"
            >
              {t('register.already_have_account')}
            </button>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[24px] bg-brand-fill px-6 py-8 text-white shadow-[0_4px_16px_rgba(17,24,28,0.05)] sm:px-8 sm:py-10 lg:px-10">
          <div className="absolute inset-0 bg-[rgba(255,255,255,0.35)]" />
          <div className="relative flex h-full flex-col justify-between">
            <div>
              <div className="inline-flex items-center gap-3 rounded-full border border-white/20 bg-[#005cb8] px-4 py-2 text-sm text-white">
                <ShieldCheck className="h-4 w-4 text-ok" />
                Secure Research Workspace
              </div>
              <h3 className="mt-8 max-w-lg text-4xl font-semibold leading-tight">
                创建账号后即可进入完整的木薯检测与结果协作流程。
              </h3>
              <p className="mt-6 max-w-xl text-base leading-8 text-white/90">
                账号用于保护样本数据、预测结果、任务中心与权限管理。公共展示内容仍然保持可访问，让首次访客先看见系统价值，再决定是否登录。
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                { title: 'Data Safety', desc: '权限页面与日志仅授权用户可见' },
                { title: 'Workflow', desc: '从上传、预测到结果沉淀一体化' },
                { title: 'Collaboration', desc: '支持访客浏览，正式用户再进入操作页' }
              ].map((item) => (
                <div key={item.title} className="rounded-3xl border border-white/15 bg-white/10 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-white/80">{item.title}</p>
                  <p className="mt-3 text-sm leading-6 text-white">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default RegisterPage;
