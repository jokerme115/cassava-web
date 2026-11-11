import type { PaginatedResponse } from './client';
import api, { toPaginatedResult, unwrapApiData } from './client';
import { normalizePredictionResult } from './normalizers';
import type { PredictionResult } from '../../types';

// === Predictions API ===
export const predictionsApi = {
  completeReview: (id: string, version: number) => api.post(`/predictions/${id}/review/`, { version }),
  getAll: (params?: any): Promise<PaginatedResponse<PredictionResult>> =>
    api.get('/predictions/', { params }).then(res => {
      const parsed = toPaginatedResult<any>(res.data);
      return {
        ...parsed,
        results: parsed.results.map(normalizePredictionResult),
      };
    }),
  getById: (id: string): Promise<PredictionResult> =>
    api.get(`/predictions/${id}/`).then(res => normalizePredictionResult(unwrapApiData<any>(res.data))),
  getEditor: (id: string): Promise<any> =>
    api.get(`/predictions/${id}/editor/`).then(res => unwrapApiData<any>(res.data)),
  getCorrections: (id: string): Promise<any[]> =>
    api.get(`/predictions/${id}/corrections/`).then(res => unwrapApiData<any[]>(res.data)),
  saveCorrection: (id: string, data: FormData): Promise<any> =>
    api.post(`/predictions/${id}/corrections/`, data).then(res => unwrapApiData<any>(res.data)),
  getByTaskId: (taskId: string): Promise<PaginatedResponse<PredictionResult>> =>
    api.get('/predictions/', { params: { task_id: taskId } }).then(res => {
      const parsed = toPaginatedResult<any>(res.data);
      return {
        ...parsed,
        results: parsed.results.map(normalizePredictionResult),
      };
    }),
  export: (params: { file_type: 'csv' | 'xlsx' | 'zip'; task_id?: string; search?: string; status?: string; review_status?: string; style?: string; version?: string; result_ids?: string }) =>
    api.get('/predictions/export/', { params, responseType: 'blob', timeout: 300000 }),
  getOverlay: (id: string, version: number): Promise<Blob> =>
    api.get(`/predictions/${id}/overlay/`, { params: { version }, responseType: 'blob' }).then(res => res.data),
};
