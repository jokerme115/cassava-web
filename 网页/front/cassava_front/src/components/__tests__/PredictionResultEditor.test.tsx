import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import PredictionResultEditor from '../PredictionResultEditor';
import { predictionsApi } from '../../services/api';

vi.mock('../../services/api', () => ({
  predictionsApi: { getEditor: vi.fn(async () => ({ editor_available: true, cassava_mask_url: '/cassava', rotten_mask_url: '/rotten', original_image_url: '/original', corrections: [] })), saveCorrection: vi.fn() },
  resolveFileUrl: (url: string) => url,
}));
vi.mock('../../utils/correctionDrafts', () => ({ readDraft: vi.fn(async () => undefined), writeDraft: vi.fn(async () => {}), removeDraft: vi.fn(async () => {}) }));
const confirmSpy = vi.hoisted(() => vi.fn());
vi.mock('antd', () => ({
  message: { warning: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
  Modal: { confirm: (options: any) => { confirmSpy(options); options?.onCancel?.(); } },
}));

describe('manual correction protection', () => {
  beforeEach(() => {
    confirmSpy.mockClear();
    class RasterImage {
      naturalWidth = 2;
      naturalHeight = 2;
      onload: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', RasterImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      drawImage: vi.fn(), clearRect: vi.fn(), putImageData: vi.fn(), fillRect: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(16).fill(255) }),
      createImageData: () => ({ data: new Uint8ClampedArray(16) }),
    }) as any);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('does not close unsaved changes when the user cancels the exit prompt', async () => {
    const close = vi.fn();
    render(<PredictionResultEditor prediction={{ id: '1', imageUrl: '/original', imageName: 'sample', ppdValue: 0 } as any} onClose={close} onSaved={vi.fn()} />);
    const note = await screen.findByLabelText('校正备注');
    fireEvent.change(note, { target: { value: '保留尚未保存的修改' } });
    fireEvent.click(screen.getByLabelText('关闭编辑器'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(close).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('有未保存修改 · 草稿自动暂存')).toBeInTheDocument());
  });

  it('prevents creating an unchanged correction version', async () => {
    render(<PredictionResultEditor prediction={{ id: '2', imageUrl: '/original', imageName: 'sample', ppdValue: 0 } as any} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByRole('button', { name: '保存人工校正版本' })).toBeDisabled();
  });
  it('saves rotation through undo/redo while retaining the original mask dimensions', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })));
    vi.mocked(predictionsApi.saveCorrection).mockResolvedValueOnce({ version: 1, ppd_percent: 100, edit_data: { rotation_degrees: 90 } } as any);
    render(<PredictionResultEditor prediction={{ id: 'rotation', imageUrl: '/original', imageName: 'sample', ppdValue: 0 } as any} onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByLabelText('校正备注');
    fireEvent.click(screen.getByLabelText('向右旋转90度'));
    expect(screen.getByText('90°')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.getByText('0°')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(screen.getByText('90°')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(predictionsApi.saveCorrection).toHaveBeenCalled());
    const calls = vi.mocked(predictionsApi.saveCorrection).mock.calls;
    const form = calls[calls.length - 1][1];
    expect(JSON.parse(String(form.get('edit_data')))).toMatchObject({ rotation_degrees: 90, width: 2, height: 2 });
  });

  it('uses arrow shortcuts but does not navigate while editing a note or beyond a boundary', async () => {
    const navigate = vi.fn();
    render(<PredictionResultEditor prediction={{ id: 'keys', imageUrl: '/original', imageName: 'sample', ppdValue: 0 } as any} onClose={vi.fn()} onSaved={vi.fn()} onNavigate={navigate} canPrevious={false} canNext />);
    const note = await screen.findByLabelText('校正备注');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(note, { key: 'ArrowRight' });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(navigate).toHaveBeenCalledWith(1);
  });

});
