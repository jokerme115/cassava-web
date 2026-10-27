import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ResultsCenter from '../ResultsCenter';

const renderPage = () => render(<MemoryRouter><ResultsCenter /></MemoryRouter>);

const state = vi.hoisted(() => ({ results: [
  { id: '1', imageName: 'first', imageUrl: '/first', taskId: 'task', ppdValue: 0, ppd_unit: 'percent' },
  { id: '2', imageName: 'second', imageUrl: '/second', taskId: 'task', ppdValue: 2, ppd_unit: 'percent' },
] }));
vi.mock('../../hooks/useResultsStore', () => ({ useResultsStore: () => ({ results: state.results, loading: false, exporting: false, totalCount: 2, exportResults: vi.fn() }) }));
vi.mock('../../hooks/useTaskStore', () => ({ useTaskStore: () => ({ tasks: [], loading: false }) }));
vi.mock('../../services/api', () => ({ resolveFileUrl: (value: string) => value, predictionsApi: { getOverlay: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../PredictionResultEditor', () => ({ default: ({ prediction }: any) => <div data-testid="active-editor">{prediction.id}</div> }));

describe('result identity after reload', () => {
  it('keeps the selected image when a refreshed result list arrives', async () => {
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: /second.*2.00%/ }));
    expect(screen.getByTestId('active-editor')).toHaveTextContent('2');
    state.results = state.results.map((item) => ({ ...item }));
    view.rerender(<MemoryRouter><ResultsCenter /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('active-editor')).toHaveTextContent('2'));
  });
});


describe('voting scores', () => {
  it('opens the real score panel without entering the correction editor', () => {
    state.results = [{ ...state.results[0], ensemble_details: {
      method: 'pixel_vote_probability_tiebreak', agreement_percent: 73.33, disagreement_pixels: 6492,
      members: [{ model: 'resnet101', label: 'V1.0', ppd_percent: 0 }, { model: 'm6_best', label: 'V1.1', ppd_percent: 25.98 }],
    } } as any];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'results.vote_detail' }));
    expect(screen.getByText('有监督模型 PPD')).toBeInTheDocument();
    expect(screen.getByText('25.98%')).toBeInTheDocument();
    expect(screen.getByText('73.33%')).toBeInTheDocument();
    expect(screen.queryByTestId('active-editor')).not.toBeInTheDocument();
  });
});
