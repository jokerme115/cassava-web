/**
 * 统一把后端错误响应翻译成一句能显示给用户的话。
 *
 * DRF 的报错形状不止一种：`{"detail": "..."}`、`{"error": "..."}`、
 * 字段级 `{"algorithm": ["不支持的预测模型…"]}`、以及纯字符串。以前每个
 * 页面各写一段兜底，字段级错误就直接掉进「操作失败」这种没用的提示里。
 *
 * 权限和登录态先按 HTTP 状态兜底：后端拒绝时可能只回一个空 body，
 * 这时不能把「没有权限」说成「失败，请重试」。
 */
export const PERMISSION_DENIED_MESSAGE = '当前账号没有该操作的权限';
export const SESSION_EXPIRED_MESSAGE = '登录已过期，请重新登录';

/** 取响应体里能直接展示的那一句；HTML 错误页不算可读文案。 */
function readDirectMessage(data: unknown): string {
  if (!data) return '';
  if (typeof data === 'string') {
    const text = data.trim();
    return text.startsWith('<') ? '' : text;
  }
  if (typeof data !== 'object') return '';
  const direct = (data as any).detail ?? (data as any).error ?? (data as any).message;
  return typeof direct === 'string' ? direct.trim() : '';
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const anyError = error as any;
  const status = Number(anyError?.response?.status ?? anyError?.status ?? 0) || 0;
  const data = anyError?.response?.data ?? anyError?.data ?? null;
  const direct = readDirectMessage(data);

  // 登录态：拦截器已经清了 token，提示要落到「重新登录」而不是「请重试」
  if (status === 401) {
    return SESSION_EXPIRED_MESSAGE;
  }
  // 权限：403 且服务端没给可读原因时，明确说没有权限
  if (status === 403 && !direct) {
    return PERMISSION_DENIED_MESSAGE;
  }
  if (direct) {
    return direct;
  }
  if (!data) {
    return anyError?.message || fallback;
  }
  if (typeof data === 'object') {
    const parts: string[] = [];
    Object.entries(data as Record<string, unknown>).forEach(([key, value]) => {
      // success 之类的布尔标记不是给人看的错误文案
      if (key === 'success' || value == null) return;
      const text = Array.isArray(value)
        ? value.filter(Boolean).join('；')
        : typeof value === 'string' || typeof value === 'number'
          ? String(value)
          : '';
      if (text) parts.push(text);
    });
    if (parts.length) return parts.join('；');
  }
  return fallback;
}
