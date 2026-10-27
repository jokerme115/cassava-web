import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ResultsCenter from '../ResultsCenter';

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
    const view = render(<ResultsCenter />);
    fireEvent.click(screen.getByRole('button', { name: /second.*2.00%/ }));
    expect(screen.getByTestId('active-editor')).toHaveTextContent('2');
    state.results = state.results.map((item) => ({ ...item }));
    view.rerender(<ResultsCenter />);
    await waitFor(() => expect(screen.getByTestId('active-editor')).toHaveTextContent('2'));
  });
});
