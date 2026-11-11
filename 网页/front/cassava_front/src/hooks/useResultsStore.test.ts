import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useResultsStore } from './useResultsStore';

const mocks = vi.hoisted(() => ({ getAll: vi.fn(), get: vi.fn() }));
vi.mock('../services/api', () => ({ predictionsApi: { getAll: mocks.getAll } }));
vi.mock('../services/rest/client', () => ({ default: { get: mocks.get } }));

describe('server-paginated results', () => {
  it('replaces each page, keeps the filter on the server and ignores a stale page response', async () => {
    mocks.get.mockResolvedValue({ data: { total: 141, avg: 5 } });
    let resolveOld!: (value: any) => void;
    mocks.getAll.mockImplementation((query: any) => query.page === 1
      ? new Promise(resolve => { resolveOld = resolve; })
      : Promise.resolve({ count: 141, results: [{ id: 'second-page', original_image_name: '后续结果', ppd_value: 2 }] }));
    const user = { id: 16 };
    const { result, rerender } = renderHook(({ page }) => useResultsStore(user, '106', '相机', 'low', 'unreviewed', page, 48), { initialProps: { page: 1 } });
    rerender({ page: 2 });
    await waitFor(() => expect(result.current.results[0]?.id).toBe('second-page'));
    await act(async () => { resolveOld({ count: 141, results: [{ id: 'stale-page' }] }); });
    expect(result.current.results.map(item => item.id)).toEqual(['second-page']);
    expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, page_size: 48, task_id: '106', search: '相机', status: 'low', review_status: 'unreviewed' }));
    expect(result.current.totalCount).toBe(141);
  });
  it('recovers a no-longer-valid saved page instead of leaving a stale list', async () => {
    mocks.get.mockResolvedValue({ data: { total: 2 } });
    mocks.getAll.mockRejectedValueOnce({ response: { status: 404 } });
    const recover = vi.fn();
    const user = { id: 16 };
    const { result } = renderHook(() => useResultsStore(user, '106', '', 'all', 'all', 3, 48, recover));
    await waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
    expect(result.current.loading).toBe(false);
    expect(result.current.results).toEqual([]);
  });

});
