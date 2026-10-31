import { describe, it, expect } from 'vitest';
import { importStage, stagePercent, importUploadError, type ImportJob, type TransferActivity } from './importProgress';
const job: ImportJob = { id: 1, task_id: 1, state: 'uploading', error: '', items: [], target_folder: null,
  destination_folder: null, options: {}, summary: {}, transfer: { bytes_total: 1000, bytes_received: 0,
    total_files: 1, completed_files: 0, has_archive: true, files: [] } };
describe('import progress', () => {
  it('does not claim a restored incomplete upload is currently transmitting', () => {
    expect(importStage(job)).toBe('paused');
    expect(stagePercent(job)).toBe(0);
  });
  it('separates transmitted bytes from server acknowledgement', () => {
    const active: TransferActivity = { id: 1, phase: 'uploading', file: 'a.zip', sent: 250, confirmed: 0, total: 1000, speed: 20 };
    expect(importStage(job, active)).toBe('uploading');
    expect(stagePercent(job, active)).toBe(25);
    expect(job.transfer?.bytes_received).toBe(0);
  });
  it('shows extraction progress independently from completed upload bytes', () => {
    const extracting = { ...job, state: 'running', progress: { stage: 'extracting', current_file: '中文/a.png', completed: 3, total: 10 } };
    expect(importStage(extracting)).toBe('extracting');
    expect(stagePercent(extracting)).toBe(30);
  });
  it('keeps unknown scan/queue duration indeterminate', () => {
    expect(stagePercent({ ...job, state: 'queued' })).toBeNull();
    expect(stagePercent({ ...job, state: 'running', progress: { stage: 'scanning', current_file: 'a.zip', completed: 0 } })).toBeNull();
  });
  it('does not show complete while verifying or after cancellation', () => {
    expect(importStage({ ...job, transfer: { ...job.transfer!, bytes_received: 1000 }, progress: { stage: 'verifying', current_file: 'a.zip', completed: 10, total: 1000 } })).toBe('verifying');
    expect(importStage({ ...job, state: 'cancelled' })).toBe('cancelled');
  });
  it('translates network interruptions into a resumable explanation', () => {
    expect(importUploadError({ code: 'ERR_NETWORK' })).toContain('网络连接中断');
    expect(importUploadError({ code: 'ECONNABORTED' })).toContain('上传超时');
  });
});
