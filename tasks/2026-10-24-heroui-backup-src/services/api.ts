import { modelLabel } from '../utils/modelLabels';
import axios from 'axios';
import { normalizePpdPercent } from '../utils/measurement';
import { getAuthToken, clearAuthToken } from '../utils/authToken';
import { Image, Folder, PredictionResult, ResourceShare, SystemSetting } from '../types';

const RAW_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  '/api';

const isLoopbackUrl = (value: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(value);

export const API_BASE_URL =
  isLoopbackUrl(RAW_API_BASE_URL)
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

  return {
    ...task,
    id: String(task?.id ?? task?.pk ?? ''),
    modelType: modelLabel(
      task?.modelType ??
      task?.model_type ??
      task?.algorithm ??
      task?.single_model_type ??
      ''),
    imageCount:
      task?.imageCount ??
      task?.image_count ??
      imageIds.length,
    createdDate: task?.createdDate ?? task?.created_time ?? task?.created_at,
    queuePosition: task?.queuePosition ?? task?.queue_position ?? null,
    resultCount: task?.resultCount ?? task?.result_count ?? null,
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

const finiteNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizePredictionResult = (result: any): PredictionResult => {
  const ppdUnit = String(result?.ppd_unit || 'unknown');
  const rawPpd = finiteNumber(result?.ppdValue ?? result?.ppd_value);
  return ({
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
  ppdValue: normalizePpdPercent(rawPpd, ppdUnit),
  ppd_unit: ppdUnit,
  confidence: typeof result?.confidence === 'number' ? result.confidence : null,
  prediction: result?.prediction ?? '',
  processingTime: finiteNumber(result?.processingTime),
  folderId: result?.folderId ?? result?.folder_id ?? result?.original_image_folder_id ?? null,
  folderName: result?.folderName ?? result?.folder_name ?? result?.original_image_folder_name ?? null,
  overlayImageUrl: result?.overlayImageUrl ?? result?.result_image_url ?? '',
  subPpdValues: result?.subPpdValues ?? result?.sub_ppd_values ?? [],
  errorCode: result?.errorCode ?? result?.error_code,
  errorMessage: result?.errorMessage ?? result?.error_message,
  vis_images: result?.vis_images ?? {},
  split_count: result?.split_count ?? result?.splitCount ?? 0,
  });
};

const normalizeRole = (role: any) => ({
  ...role,
  id: Number(role?.id ?? role?.pk ?? 0),
  permissions: Array.isArray(role?.permissions) ? role.permissions : [],
  permissions_count: Number(role?.permissions_count ?? role?.permission_count ?? 0),
  user_count: Number(role?.user_count ?? role?.userCount ?? 0),
});

const normalizeUser = (user: any) => ({
  ...user,
  role_names: Array.isArray(user?.role_names) ? user.role_names : [],
  roles: Array.isArray(user?.roles) ? user.roles : [],
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

const getCookieValue = (name: string) => {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie.split(';').map(p => p.trim());
  for (const part of parts) {
    if (part.startsWith(`${name}=`)) {
      return decodeURIComponent(part.substring(name.length + 1));
    }
  }
  return null;
};

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  withCredentials: true,
});

// 添加请求拦截器来包含认证token
api.interceptors.request.use(
  (config) => {
    const token = getAuthToken();
    if (token) {
      config.headers.Authorization = `Token ${token}`;
    }

    const guestToken = localStorage.getItem('guestToken') || getCookieValue('guest_token');
    if (guestToken) {
      config.headers['X-Guest-Token'] = guestToken;
      localStorage.setItem('guestToken', guestToken);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 添加响应拦截器处理认证错误
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Only handle 401 Unauthorized for re-login
    if (error.response?.status === 401) {
      // 只有原本带着登录 token 时才视为会话过期；访客的 401 不应把人踢出登录态
      const hadToken = Boolean(getAuthToken());
      // 认证失败，清除本地token
      clearAuthToken();
      if (hadToken) {
        // 在单页应用中，不直接重定向，而是触发事件让应用处理
        // 创建自定义事件通知应用需要重新登录
        const authEvent = new CustomEvent('auth:expired');
        window.dispatchEvent(authEvent);
      }
    }
    // For 403 Forbidden, we just reject the promise so the UI can handle it (e.g. show error message)
    // without logging the user out.
    return Promise.reject(error);
  }
);

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
  days: (): Promise<number[]> => api.get('/images/days/').then(res => res.data),
  types: (): Promise<string[]> => api.get('/images/types/').then(res => res.data),
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
  firstSegmentation: (data: any): Promise<any> => api.post('/segmentations/first_segmentation/', data).then(res => res.data),
  secondSegmentation: (data: any): Promise<any> => api.post('/segmentations/second_segmentation/', data).then(res => res.data),
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
  predictSingle: (data: any): Promise<any> => api.post('/predictions/predict_single/', data).then(res => res.data),
  predictBatch: (data: any): Promise<any> => api.post('/predictions/predict_batch/', data).then(res => res.data),
  export: (params: { file_type: 'csv' | 'xlsx' | 'zip'; task_id?: string; search?: string; status?: string }) =>
    api.get('/predictions/export/', { params, responseType: 'blob', timeout: 300000 }),
  getOverlay: (id: string, version: number): Promise<Blob> =>
    api.get(`/predictions/${id}/overlay/`, { params: { version }, responseType: 'blob' }).then(res => res.data),
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
  createPredictionTask: (data: any): Promise<any> => api.post('/tasks/', data).then(res => normalizeTask(unwrapApiData<any>(res.data))),
  createFirstSegmentationTask: (data: any): Promise<any> => api.post('/tasks/first-segmentation/', data).then(res => res.data),
  createSecondSegmentationTask: (data: any): Promise<any> => api.post('/tasks/second-segmentation/', data).then(res => res.data),
  createPrediction: (data: any): Promise<any> => api.post('/tasks/prediction/', data).then(res => res.data),
  deleteTask: (id: number|string) => api.delete(`/tasks/${id}/`),
};

// === OSS API ===
export const ossApi = {
  upload: (data: FormData): Promise<any> => api.post('/oss/', data).then(res => res.data),
  download: (key: string): Promise<Blob> => api.get('/oss/', { params: { key }, responseType: 'blob' }).then(res => res.data),
  list: (prefix?: string): Promise<any> => api.get('/oss/', { params: { prefix } }).then(res => res.data),
  delete: (key: string): Promise<any> => api.delete('/oss/', { params: { key } }).then(res => res.data),
};

// === Analytics API ===
export const analyticsApi = {
  getStats: (days: number = 30): Promise<any> => api.get('/analytics/stats/', { params: { days } }).then(res => res.data),
  getLogs: (params: any): Promise<any> => api.get('/analytics/logs/', { params }).then(res => res.data),
  getPublicStats: (): Promise<{prediction_usage_count: number, images_predicted_count: number, visit_count: number}> => 
    api.get('/analytics/public-stats/').then(res => res.data),
  getIPStats: (params: any): Promise<any> => api.get('/analytics/ip-stats/', { params }).then(res => res.data),
};

// Status API
export const statusApi = {
  check: (): Promise<{ status: string; version?: string; serverTime?: string; imageCount: number; taskCount: number }> => 
    api.get('/status/').then(res => ({
      status: res.data?.status,
      version: res.data?.version,
      serverTime: res.data?.server_time || res.data?.serverTime,
      imageCount: res.data?.imageCount ?? res.data?.image_count ?? 0,
      taskCount: res.data?.taskCount ?? res.data?.task_count ?? 0,
    })),
};

// Login API
export const authApi = {
  login: (username: string, password: string): Promise<{ token: string }> =>
    axios.post(`${API_BASE_URL}/auth/login/`, { username, password }).then(res => res.data),
  logout: (): Promise<void> =>
    api.post('/auth/logout/').then(res => res.data),
  guestSession: (): Promise<{ guest_token: string; user: any }> =>
    api.post('/auth/guest/').then(res => res.data),
  changePassword: (oldPassword: string, newPassword: string): Promise<any> =>
    api.post('/auth/password/change/', { old_password: oldPassword, new_password: newPassword }).then(res => res.data),
  updateProfile: (data: any): Promise<any> =>
    api.post('/auth/profile/update/', data).then(res => res.data),
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

// === Permission Management API ===
export const permissionsApi = {
  // Permission related
  getAllPermissions: (params?: any): Promise<any> => api.get('/permissions/permissions/', { params }).then(res => {
    const parsed = toPaginatedResult<any>(res.data);
    return parsed;
  }),
  getPermissionById: (id: string): Promise<any> => api.get(`/permissions/permissions/${id}/`).then(res => res.data),
  createPermission: (data: any): Promise<any> => api.post('/permissions/permissions/', data).then(res => res.data),
  updatePermission: (id: string, data: any): Promise<any> => api.put(`/permissions/permissions/${id}/`, data).then(res => res.data),
  deletePermission: (id: string): Promise<void> => api.delete(`/permissions/permissions/${id}/`),
  getPermissionCategories: (): Promise<string[]> => api.get('/permissions/permissions/categories/').then(res => res.data),
  getPermissionHierarchy: (): Promise<any> => api.get('/permissions/permissions/hierarchy/').then(res => res.data),
  
  // Role related
  getAllRoles: (params?: any): Promise<any> => api.get('/permissions/roles/', { params }).then(res => {
    const parsed = toPaginatedResult<any>(res.data);
    return {
      ...parsed,
      results: parsed.results.map(normalizeRole),
    };
  }),
  getRoleById: (id: string): Promise<any> => api.get(`/permissions/roles/${id}/`).then(res => res.data),
  createRole: (data: any): Promise<any> => api.post('/permissions/roles/', data).then(res => res.data),
  updateRole: (id: string, data: any): Promise<any> => api.put(`/permissions/roles/${id}/`, data).then(res => res.data),
  deleteRole: (id: string): Promise<void> => api.delete(`/permissions/roles/${id}/`),
  assignPermissionsToRole: (roleId: string, permissionIds: string[]): Promise<any> => 
    api.post(`/permissions/roles/${roleId}/assign_permissions/`, { permission_ids: permissionIds }).then(res => res.data),
  removePermissionsFromRole: (roleId: string, permissionIds: string[]): Promise<any> => 
    api.post(`/permissions/roles/${roleId}/remove_permissions/`, { permission_ids: permissionIds }).then(res => res.data),
  getRoleUsers: (roleId: string): Promise<any[]> => api.get(`/permissions/roles/${roleId}/users/`).then(res => res.data),
  
  // User role related
  assignRoleToUser: (userId: string, roleId: string): Promise<any> => 
    api.post('/permissions/user-roles/assign_role/', { user_id: userId, role_id: roleId }).then(res => res.data),
  removeRoleFromUser: (userId: string, roleId: string): Promise<any> => 
    api.post('/permissions/user-roles/remove_role/', { user_id: userId, role_id: roleId }).then(res => res.data),
  getUserRolesById: (userId: string): Promise<any[]> => api.get(`/permissions/users/${userId}/roles/`).then(res => res.data),
  
  // User management related
  getAllUsers: (params?: any): Promise<any> => api.get('/permissions/users/', { params }).then(res => {
    const parsed = toPaginatedResult<any>(res.data);
    return {
      ...parsed,
      results: parsed.results.map(normalizeUser),
    };
  }),
  getUsers: (params?: any): Promise<any> => api.get('/permissions/users/', { params }).then(res => res.data),
  searchShareUsers: (query: string): Promise<any[]> => api.get('/permissions/users/search_share_users/', { params: { q: query } }).then(res => res.data),
  getUserById: (id: string): Promise<any> => api.get(`/permissions/users/${id}/`).then(res => res.data),
  createUser: (data: any): Promise<any> => api.post('/permissions/users/', data).then(res => res.data),
  updateUser: (id: string, data: any): Promise<any> => api.put(`/permissions/users/${id}/`, data).then(res => res.data),
  deleteUser: (id: string): Promise<void> => api.delete(`/permissions/users/${id}/`),
  getGuestStats: (): Promise<{today_count: number, total_count: number}> => api.get('/permissions/users/guest_stats/').then(res => res.data),
  getUserPermissions: (userId: string): Promise<any[]> => api.get(`/permissions/users/${userId}/permissions/`).then(res => res.data),
  getCurrentUserPermissions: (): Promise<any[]> => api.get('/permissions/user-permissions/user_permissions/').then(res => res.data),
  getCurrentUserRoles: (): Promise<any[]> => api.get('/permissions/user-roles/user_roles/').then(res => res.data),
  checkUserHasRole: (roleName: string): Promise<{ has_role: boolean }> => 
    api.get('/permissions/users/has_role/', { params: { role_name: roleName } }).then(res => res.data),
  // Get all permissions of current user
  getCurrentUserPermissionsList: () => 
    api.get('/permissions/user-permissions/user_permissions/').then(res => unwrapApiData<any>(res.data)),
  
  // Get all roles of current user
  getCurrentUserRolesList: () => 
    api.get('/permissions/user-permissions/user_roles/').then(res => unwrapApiData<any>(res.data)),
  
  // User permission check
  checkPermission: (permissionCode: string) => 
    api.get(`/permissions/user-permissions/has-permission/?permission_code=${permissionCode}`),
  
  // User role check
  checkRole: (roleName: string) => 
    api.get(`/permissions/user-permissions/has-role/?role_name=${roleName}`),
  
  // Audit log related
  logAuditAction: (data: any): Promise<any> => 
    api.post('/permissions/audit-logs/', data).then(res => res.data),
  getAuditLogs: (params?: any): Promise<any> => 
    api.get('/permissions/audit-logs/', { params }).then(res => unwrapApiData<any>(res.data)),
  getUserActivityStats: (userId: string, days: number = 30): Promise<any> => 
    api.get(`/permissions/audit-logs/user-activity/${userId}/`, { params: { days } }).then(res => res.data),
  getSecurityReport: (days: number = 30): Promise<any> => 
    api.get('/permissions/audit-logs/security-report/', { params: { days } }).then(res => res.data),

  // Permission Templates
  getAllPermissionTemplates: (): Promise<any[]> => api.get('/permissions/permission-templates/').then(res => res.data.results || res.data),
  createPermissionTemplate: (data: any): Promise<any> => api.post('/permissions/permission-templates/', data).then(res => res.data),
  updatePermissionTemplate: (id: string, data: any): Promise<any> => api.put(`/permissions/permission-templates/${id}/`, data).then(res => res.data),
  deletePermissionTemplate: (id: string): Promise<void> => api.delete(`/permissions/permission-templates/${id}/`),

  // Advanced User Permission Management
  getUserDetailedPermissions: (userId: string): Promise<{all_permissions: string[], direct_permission_ids: number[]}> => 
    api.get('/permissions/user-permissions/get_permissions/', { params: { user_id: userId } }).then(res => res.data),
  
  updateUserPermissions: (userId: string, permissionIds: number[]): Promise<any> => 
    api.post('/permissions/user-permissions/update_permissions/', { user_id: userId, permission_ids: permissionIds }).then(res => res.data),
};

// === Shares API ===
export const sharesApi = {
  share: (data: { resource_type: string; resource_id: string; shared_with_username: string; permission?: string; expires_at?: string }): Promise<ResourceShare> =>
    api.post('/shares/share/', data).then(res => unwrapApiData<ResourceShare>(res.data)),
  revoke: (shareId: string): Promise<void> =>
    api.post('/shares/revoke/', { share_id: shareId }).then(res => unwrapApiData<void>(res.data)),
  myShares: (): Promise<ResourceShare[]> =>
    api.get('/shares/my_shares/').then(res => unwrapApiData<ResourceShare[]>(res.data)),
  sharedWithMe: (): Promise<ResourceShare[]> =>
    api.get('/shares/shared_with_me/').then(res => unwrapApiData<ResourceShare[]>(res.data)),
};

// === Guest Resources API ===
export const guestResourcesApi = {
  getAll: (): Promise<any[]> => api.get('/permissions/guest-resources/').then(res => {
    const parsed = parseListResult<any>(res.data);
    return parsed.items;
  }),
  add: (data: {resource_type: 'image'|'folder', resource_id: number|string}): Promise<any> => api.post('/permissions/guest-resources/', data),
  remove: (id: number): Promise<void> => api.delete(`/permissions/guest-resources/${id}/`),
  toggle: (data: {resource_type: 'image'|'folder', resource_id: number|string, enabled: boolean}): Promise<any> => api.post('/permissions/guest-resources/toggle_resource/', data),
};

export default api;
