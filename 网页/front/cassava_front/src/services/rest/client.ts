import axios from 'axios';
import { getAuthToken, clearAuthToken } from '../../utils/authToken';

const RAW_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  '/api';

const isLoopbackUrl = (value: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(value);

export const API_BASE_URL =
  isLoopbackUrl(RAW_API_BASE_URL)
    ? '/api'
    : RAW_API_BASE_URL;

export const API_ORIGIN = API_BASE_URL.startsWith('http')
  ? API_BASE_URL.replace(/\/api\/?$/, '')
  : '';

export const resolveFileUrl = (value: string) => {
  if (!value) return '';
  if (value.startsWith('http')) return value;
  if (value.startsWith('/')) {
    return API_ORIGIN ? `${API_ORIGIN}${value}` : value;
  }
  const normalized = value.replace(/^\/+/, '');
  return API_ORIGIN ? `${API_ORIGIN}/media/${normalized}` : `/media/${normalized}`;
};

export type ApiEnvelope<T> = {
  success: boolean;
  message?: string;
  data: T;
  error?: string;
  detail?: any;
};

export type ListResult<T> = {
  items: T[];
  next?: string | null;
  count?: number;
};

export type PaginatedResponse<T> = {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results: T[];
};

export const unwrapApiData = <T>(payload: any): T => {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

export const parseListResult = <T>(payload: any): ListResult<T> => {
  const unwrapped = unwrapApiData<any>(payload);
  if (Array.isArray(unwrapped)) {
    return { items: unwrapped as T[] };
  }
  if (unwrapped && typeof unwrapped === 'object' && Array.isArray(unwrapped.results)) {
    return {
      items: unwrapped.results as T[],
      next: unwrapped.next ?? null,
      count: typeof unwrapped.count === 'number' ? unwrapped.count : undefined,
    };
  }
  return { items: [] };
};

export const toPaginatedResult = <T>(payload: any): PaginatedResponse<T> => {
  const parsed = parseListResult<T>(payload);
  return {
    count: parsed.count ?? parsed.items.length,
    next: parsed.next ?? null,
    previous: null,
    results: parsed.items,
  };
};

export const toIdString = (value: any): string | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'object') {
    const v = (value as any).id ?? (value as any).pk;
    if (v === null || v === undefined) return undefined;
    return typeof v === 'string' ? v : String(v);
  }
  return String(value);
};

const getCookieValue = (name: string) => {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie.split(';').map(p => p.trim());
  for (const part of parts) {
    if (part.startsWith(`${name}=`)) {
      return decodeURIComponent(part.substring(name.length + 1));
    }
  }
  return null;
};

const API_TIMEOUT =
  Number(import.meta.env.VITE_API_TIMEOUT) > 0
    ? Number(import.meta.env.VITE_API_TIMEOUT)
    : 60000;

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  withCredentials: true,
});

// 添加请求拦截器来包含认证token
api.interceptors.request.use(
  (config) => {
    const token = getAuthToken();
    if (token) {
      config.headers.Authorization = `Token ${token}`;
    }

    const guestToken = localStorage.getItem('guestToken') || getCookieValue('guest_token');
    if (guestToken) {
      config.headers['X-Guest-Token'] = guestToken;
      localStorage.setItem('guestToken', guestToken);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 添加响应拦截器处理认证错误
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Only handle 401 Unauthorized for re-login
    if (error.response?.status === 401) {
      // 只有原本带着登录 token 时才视为会话过期；访客的 401 不应把人踢出登录态
      const hadToken = Boolean(getAuthToken());
      // 认证失败，清除本地token
      clearAuthToken();
      if (hadToken) {
        // 在单页应用中，不直接重定向，而是触发事件让应用处理
        // 创建自定义事件通知应用需要重新登录
        const authEvent = new CustomEvent('auth:expired');
        window.dispatchEvent(authEvent);
      }
    }
    // For 403 Forbidden, we just reject the promise so the UI can handle it (e.g. show error message)
    // without logging the user out.
    return Promise.reject(error);
  }
);

export default api;
