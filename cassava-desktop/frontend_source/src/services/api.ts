import axios from 'axios';
import { Image, Folder, PredictionResult, SystemSetting } from '../types';

const RAW_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  '/api';

const isLoopbackUrl = (value: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(value);

const browserHostIsLocal = () => {
  if (typeof window === 'undefined') return true;
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(window.location.hostname);
};

export const API_BASE_URL =
  !browserHostIsLocal() && isLoopbackUrl(RAW_API_BASE_URL)
    ? '/api'
    : RAW_API_BASE_URL;

export const API_ORIGIN = API_BASE_URL.startsWith('http')
  ? API_BASE_URL.replace(/\/api\/?$/, '')
  : '';

export const resolveFileUrl = (value: string) => {
  if (!value) return '';
  if (value.startsWith('http')) return value;
  if (value.startsWith('/')) {
    return API_ORIGIN ? `${API_ORIGIN}${value}` : value;
  }
  const normalized = value.replace(/^\/+/, '');
  return API_ORIGIN ? `${API_ORIGIN}/media/${normalized}` : `/media/${normalized}`;
};

const API_TIMEOUT =
  Number(import.meta.env.VITE_API_TIMEOUT) > 0
    ? Number(import.meta.env.VITE_API_TIMEOUT)
    : 60000;

type ApiEnvelope<T> = {
  success: boolean;
  message?: string;
  data: T;
  error?: string;
  detail?: any;
};

type ListResult<T> = {
  items: T[];
  next?: string | null;
  count?: number;
};

type PaginatedResponse<T> = {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results: T[];
};

const unwrapApiData = <T>(payload: any): T => {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

const parseListResult = <T>(payload: any): ListResult<T> => {
  const unwrapped = unwrapApiData<any>(payload);
  if (Array.isArray(unwrapped)) {
    return { items: unwrapped as T[] };
  }
  if (unwrapped && typeof unwrapped === 'object' && Array.isArray(unwrapped.results)) {
    return {
      items: unwrapped.results as T[],
      next: unwrapped.next ?? null,
      count: typeof unwrapped.count === 'number' ? unwrapped.count : undefined,
    };
  }
  return { items: [] };
};

const toPaginatedResult = <T>(payload: any): PaginatedResponse<T> => {
  const parsed = parseListResult<T>(payload);
  return {
    count: parsed.count ?? parsed.items.length,
    next: parsed.next ?? null,
    previous: null,
    results: parsed.items,
  };
};

const toIdString = (value: any): string | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'object') {
    const v = (value as any).id ?? (value as any).pk;
    if (v === null || v === undefined) return undefined;
    return typeof v === 'string' ? v : String(v);
  }
  return String(value);
};

const normalizeImage = (img: any): Image => ({
  ...img,
  id: String(img?.id ?? img?.pk ?? ''),
  url: img?.url ?? img?.preview_url ?? img?.image_url ?? '',
  image_url: img?.image_url,
  preview_url: img?.preview_url,
  folderId: toIdString(img.folderId ?? img.folder ?? img.folder_id),
  created_time: img.created_time ?? img.created_at,
  uploadDate: img.uploadDate ?? img.created_at,
});

const normalizeFolder = (f: any): Folder => ({
  ...f,
  id: String(f?.id ?? f?.pk ?? f?.folder_id ?? f?.resource_id ?? ''),
  imageCount: f.imageCount ?? f.image_count ?? f.num_images ?? 0,
  createdDate: f.createdDate ?? f.created_at,
  parent: toIdString(f.parent ?? f.parent_id),
});

