import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePermission } from './usePermission';
const mocks = vi.hoisted(() => ({ permissions: vi.fn(), roles: vi.fn(), t: (key: string) => key }));
vi.mock('../services/api', () => ({ permissionsApi: { getCurrentUserPermissionsList: mocks.permissions, getCurrentUserRolesList: mocks.roles } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.permissions.mockResolvedValue(['view_image']); mocks.roles.mockResolvedValue([{ name: '用户' }]); });
describe('shared concurrent authorization reads', () => {
  it('coalesces concurrent consumers without retaining stale privileges', async () => {
    const { result } = renderHook(() => [usePermission(), usePermission()]);
    await waitFor(() => expect(result.current[0].isLoading).toBe(false));
    expect(mocks.permissions).toHaveBeenCalledTimes(1); expect(mocks.roles).toHaveBeenCalledTimes(1);
    mocks.permissions.mockResolvedValue([]);
    act(() => { window.dispatchEvent(new Event('permissions:updated')); });
    await waitFor(() => expect(result.current[0].hasPermission('view_image')).toBe(false));
    expect(mocks.permissions).toHaveBeenCalledTimes(2);
  });
});
