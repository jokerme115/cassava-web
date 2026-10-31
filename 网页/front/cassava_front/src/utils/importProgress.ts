import { getApiErrorMessage } from './apiError';

export function importUploadError(error: unknown) {
  const value = error as { code?: string; response?: { status?: number } };
  if (['ECONNABORTED', 'ETIMEDOUT'].includes(value?.code || '')) return '上传超时，已接收部分保留，请重新选择原文件续传';
  if (value?.code === 'ERR_NETWORK') return '网络连接中断，已接收部分保留，请重新选择原文件续传';
  if (value?.code === 'ERR_CANCELED') return '上传已中断，已接收部分保留';
  if (value?.response?.status === 401) return '登录已失效，请重新登录后续传';
  if ((value?.response?.status || 0) >= 500 || value?.response?.status === 413) return `服务器暂时无法接收分块（${value.response?.status}），已接收部分保留`;
  return getApiErrorMessage(error, '上传中断，请重新选择原文件继续');
}

export interface ImportItem {
  id: number; relative_path: string; size: number; offset: number; state: string; error: string; archive_item?: boolean;
  chunk_hashes: Array<{ offset: number; size: number; sha256: string }>;
}
export interface ImportJob {
  id: number; task_id: number; state: string; error: string; items: ImportItem[];
  target_folder: number | null; destination_folder: number | null; heartbeat?: string | null;
  summary: { total?: number; finished?: number; success?: number; skipped?: number; failed?: number };
  options: { resolved_name?: string };
  transfer?: { bytes_total: number; bytes_received: number; total_files: number; completed_files: number;
    has_archive: boolean; files: Array<{ relative_path: string; size: number; offset: number }> };
  progress?: { stage: string; current_file: string; completed: number; total?: number | null; updated_at?: string };
}
export interface TransferActivity {
  id: number; phase: 'uploading' | 'checking' | 'verifying'; file: string;
  sent: number; confirmed: number; total: number; speed: number;
}
export const terminalImportStates = ['completed', 'partial', 'failed', 'cancelled'];
export const formatImportBytes = (bytes: number) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.max(0, bytes)} B`;
};
export const importStage = (job: ImportJob, active?: TransferActivity | null) => {
  if (terminalImportStates.includes(job.state) || job.state === 'queued') return job.state;
  if (job.state === 'uploading') {
    if (active?.id === job.id) return active.phase;
    if (job.progress?.stage === 'verifying' && job.transfer && job.transfer.bytes_received === job.transfer.bytes_total) return 'verifying';
    return 'paused';
  }
  return job.progress?.stage || 'importing';
};
export const stagePercent = (job: ImportJob, active?: TransferActivity | null): number | null => {
  const stage = importStage(job, active);
  if (stage === 'completed') return 100;
  if (['uploading', 'paused', 'checking'].includes(stage)) {
    const total = active?.id === job.id ? active.total : job.transfer?.bytes_total;
    const bytes = active?.id === job.id ? active.sent : job.transfer?.bytes_received;
    return total ? Math.min(100, Math.floor(1000 * (bytes || 0) / total) / 10) : 0;
  }
  if (stage === 'queued' || stage === 'scanning') return null;
  const progress = job.progress;
  return progress?.total ? Math.min(100, Math.floor(progress.completed / progress.total * 100)) : null;
};
