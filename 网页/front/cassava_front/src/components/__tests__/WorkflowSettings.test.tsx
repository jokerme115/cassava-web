import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import WorkflowSettings from '../WorkflowSettings';
const save = vi.hoisted(() => vi.fn());
vi.mock('../../services/preferences', () => ({ saveUserPreferences: save }));
vi.mock('../../services/rest/client', () => ({ default: { get: vi.fn() } }));
vi.mock('../../utils/feedback', () => ({ message: { success: vi.fn() } }));
vi.setConfig({ testTimeout: 20000 });
describe('account template management', () => {
  it('creates a versioned account template without silently replacing the default', async () => {
    save.mockImplementation(async patch => ({ profile: { preferences: patch } }));
    render(<WorkflowSettings section="export-templates" user={{ id: 2, username: 'user', email: '', is_active: true, profile: { preferences: {} } }} />);
    fireEvent.click(screen.getByRole('button', { name: '新建模板' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '名称' }), { target: { value: '科研图' } });
    fireEvent.click(screen.getByRole('button', { name: '保 存' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({ exportTemplates: [{ name: '科研图', version: 1, style: expect.objectContaining({ font_size: 36, columns: 3 }) }] });
    expect(save.mock.calls[0][0]).not.toHaveProperty('defaultExportTemplate');
  });
});
