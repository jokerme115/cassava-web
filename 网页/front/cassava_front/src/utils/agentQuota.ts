/**
 * 智能体使用权限与每日额度（GET /agent/quota/）的前端口径。
 *
 * 后端是唯一判定方：能不能用（allowed）、为什么不能用（reason）、今天还剩几次。
 * 前端只负责把这几个字段翻译成一句人话，不在本地推算「还能不能发」。
 */
export type AgentQuotaReason = 'no_permission' | 'quota_exhausted';

export type AgentQuota = {
  allowed: boolean;
  reason: AgentQuotaReason | null;
  used: number;
  /** 0 且 unlimited 为 true 时表示不限次数 */
  quota: number;
  /** 不限次数时为 null */
  remaining: number | null;
  unlimited: boolean;
  today: string;
  defaultQuota: number;
};

const toCount = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const unwrap = (raw: unknown) => {
  const value = raw as any;
  return value?.data && typeof value.data === 'object' ? value.data : value;
};

/** 解析 GET /agent/quota/；形状不对返回 null（调用方据此静默不显示徽标）。 */
export function parseAgentQuota(raw: unknown): AgentQuota | null {
  const data = unwrap(raw) as any;
  if (!data || typeof data !== 'object' || typeof data.allowed !== 'boolean') return null;

  const unlimited = data.unlimited === true;
  const quota = toCount(data.quota);
  const used = toCount(data.used);
  const remaining = data.remaining === null || data.remaining === undefined
    ? (unlimited ? null : Math.max(quota - used, 0))
    : toCount(data.remaining);

  return {
    allowed: data.allowed,
    reason: data.reason === 'no_permission' || data.reason === 'quota_exhausted' ? data.reason : null,
    used,
    quota,
    remaining,
    unlimited,
    today: typeof data.today === 'string' ? data.today : '',
    defaultQuota: toCount(data.defaultQuota, quota),
  };
}

/** 页头徽标：只写结论，不带感叹号。数字单独拆出来，好加粗做层次。 */
export function quotaBadgeText(quota: AgentQuota): { main: string; value?: string; suffix?: string } {
  if (quota.unlimited) return { main: '不限次数' };
  if (quota.allowed) return { main: '今日剩余', value: String(quota.remaining ?? 0), suffix: `/ ${quota.quota} 次` };
  if (quota.reason === 'quota_exhausted') return { main: '今日额度已用完' };
  return { main: '智能体未开通' };
}

/** 输入区上方的提示条：说明为什么现在发不出去，以及怎么办。 */
export function quotaNotice(quota: AgentQuota): string | null {
  if (quota.allowed) return null;
  if (quota.reason === 'quota_exhausted') {
    return `今日智能体额度已用完（${quota.used}/${quota.quota} 次），明日 0 点恢复`;
  }
  return '当前账号没有使用智能体的权限，请联系管理员开通';
}

/** 输入框占位：禁用状态也要说清原因，不要让框看起来像坏了。 */
export function quotaPlaceholder(quota: AgentQuota): string {
  if (quota.reason === 'quota_exhausted') return '今日额度已用完，明日 0 点恢复';
  return '当前账号没有使用智能体的权限';
}
