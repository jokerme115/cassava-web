import api, { parseListResult, unwrapApiData } from './client';
import type { ListResult } from './client';
import { normalizeTask } from './normalizers';

// === Tasks API ===
export const tasksApi = {
  getAll: (params?: any): Promise<ListResult<any>> => api.get('/tasks/', { params }).then(res => {
    const parsed = parseListResult<any>(res.data);
    return { ...parsed, items: parsed.items.map(normalizeTask) };
  }),
  getById: (id: string): Promise<any> => api.get(`/tasks/${id}/`).then(res => normalizeTask(unwrapApiData<any>(res.data))),
  create: (data: any): Promise<any> => api.post('/tasks/', data).then(res => normalizeTask(unwrapApiData<any>(res.data))),
  update: (id: string, data: any): Promise<any> => api.put(`/tasks/${id}/`, data).then(res => normalizeTask(unwrapApiData<any>(res.data))),
  delete: (id: string): Promise<void> => api.delete(`/tasks/${id}/`),
  cancel: (id: string): Promise<any> => api.post(`/tasks/${id}/cancel/`).then(res => unwrapApiData<any>(res.data)),
  createPredictionTask: (data: any): Promise<any> => api.post('/tasks/', data).then(res => normalizeTask(unwrapApiData<any>(res.data))),
  deleteTask: (id: number|string) => api.delete(`/tasks/${id}/`),
};
