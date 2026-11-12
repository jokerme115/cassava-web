import { describe, expect, it } from 'vitest';
import { parseAgentQuota, quotaBadgeText, quotaNotice, quotaPlaceholder } from './agentQuota';

const allowed = {
  allowed: true, reason: null, used: 2, quota: 50, remaining: 48,
  unlimited: false, today: '2026-11-12', defaultQuota: 50,
};

describe('parseAgentQuota', () => {
  it('读得懂后端的可用态', () => {
    expect(parseAgentQuota(allowed)).toEqual({
      allowed: true, reason: null, used: 2, quota: 50, remaining: 48,
      unlimited: false, today: '2026-11-12', defaultQuota: 50,
    });
  });

  it('不限次数时 quota 是 0、remaining 是 null', () => {
    const quota = parseAgentQuota({ allowed: true, reason: null, used: 0, quota: 0, remaining: null, unlimited: true, today: '2026-11-12', defaultQuota: 50 });
    expect(quota?.unlimited).toBe(true);
    expect(quota?.remaining).toBeNull();
  });

  it('也能读包了一层 data 的响应', () => {
    expect(parseAgentQuota({ success: true, data: allowed })?.remaining).toBe(48);
  });

  it('形状不对时返回 null（页面据此不显示徽标）', () => {
    expect(parseAgentQuota(null)).toBeNull();
    expect(parseAgentQuota({ quota: 50 })).toBeNull();
    expect(parseAgentQuota('<html>502</html>')).toBeNull();
  });

  it('remaining 缺失时按 quota - used 兜底，且不会算成负数', () => {
    expect(parseAgentQuota({ allowed: true, used: 3, quota: 50 })?.remaining).toBe(47);
    expect(parseAgentQuota({ allowed: false, reason: 'quota_exhausted', used: 50, quota: 50 })?.remaining).toBe(0);
  });
});

describe('额度文案', () => {
  it('徽标：可用时给剩余次数，超管说不限次数', () => {
    const quota = parseAgentQuota(allowed)!;
    expect(quotaBadgeText(quota)).toEqual({ main: '今日剩余', value: '48', suffix: '/ 50 次' });
    expect(quotaBadgeText({ ...quota, unlimited: true, quota: 0, remaining: null }).main).toBe('不限次数');
    expect(quotaBadgeText({ ...quota, allowed: false, reason: 'quota_exhausted' }).main).toBe('今日额度已用完');
    expect(quotaBadgeText({ ...quota, allowed: false, reason: 'no_permission' }).main).toBe('智能体未开通');
  });

  it('提示条说清原因和恢复时间，不用感叹号', () => {
    const quota = parseAgentQuota(allowed)!;
    expect(quotaNotice(quota)).toBeNull();
    expect(quotaNotice({ ...quota, allowed: false, reason: 'no_permission' })).toBe('当前账号没有使用智能体的权限，请联系管理员开通');
    expect(quotaNotice({ ...quota, allowed: false, reason: 'quota_exhausted' })).toBe('今日智能体额度已用完（2/50 次），明日 0 点恢复');
    [quotaNotice({ ...quota, allowed: false, reason: 'no_permission' }), quotaNotice({ ...quota, allowed: false, reason: 'quota_exhausted' })]
      .forEach((text) => expect(text).not.toContain('！'));
  });

  it('输入框占位跟着禁用原因变', () => {
    const quota = parseAgentQuota(allowed)!;
    expect(quotaPlaceholder({ ...quota, allowed: false, reason: 'no_permission' })).toBe('当前账号没有使用智能体的权限');
    expect(quotaPlaceholder({ ...quota, allowed: false, reason: 'quota_exhausted' })).toBe('今日额度已用完，明日 0 点恢复');
  });
});
