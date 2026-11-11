import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExportDesigner from '../ExportDesigner';
import { cacheUserPreferences } from '../../utils/userPreferences';
import { referenceStyle } from '../../utils/exportStyle';
const mocks = vi.hoisted(() => ({ get: vi.fn(), getCorrections: vi.fn() }));
vi.mock('../../services/rest/client', () => ({ default: { get: mocks.get } }));
vi.mock('../../services/api', () => ({ predictionsApi: { getCorrections: mocks.getCorrections } }));
vi.mock('../../utils/feedback', () => ({ message: { error: vi.fn() } }));
vi.setConfig({ testTimeout: 20000 });
const prediction = { id: '18', imageName: 'cassava.jpg' } as any;
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  mocks.get.mockResolvedValue({ data: new Blob(['image']) }); mocks.getCorrections.mockResolvedValue([]);
  URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = vi.fn();
});
describe('quick export', () => {
  it('loads account template and hides detailed controls until requested', async () => {
    const style = { ...referenceStyle, columns: 2, font_size: 42 };
    cacheUserPreferences({ defaultExportTemplate: '论文', exportTemplates: [{ name: '论文', version: 2, style }] });
    render(<ExportDesigner prediction={prediction} count={7} filters={{ search: 'trial' }} onExport={vi.fn()} exporting={false} />);
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(JSON.parse(mocks.get.mock.calls[0][1].params.style)).toMatchObject({ columns: 2, font_size: 42 });
    expect(screen.queryByText('线宽')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '调整本次样式' }));
    expect(screen.getAllByText('线宽')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /模板管理/ })).toHaveAttribute('href', '/profile?tab=export-templates');
  });
  it('requires explicit choice when the saved default template is missing', async () => {
    cacheUserPreferences({ defaultExportTemplate: '不存在', exportTemplates: [] });
    render(<ExportDesigner prediction={prediction} count={3} filters={{}} onExport={vi.fn()} exporting={false} />);
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(await screen.findByText(/默认模板已不可用/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '导出' }).some(button => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '使用参考样式' }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(screen.queryByText(/默认模板已不可用/)).not.toBeInTheDocument();
  });
});
