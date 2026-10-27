import api, { parseListResult, unwrapApiData } from './client';
import type { ListResult } from './client';
import { normalizeFolder, normalizeImage } from './normalizers';
import type { Folder, Image } from '../../types';

// === Images API ===
export const imagesApi = {
  getAll: (params?: any): Promise<ListResult<Image>> => api.get('/images/', { params }).then(res => {
    const parsed = parseListResult<any>(res.data);
    return { ...parsed, items: parsed.items.map(normalizeImage) };
  }),
  getById: (id: string): Promise<Image> => api.get(`/images/${id}/`).then(res => {
    return normalizeImage(unwrapApiData<any>(res.data));
  }),
  upload: (data: FormData): Promise<Image> => api.post('/images/', data),
  uploadFiles: (data: FormData): Promise<any> => api.post('/images/upload-files/', data).then(res => res.data),
  uploadBatch: (data: FormData): Promise<any> => api.post('/images/upload-batch/', data).then(res => res.data),
  update: (id: string, data: any): Promise<Image> => api.patch(`/images/${id}/`, data).then(res => {
    return normalizeImage(unwrapApiData<any>(res.data));
  }),
  delete: (id: string): Promise<void> => api.delete(`/images/${id}/`),
};

// === Folders API ===
export const foldersApi = {
  getAll: (params?: any): Promise<ListResult<Folder>> => api.get('/folders/', { params }).then(res => {
    const parsed = parseListResult<any>(res.data);
    return { ...parsed, items: parsed.items.map(normalizeFolder) };
  }),
  getById: (id: string): Promise<Folder> => api.get(`/folders/${id}/`).then(res => {
    return normalizeFolder(unwrapApiData<any>(res.data));
  }),
  create: (folder: Partial<Folder>): Promise<Folder> => api.post('/folders/', folder).then(res => {
    return normalizeFolder(unwrapApiData<any>(res.data));
  }),
  update: (id: string, folder: Partial<Folder>): Promise<Folder> => api.patch(`/folders/${id}/`, folder).then(res => {
    return normalizeFolder(unwrapApiData<any>(res.data));
  }),
  delete: (id: string): Promise<void> => api.delete(`/folders/${id}/`),
  getImages: (id: string): Promise<Image[]> =>
    api.get(`/folders/${id}/images/`).then(res => unwrapApiData<Image[]>(res.data)).then(data => data.map(normalizeImage)),
  addImages: (id: string, imageIds: string[]): Promise<any> =>
    api.post(`/folders/${id}/add_images/`, { image_ids: imageIds }).then(res => unwrapApiData<any>(res.data)),
  deleteWithStrategy: (id: string, data: { strategy: 'keep' | 'delete' | 'move'; target_folder_id?: string }): Promise<any> =>
    api.post(`/folders/${id}/delete_with_strategy/`, data).then(res => unwrapApiData<any>(res.data)),
};

// === Segmentations API ===
export const segmentationsApi = {
  getAll: (params?: any): Promise<any[]> => api.get('/segmentations/', { params }).then(res => res.data),
  getById: (id: string): Promise<any> => api.get(`/segmentations/${id}/`).then(res => res.data),
  create: (data: any): Promise<any> => api.post('/segmentations/', data).then(res => res.data),
  update: (id: string, data: any): Promise<any> => api.put(`/segmentations/${id}/`, data).then(res => res.data),
  delete: (id: string): Promise<void> => api.delete(`/segmentations/${id}/`),
};