const normalizeTask = (task: any) => {
  const imageIds = Array.isArray(task?.image_ids) ? task.image_ids : [];
  const parameters = task?.parameters ?? {};
  const errorMessage = task?.errorMessage ?? task?.error_message ?? task?.error ?? '';

  return {
    ...task,
    id: String(task?.id ?? task?.pk ?? ''),
    errorMessage,
    error_message: errorMessage,
    modelType:
      task?.modelType ??
      task?.model_type ??
      task?.algorithm ??
      task?.single_model_type ??
      '',
    imageCount:
      task?.imageCount ??
      task?.image_count ??
      imageIds.length,
    createdDate: task?.createdDate ?? task?.created_time ?? task?.created_at,
    completedDate:
      task?.completedDate ??
      task?.completed_time ??
      task?.updated_time ??
      task?.updated_at,
    parameters: {
      confidenceThreshold:
        parameters?.confidenceThreshold ??
        task?.threshold ??
        0.5,
      usePostProcessing:
        parameters?.usePostProcessing ??
        task?.method === 'post',
      useTTA: parameters?.useTTA ?? false,
      minArea:
        parameters?.minArea ??
        task?.min_size ??
        100,
      morphKernelSize:
        parameters?.morphKernelSize ??
        task?.morph_kernel_size ??
        5,
      morphIterations:
        parameters?.morphIterations ??
        task?.morph_iterations ??
        1,
      overlayOpacity:
        parameters?.overlayOpacity ??
        0.5,
      stage1Confidence:
        parameters?.stage1Confidence ??
        task?.stage1_confidence ??
        undefined,
      stage2Confidence:
        parameters?.stage2Confidence ??
        task?.stage2_confidence ??
        undefined,
      roiPadding:
        parameters?.roiPadding ??
        task?.roi_padding ??
        undefined,
      fallbackRoiPadding:
        parameters?.fallbackRoiPadding ??
        task?.fallback_roi_padding ??
        undefined,
      expectedCount:
        parameters?.expectedCount ??
        task?.expected_count ??
        undefined,
      stageBoxIou:
        parameters?.stageBoxIou ??
        task?.stage_box_iou ??
        undefined,
      patchSize:
        parameters?.patchSize ??
        task?.patch_size ??
        undefined,
      stride:
        parameters?.stride ??
        task?.stride ??
        undefined,
    },
  };
};

const normalizePredictionResult = (result: any): PredictionResult => ({
  ...result,
  id: String(result?.id ?? result?.pk ?? ''),
  taskId: toIdString(
    result?.taskId ??
    result?.task_id ??
    result?.processing_task ??
    result?.processing_task_id ??
    result?.processingTaskId
  ) ?? '',
  imageName: result?.imageName ?? result?.image_name ?? result?.original_image_name ?? '',
  imageUrl: result?.imageUrl ?? result?.image_url ?? result?.original_image_url ?? '',
  ppdValue: Number(result?.ppdValue ?? result?.ppd_value ?? 0),
  confidence: typeof result?.confidence === 'number' ? result.confidence : 1,
  prediction: result?.prediction ?? '',
  processingTime: Number(result?.processingTime ?? result?.prediction_time ?? 0),
  folderId: result?.folderId ?? result?.folder_id ?? result?.original_image_folder_id ?? null,
  folderName: result?.folderName ?? result?.folder_name ?? result?.original_image_folder_name ?? null,
  overlayImageUrl: result?.overlayImageUrl ?? result?.result_image_url ?? '',
  subPpdValues: result?.subPpdValues ?? result?.sub_ppd_values ?? [],
  errorCode: result?.errorCode ?? result?.error_code,
  errorMessage: result?.errorMessage ?? result?.error_message,
  vis_images: result?.vis_images ?? {},
  split_count: result?.split_count ?? result?.splitCount ?? 0,
});

const normalizeSystemSetting = (s: any): SystemSetting => ({
  ...s,
  maxDisplayImages: s.maxDisplayImages ?? s.max_display_images ?? 200,
  maxDisplayResults: s.maxDisplayResults ?? s.max_display_results ?? 100,
  siteTitle: s.siteTitle ?? s.site_title ?? '',
  siteAnnouncement: s.siteAnnouncement ?? s.site_announcement ?? '',
  announcementLevel: s.announcementLevel ?? s.announcement_level,
  enableGuestAccess: s.enableGuestAccess ?? s.enable_guest_access ?? true,
  allowRegistration: s.allowRegistration ?? s.allow_registration ?? true,
  maintenanceMode: s.maintenanceMode ?? s.maintenance_mode ?? false,
  uploadSizeLimitMb: s.uploadSizeLimitMb ?? s.upload_size_limit_mb,
  guestDataRetentionDays: s.guestDataRetentionDays ?? s.guest_data_retention_days,
  auditLogRetentionDays: s.auditLogRetentionDays ?? s.audit_log_retention_days,
  updatedAt: s.updatedAt ?? s.updated_at,
  updatedBy: s.updatedBy ?? s.updated_by,
  site_title: s.site_title ?? s.siteTitle ?? '',
  site_announcement: s.site_announcement ?? s.siteAnnouncement ?? '',
  announcement_level: s.announcement_level ?? s.announcementLevel,
  enable_guest_access: s.enable_guest_access ?? s.enableGuestAccess ?? true,
  allow_registration: s.allow_registration ?? s.allowRegistration ?? true,
  maintenance_mode: s.maintenance_mode ?? s.maintenanceMode ?? false,
  upload_size_limit_mb: s.upload_size_limit_mb ?? s.uploadSizeLimitMb,
  guest_data_retention_days: s.guest_data_retention_days ?? s.guestDataRetentionDays,
  audit_log_retention_days: s.audit_log_retention_days ?? s.auditLogRetentionDays,
  updated_at: s.updated_at ?? s.updatedAt,
  updated_by: s.updated_by ?? s.updatedBy,
});

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  withCredentials: true,
});

