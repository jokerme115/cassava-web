import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PredictionModule from '../PredictionModule';

const createTask = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'new' }));
const mockState = vi.hoisted(() => ({ folders: [] as any[] }));
vi.mock('../../hooks/useTaskStore', () => ({ useTaskStore: () => ({ createTask }) }));
vi.mock('../../hooks/useImageStore', () => ({ useImageStore: () => ({
  images: [{ id: '55', name: 'sample.png', url: '/sample.png', size: 10 }],
  folders: mockState.folders, loading: false, hasMoreImages: false, loadingMoreImages: false,
}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('antd', () => ({
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
    render(<PredictionModule />);
    expect(screen.getByRole('option', { name: '有监督模型' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '半监督模型' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '投票模型' }));
    expect(screen.getByRole('combobox', { name: 'prediction.model' })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'prediction.create_task' }));
    fireEvent.click(screen.getByRole('button', { name: 'prediction.confirm' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      modelType: 'ensemble', single_model_type: 'ensemble', predictionMode: 'ensemble',
      selectionType: 'images', selectedItems: ['55'],
      parameters: expect.objectContaining({ predictionMode: 'ensemble', use_ensemble: true }),
    })));
  });

  it('submits a whole selected folder in one click without selecting images', async () => {
    mockState.folders = [{ id: 'f1', name: '根文件夹', parent: null, imageCount: 3 }];
    render(<PredictionModule />);
    fireEvent.click(screen.getByRole('button', { name: 'pick-folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'prediction.submit_folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'prediction.confirm' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      selectionType: 'folders', selectedItems: ['f1'], imageCount: 3,
    })));
  });
});
