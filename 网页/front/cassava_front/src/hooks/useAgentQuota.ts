import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../services/rest/client';
import { getAuthToken } from '../utils/authToken';
import { parseAgentQuota, type AgentQuota } from '../utils/agentQuota';

const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/$/, '')}${path}`;

/**
 * 智能体额度的唯一数据源：页面打开时拉一次，每轮对话结束后再拉一次。
 *
 * 失败一律静默——额度只是辅助信息，拿不到就不显示，不能因此打断对话，
 * 也不要把上一次的值清空（那样徽标会在网络抖动时闪一下又长回来）。
 */
export function useAgentQuota(enabled = true) {
  const [quota, setQuota] = useState<AgentQuota | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async (): Promise<AgentQuota | null> => {
    const id = ++seq.current;
    try {
      const token = getAuthToken();
      const res = await fetch(apiUrl('/agent/quota/'), {
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}) },
      });
      if (!res.ok) return null;
      const next = parseAgentQuota(await res.json());
      // 后来居上：慢响应不能覆盖新的一轮结果
      if (next && id === seq.current) setQuota(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      seq.current += 1;
      setQuota(null);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  return { quota, refresh };
}

export default useAgentQuota;
