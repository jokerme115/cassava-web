import { describe, it, expect, beforeEach } from 'vitest';
import { getAuthToken, setAuthToken, clearAuthToken } from './authToken';

describe('authToken storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('勾选记住我时写入 localStorage', () => {
    setAuthToken('abc', true);
    expect(localStorage.getItem('authToken')).toBe('abc');
    expect(sessionStorage.getItem('authToken')).toBeNull();
    expect(getAuthToken()).toBe('abc');
  });

  it('未勾选记住我时只写入 sessionStorage', () => {
    setAuthToken('abc', false);
    expect(sessionStorage.getItem('authToken')).toBe('abc');
    expect(localStorage.getItem('authToken')).toBeNull();
    expect(getAuthToken()).toBe('abc');
  });

  it('重新登录时清除另一处的旧 token', () => {
    setAuthToken('old', true);
    setAuthToken('new', false);
    expect(localStorage.getItem('authToken')).toBeNull();
    expect(sessionStorage.getItem('authToken')).toBe('new');
  });

  it('clearAuthToken 清空两处', () => {
    setAuthToken('abc', true);
    clearAuthToken();
    expect(getAuthToken()).toBeNull();
  });
});