// 桌面单用户模式：移除认证拦截器
// api.interceptors.request.use();
// api.interceptors.response.use();

// === Images API ===
export const imagesApi = {
  getAll: (params?: any, options?: { signal?: AbortSignal }): Promise<ListResult<Image>> => api.get('/images/', { ...options, params }).then(res => {
    const parsed = parseListResult<any>(res.data);
    return { ...parsed, items: parsed.items.map(normalizeImage) };
  }),
  getAllPages: async (params?: any): Promise<ListResult<Image>> => {
    const pageSize = Number(params?.page_size) > 0 ? Number(params.page_size) : 1000;
    let page = Number(params?.page) > 0 ? Number(params.page) : 1;
    let next: string | null | undefined = null;
    let count: number | undefined;
    let items: Image[] = [];

    do {
      const res = await imagesApi.getAll({ ...params, page, page_size: pageSize });
      items = [...items, ...res.items];
      next = res.next;
      if (typeof res.count === 'number') count = res.count;
      page += 1;
    } while (next);

    return { items, count: count ?? items.length, next: null };
  },
  getById: (id: string): Promise<Image> => api.get(`/images/${id}/`).then(res => {
    return normalizeImage(unwrapApiData<any>(res.data));
  }),
  upload: (data: FormData): Promise<Image> => api.post('/images/', data),
  uploadFiles: (data: FormData): Promise<any> => api.post('/images/upload-files/', data, { timeout: 300000 }).then(res => res.data),
  uploadFilesWithProgress: (data: FormData, onProgress?: (loaded: number, total: number) => void): Promise<any> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/images/upload-files/');
      xhr.timeout = 300000;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(e.loaded, e.total);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            resolve(xhr.responseText);
          }
        } else {
          try {
            reject({ response: { data: JSON.parse(xhr.responseText), status: xhr.status } });
          } catch {
            reject({ response: { data: xhr.responseText, status: xhr.status, statusText: xhr.statusText } });
          }
        }
      };

      xhr.onerror = () => reject(new Error(`Network error (status: ${xhr.status || 'unknown'})`));
      xhr.ontimeout = () => reject(new Error(`Upload timeout (status: ${xhr.status})`));

      xhr.send(data);
    });
  },
  uploadBatch: (data: FormData): Promise<any> => api.post('/images/upload-batch/', data, { timeout: 300000 }).then(res => res.data),
  uploadBatchWithProgress: (data: FormData, onProgress?: (loaded: number, total: number) => void): Promise<any> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/images/upload-batch/');
      xhr.timeout = 300000;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(e.loaded, e.total);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            resolve(xhr.responseText);
          }
        } else {
          try {
            reject({ response: { data: JSON.parse(xhr.responseText), status: xhr.status } });
          } catch {
            reject({ response: { data: xhr.responseText, status: xhr.status, statusText: xhr.statusText } });
          }
        }
      };

      xhr.onerror = () => reject(new Error(`Network error (status: ${xhr.status || 'unknown'})`));
      xhr.ontimeout = () => reject(new Error(`Upload timeout (status: ${xhr.status})`));

      xhr.send(data);
    });
  },
  importLocalImages: (paths: string[], folderId?: string): Promise<any> =>
    api.post('/images/import-local-images/', { paths, folder_id: folderId }, { timeout: 30000 }).then(res => res.data),
  checkFileValidity: (imageIds: string[]): Promise<Record<string, string>> =>
    api.post('/images/check-file-validity/', { image_ids: imageIds }, { timeout: 30000 }).then(res => res.data),
  update: (id: string, data: any): Promise<Image> => api.patch(`/images/${id}/`, data).then(res => {
    return normalizeImage(unwrapApiData<any>(res.data));
  }),
  delete: (id: string): Promise<void> => api.delete(`/images/${id}/`),
  batchDelete: (imageIds: string[]): Promise<{ deleted: number }> => {
    // 前端大小限制，防止意外发送过多数据
    const MAX_BATCH_DELETE = 100;
    if (imageIds.length > MAX_BATCH_DELETE) {
      return Promise.reject(new Error(`单次批量删除最多 ${MAX_BATCH_DELETE} 条记录`));
    }
    return api.post('/images/batch-delete/', { image_ids: imageIds }).then(res => unwrapApiData<{ deleted: number }>(res.data));
  },
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

