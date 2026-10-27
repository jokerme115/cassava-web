import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PredictionModule from '../PredictionModule';

const createTask = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'new' }));
vi.mock('../../hooks/useTaskStore', () => ({ useTaskStore: () => ({ createTask }) }));
vi.mock('../../hooks/useImageStore', () => ({ useImageStore: () => ({
  images: [{ id: '55', name: 'sample.png', url: '/sample.png', size: 10 }],
  folders: [], loading: false, hasMoreImages: false, loadingMoreImages: false,
}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('antd', () => ({ message: { success: vi.fn(), error: vi.fn() }, Tree: () => null }));

describe('prediction configuration', () => {
  it('shows versions and submits a real ensemble mode with both members', async () => {
    render(<PredictionModule />);
    expect(screen.getByRole('option', { name: /V1.0/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /V1.1/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '多模型投票' }));
    expect(screen.getByRole('combobox', { name: 'prediction.model' })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'prediction.create_task' }));
    fireEvent.click(screen.getByRole('button', { name: 'prediction.confirm' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      modelType: 'ensemble', single_model_type: 'ensemble', predictionMode: 'ensemble',
      parameters: expect.objectContaining({ predictionMode: 'ensemble', use_ensemble: true }),
    })));
  });
});
