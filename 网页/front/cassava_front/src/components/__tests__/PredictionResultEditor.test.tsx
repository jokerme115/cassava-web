import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import PredictionResultEditor from '../PredictionResultEditor';

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
});
