import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ImportWorkspace from '../ImportWorkspace';
import type { ImportJob } from '../../utils/importProgress';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../services/rest/client', () => ({ default: mocks }));
vi.mock('../../utils/workspaceContext', () => ({ useWorkspace: () => ({ folder: null, lastWritableFolder: null }), folderPath: () => '未分类', updateWorkspace: vi.fn() }));
vi.mock('../../utils/feedback', () => ({ message: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

let job: ImportJob;
beforeEach(() => {
  vi.clearAllMocks();
  job = { id: 1, task_id: 1, state: 'uploading', error: '', target_folder: null, destination_folder: null,
    options: { resolved_name: '样本' }, summary: {},
    items: [{ id: 1, relative_path: 'sample.zip', size: 2 * 1024**2, offset: 0, state: 'uploading', error: '', chunk_hashes: [] }],
    transfer: { total_files: 1, completed_files: 0, bytes_total: 2 * 1024**2, bytes_received: 0,
      has_archive: true, files: [{ relative_path: 'sample.zip', size: 2 * 1024**2, offset: 0 }] } };
  mocks.get.mockImplementation(async url => ({ data: url === '/imports/' ? [job] : job }));
  mocks.post.mockImplementation(async () => ({ data: job }));
});

async function startZip(container: HTMLElement) {
  const file = new File([new Uint8Array(2 * 1024**2)], 'sample.zip', { type: 'application/zip' });
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } });
  fireEvent.click(await screen.findByRole('button', { name: '开始上传' }));
}

describe('ImportWorkspace feedback', () => {
  it('restores source size and a resume action without pretending to be uploading', async () => {
    render(<ImportWorkspace folders={[]} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '导入任务' }));
    expect(await screen.findByText('上传未完成')).toBeInTheDocument();
    expect(screen.getByText('sample.zip · 2.0 MB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择原文件续传' })).toBeInTheDocument();
    expect(screen.queryByText('正在上传压缩包')).not.toBeInTheDocument();
  });

  it('keeps network interruption visible on the task after polling', async () => {
    mocks.post.mockImplementation(async (url, data) => {
      if (url.endsWith('/chunk/')) throw { code: 'ERR_NETWORK' };
      if (url.endsWith('/pause/')) job.error = data.reason;
      return { data: job };
    });
    const { container } = render(<ImportWorkspace folders={[]} onComplete={vi.fn()} />);
    await startZip(container);
    expect(await screen.findByText('网络连接中断，已接收部分保留，请重新选择原文件续传')).toBeInTheDocument();
    expect(screen.getByText('上传未完成')).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledWith('/imports/1/pause/', expect.objectContaining({ reason: expect.stringContaining('网络连接中断') }));
  });

  it('shows transmitted bytes before server acknowledgement and uses 1MB chunks', async () => {
    let acknowledge!: () => void;
    let calls = 0;
    mocks.post.mockImplementation(async (url, data, config) => {
      if (url.endsWith('/chunk/')) {
        expect(data.get('chunk').size).toBe(1024**2);
        if (calls++ === 0) {
          config.onUploadProgress({ loaded: 512 * 1024 });
          await new Promise<void>(resolve => { acknowledge = resolve; });
          return { data: { offset: 1024**2 } };
        }
        return { data: { offset: 2 * 1024**2 } };
      }
      if (url.endsWith('/finalize/')) job = { ...job, state: 'queued' };
      return { data: job };
    });
    const { container } = render(<ImportWorkspace folders={[]} onComplete={vi.fn()} />);
    await startZip(container);
    expect(await screen.findByText(/已发送 512.0 KB \/ 2.0 MB/)).toBeInTheDocument();
    expect(screen.getByText('服务器已接收 0 B / 2.0 MB')).toBeInTheDocument();
    acknowledge();
    await waitFor(() => expect(screen.getByText('等待服务器处理')).toBeInTheDocument());
  });
});
