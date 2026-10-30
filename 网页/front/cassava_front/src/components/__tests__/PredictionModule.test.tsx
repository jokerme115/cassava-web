import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PredictionModule from '../PredictionModule';

const createTask = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'new' }));
const mockState = vi.hoisted(() => ({ folders: [] as any[] }));
vi.mock('../../hooks/useTaskStore', () => ({ useTaskStore: () => ({ createTask }) }));
vi.mock('../../hooks/useImageStore', () => ({ useImageStore: () => { const [selectedFolder, setSelectedFolder] = React.useState<string | null>(null); return ({
  selectedFolder, setSelectedFolder, setImageSearchQuery: vi.fn(), setImageOrdering: vi.fn(), goToImagesPage: vi.fn(), imagesPage: 1, imagesPageSize: 48, totalImages: 1,
  images: [{ id: '55', name: 'sample.png', url: '/sample.png', size: 10 }],
  folders: mockState.folders, loading: false, hasMoreImages: false, loadingMoreImages: false,
}); } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../services/rest/client', () => ({ default: { get: vi.fn().mockResolvedValue({ data: [
  { id: 'pbt_c512', label: 'PBT SegFormer-B2 · c512 五种子', available: true },
  { id: 'm6_best', label: 'M6 半监督 · fold1（历史部署版）', available: true },
] }) } }));
vi.mock('antd', () => ({
  Modal: {},
  Pagination: () => null,
  message: { success: vi.fn(), error: vi.fn() },
  // 测试用树：点击按钮等价于在文件夹树中选中 f1
  Tree: (props: any) => React.createElement('button', { onClick: () => props.onSelect(['f1']) }, 'pick-folder'),
}));

describe('prediction configuration', () => {
  beforeEach(() => {
    createTask.mockClear();
    mockState.folders = [];
  });

  it('shows plain model names and submits a real ensemble mode with both members', async () => {
    render(<MemoryRouter><PredictionModule /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('option', { name: /PBT SegFormer/ })).toBeInTheDocument());
    expect(screen.getByRole('option', { name: /M6 半监督/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '投票模型' }));
    expect(screen.getByRole('combobox', { name: 'prediction.model' })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'prediction.create_task' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      modelType: 'ensemble', single_model_type: 'ensemble', predictionMode: 'ensemble',
      selectionType: 'images', selectedItems: ['55'],
      parameters: expect.objectContaining({ predictionMode: 'ensemble', use_ensemble: true }),
    })));
  });

  it('submits a whole selected folder in one click without selecting images', async () => {
    mockState.folders = [{ id: 'f1', name: '根文件夹', parent: null, imageCount: 3 }];
    render(<MemoryRouter><PredictionModule /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'pick-folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'prediction.create_task' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      selectionType: 'folders', selectedItems: ['f1'], imageCount: 3,
    })));
  });

  it('requires a task name before direct submission', async () => {
    render(<MemoryRouter><PredictionModule /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('option', { name: /PBT SegFormer/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 sample.png' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'prediction.task_name' }), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'prediction.create_task' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入任务名称');
    expect(createTask).not.toHaveBeenCalled();
  });
});