// === Predictions API ===
export const predictionsApi = {
  getAll: (params?: any): Promise<PaginatedResponse<PredictionResult>> =>
    api.get('/predictions/', { params }).then(res => {
      const parsed = toPaginatedResult<any>(res.data);
      return {
        ...parsed,
        results: parsed.results.map(normalizePredictionResult),
      };
    }),
  getAllPages: async (params?: any): Promise<PaginatedResponse<PredictionResult>> => {
    const pageSize = Number(params?.page_size) > 0 ? Number(params.page_size) : 1000;
    let page = Number(params?.page) > 0 ? Number(params.page) : 1;
    let count: number | undefined;
    let next: string | null | undefined = null;
    let results: PredictionResult[] = [];

    do {
      const res = await predictionsApi.getAll({ ...params, page, page_size: pageSize });
      results = [...results, ...res.results];
      next = res.next;
      if (typeof res.count === 'number') count = res.count;
      page += 1;
    } while (next);

    return { count: count ?? results.length, next: null, previous: null, results };
  },
  getById: (id: string): Promise<PredictionResult> =>
    api.get(`/predictions/${id}/`).then(res => normalizePredictionResult(unwrapApiData<any>(res.data))),
  getByTaskId: (taskId: string): Promise<PaginatedResponse<PredictionResult>> =>
    api.get('/predictions/', { params: { task_id: taskId } }).then(res => {
      const parsed = toPaginatedResult<any>(res.data);
      return {
        ...parsed,
        results: parsed.results.map(normalizePredictionResult),
      };
    }),
};

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
  retry: (id: string): Promise<any> => api.post(`/tasks/${id}/retry/`).then(res => unwrapApiData<any>(res.data)),
  createPredictionTask: (data: any): Promise<any> => api.post('/tasks/', data).then(res => normalizeTask(unwrapApiData<any>(res.data))),
};

export const systemSettingsApi = {
  get: (): Promise<SystemSetting> =>
    api.get('/system/settings/').then(res => normalizeSystemSetting(unwrapApiData<any>(res.data))),
  getPublic: (): Promise<Partial<SystemSetting>> =>
    axios.get(`${API_BASE_URL}/system/settings/public/`).then(res => normalizeSystemSetting(unwrapApiData<any>(res.data))),
  update: (payload: Partial<SystemSetting>): Promise<SystemSetting> => {
    const data: any = {};
    if (payload.maxDisplayImages !== undefined) data.max_display_images = payload.maxDisplayImages;
    if (payload.maxDisplayResults !== undefined) data.max_display_results = payload.maxDisplayResults;
    if (payload.siteTitle !== undefined) data.site_title = payload.siteTitle;
    if (payload.site_title !== undefined) data.site_title = payload.site_title;
    if (payload.siteAnnouncement !== undefined) data.site_announcement = payload.siteAnnouncement;
    if (payload.site_announcement !== undefined) data.site_announcement = payload.site_announcement;
    if (payload.announcementLevel !== undefined) data.announcement_level = payload.announcementLevel;
    if (payload.announcement_level !== undefined) data.announcement_level = payload.announcement_level;
    if (payload.enableGuestAccess !== undefined) data.enable_guest_access = payload.enableGuestAccess;
    if (payload.enable_guest_access !== undefined) data.enable_guest_access = payload.enable_guest_access;
    if (payload.allowRegistration !== undefined) data.allow_registration = payload.allowRegistration;
    if (payload.allow_registration !== undefined) data.allow_registration = payload.allow_registration;
    if (payload.maintenanceMode !== undefined) data.maintenance_mode = payload.maintenanceMode;
    if (payload.maintenance_mode !== undefined) data.maintenance_mode = payload.maintenance_mode;
    if (payload.uploadSizeLimitMb !== undefined) data.upload_size_limit_mb = payload.uploadSizeLimitMb;
    if (payload.upload_size_limit_mb !== undefined) data.upload_size_limit_mb = payload.upload_size_limit_mb;
    if (payload.guestDataRetentionDays !== undefined) data.guest_data_retention_days = payload.guestDataRetentionDays;
    if (payload.guest_data_retention_days !== undefined) data.guest_data_retention_days = payload.guest_data_retention_days;
    if (payload.auditLogRetentionDays !== undefined) data.audit_log_retention_days = payload.auditLogRetentionDays;
    if (payload.audit_log_retention_days !== undefined) data.audit_log_retention_days = payload.audit_log_retention_days;
    return api.patch('/system/settings/', data).then(res => normalizeSystemSetting(unwrapApiData<any>(res.data)));
  },
};

export interface SystemStats {
  total_images: number;
  total_predictions: number;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
}

export const systemStatsApi = {
  get: (): Promise<SystemStats> => api.get('/system/stats/').then(res => unwrapApiData<SystemStats>(res.data)),
};

export default api;
