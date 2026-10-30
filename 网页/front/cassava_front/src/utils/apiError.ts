/**
 * 统一把后端错误响应翻译成一句能显示给用户的话。
 *
 * DRF 的报错形状不止一种：`{"detail": "..."}`、`{"error": "..."}`、
 * 字段级 `{"algorithm": ["不支持的预测模型…"]}`、以及纯字符串。以前每个
 * 页面各写一段兜底，字段级错误就直接掉进「操作失败」这种没用的提示里。
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  const anyError = error as any;
  const data = anyError?.response?.data ?? anyError?.data ?? null;

  if (!data) {
    return anyError?.message || fallback;
  }
  if (typeof data === 'string') {
    return data || fallback;
  }
  if (typeof data === 'object') {
    const direct = (data as any).detail ?? (data as any).error ?? (data as any).message;
    if (typeof direct === 'string' && direct) {
      return direct;
    }
    const parts: string[] = [];
    Object.entries(data as Record<string, unknown>).forEach(([, value]) => {
      if (value == null) return;
      const text = Array.isArray(value) ? value.filter(Boolean).join('；') : String(value);
      if (text) parts.push(text);
    });
    if (parts.length) return parts.join('；');
  }
  return fallback;
}
