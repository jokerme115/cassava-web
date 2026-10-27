import axios from 'axios';
import api, { API_BASE_URL, unwrapApiData } from './client';
import { normalizeSystemSetting } from './normalizers';
import type { SystemSetting } from '../../types';

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
