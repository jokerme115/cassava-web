// 访客会话本地持久化：服务端签发 guest_token 后保存在本地，
// 刷新页面时无需重新点击“访客试用”即可恢复访客身份。
const GUEST_TOKEN_KEY = 'guestToken';
const GUEST_USER_KEY = 'guestUser';

export interface GuestUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  is_active: boolean;
  is_guest: boolean;
  roles: unknown[];
}

export const saveGuestSession = (token: string, user: GuestUser): void => {
  localStorage.setItem(GUEST_TOKEN_KEY, token);
  localStorage.setItem(GUEST_USER_KEY, JSON.stringify(user));
};

export const getGuestToken = (): string | null => localStorage.getItem(GUEST_TOKEN_KEY);

export const loadGuestSession = (): GuestUser | null => {
  const token = localStorage.getItem(GUEST_TOKEN_KEY);
  const raw = localStorage.getItem(GUEST_USER_KEY);
  if (!token || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.is_guest ? parsed : null;
  } catch {
    return null;
  }
};

export const clearGuestSession = (): void => {
  localStorage.removeItem(GUEST_TOKEN_KEY);
  localStorage.removeItem(GUEST_USER_KEY);
};
