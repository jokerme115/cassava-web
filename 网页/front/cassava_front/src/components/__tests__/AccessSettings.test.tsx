import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.setConfig({ testTimeout: 20000 });
import AccessSettings from '../AccessSettings';

const api = vi.hoisted(() => ({ getAllRoles: vi.fn(), getAllPermissions: vi.fn(), getAllUsers: vi.fn(), getRoleById: vi.fn(), updateRole: vi.fn(), getRoleUsers: vi.fn() }));
vi.mock('../../services/api', () => ({ permissionsApi: api }));
vi.mock('../../hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: () => true, isLoading: false }) }));
vi.mock('../../utils/feedback', () => ({ message: { success: vi.fn(), error: vi.fn() } }));
const root = { id: 1, username: 'admin', email: '', is_active: true, is_superuser: true };
const role = { id: 3, name: '实验员', description: '实验室成员', permissions: [10], user_count: 2, permissions_count: 1, is_active: true };
beforeEach(() => {
  vi.clearAllMocks();
  api.getAllRoles.mockResolvedValue({ count: 1, results: [role] });
  api.getAllPermissions.mockResolvedValue({ count: 2, results: [{ id: 10, name: '查看图片', codename: 'view_image', is_bound: true }, { id: 11, name: '上传图片', codename: 'upload_image', is_bound: true }] });
  api.getRoleById.mockResolvedValue({ ...role, permission_ids: [10] });
  api.updateRole.mockResolvedValue(role);
  api.getRoleUsers.mockResolvedValue([{ id: 7, username: 'member', email: 'member@example.test' }]);
});

describe('settings role workflow', () => {
  it('loads existing selection and sends one complete permission set', async () => {
    render(<AccessSettings section="roles" currentUser={root} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑与权限' }));
    const dialog = await screen.findByRole('dialog');
    const read = await within(dialog).findByRole('checkbox', { name: '查看图片' });
    expect(read).toBeChecked();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '上传图片' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '保 存' }));
    await waitFor(() => expect(api.updateRole).toHaveBeenCalledWith('3', expect.objectContaining({ permission_ids: [10, 11] })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('keeps role drawer open with server error on save failure', async () => {
    api.updateRole.mockRejectedValue({ response: { data: { name: ['名称重复'] } } });
    render(<AccessSettings section="roles" currentUser={root} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑与权限' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '保 存' }));
    expect(await within(dialog).findByText('name：名称重复')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('opens actual members and blocks deletion when members exist', async () => {
    render(<AccessSettings section="roles" currentUser={root} />);
    fireEvent.click(await screen.findByRole('button', { name: '2 人' }));
    expect(await screen.findByText('member@example.test')).toBeInTheDocument();
    expect(api.getRoleUsers).toHaveBeenCalledWith('3');
    expect(screen.getByRole('button', { name: '删 除' })).toBeDisabled();
  });
  it('shows binding status and has no inert create-permission control', async () => {
    render(<AccessSettings section="permissions" currentUser={root} />);
    expect(await screen.findByText('upload_image')).toBeInTheDocument();
    expect(screen.getAllByText('已接入功能')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /新建权限/ })).not.toBeInTheDocument();
  });
});
