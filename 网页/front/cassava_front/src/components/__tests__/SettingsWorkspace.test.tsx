import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsWorkspace from '../SettingsWorkspace';
import { getUserPreferences } from '../../utils/userPreferences';

const mocks = vi.hoisted(() => ({ updateProfile: vi.fn(), language: vi.fn() }));
vi.mock('../../services/api', () => ({ authApi: { updateProfile: mocks.updateProfile }, systemSettingsApi: {} }));
vi.mock('../../hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: () => false, isLoading: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh', changeLanguage: mocks.language } }) }));
vi.mock('../../utils/feedback', () => ({ message: { success: vi.fn(), error: vi.fn() } }));
vi.setConfig({ testTimeout: 20000 });
const user = { id: 5, username: 'scientist', email: 'test@example.test', is_active: true, profile: { preferences: { brushSize: 31 } } };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
describe('settings workspace', () => {
  it('keeps administration and inert notification controls out of a normal account', async () => {
    render(<MemoryRouter initialEntries={['/profile']}><SettingsWorkspace currentUser={user} onLogout={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: '个人资料' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '角色' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '站点设置' })).not.toBeInTheDocument();
    expect(screen.queryByText('邮件通知')).not.toBeInTheDocument();
  });
  it('persists editor defaults through the profile API and updates consumers', async () => {
    mocks.updateProfile.mockImplementation(async payload => ({ ...user, profile: { preferences: payload.preferences } }));
    render(<MemoryRouter initialEntries={['/profile?tab=preferences']}><SettingsWorkspace currentUser={user} onLogout={vi.fn()} /></MemoryRouter>);
    const brush = screen.getByRole('spinbutton', { name: '画笔直径（原图像素）' });
    expect(brush).toHaveValue('31');
    fireEvent.change(brush, { target: { value: '39' } });
    expect(screen.getByTestId('brush-preview')).toHaveTextContent('39px');
    expect(screen.getByRole('status')).toHaveTextContent('1 项更改待保存');
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存偏好' }));
    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalledWith({ preferences: expect.objectContaining({ brushSize: 39 }) }));
    await waitFor(() => expect(getUserPreferences().brushSize).toBe(39));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('与已保存设置一致'));
  });
  it('previews profile edits without saving them', () => {
    render(<MemoryRouter initialEntries={['/profile?tab=account']}><SettingsWorkspace currentUser={user} onLogout={vi.fn()} /></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox', { name: '单位 / 团队' }), { target: { value: '木薯实验室' } });
    expect(screen.getByLabelText('资料预览')).toHaveTextContent('木薯实验室');
    expect(screen.getByRole('status')).toHaveTextContent('1 项更改待保存');
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });
});
