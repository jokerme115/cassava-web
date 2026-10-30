// 统一管理登录 token 的存储位置。
// 勾选“记住我”：存 localStorage（跨浏览器会话保留）；
// 未勾选：存 sessionStorage（关闭标签页即失效）。
const TOKEN_KEY = 'authToken';

export const getAuthToken = (): string | null =>
  localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);

export const setAuthToken = (token: string, remember: boolean): void => {
  clearAuthToken();
  if (remember) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
  }
};

export const clearAuthToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
};
