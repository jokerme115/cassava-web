import { modelLabel } from '../../utils/modelLabels';
import { normalizePpdPercent } from '../../utils/measurement';
import type { Image, Folder, PredictionResult, SystemSetting } from '../../types';
import { toIdString } from './client';

export const normalizeImage = (img: any): Image => ({
  ...img,
  id: String(img?.id ?? img?.pk ?? ''),
  url: img?.url ?? img?.preview_url ?? img?.image_url ?? '',
  image_url: img?.image_url,
  preview_url: img?.preview_url,
  folderId: toIdString(img.folderId ?? img.folder ?? img.folder_id),
  created_time: img.created_time ?? img.created_at,
  uploadDate: img.uploadDate ?? img.created_at,
});

export const normalizeFolder = (f: any): Folder => ({
  ...f,
  id: String(f?.id ?? f?.pk ?? f?.folder_id ?? f?.resource_id ?? ''),
  imageCount: f.imageCount ?? f.image_count ?? f.num_images ?? 0,
  createdDate: f.createdDate ?? f.created_at,
  parent: toIdString(f.parent ?? f.parent_id),
});

export const normalizeTask = (task: any) => {
  const imageIds = Array.isArray(task?.image_ids) ? task.image_ids : [];
  const parameters = task?.parameters ?? {};

  return {
    ...task,
    id: String(task?.id ?? task?.pk ?? ''),
    modelType: task?.type === 'upload' ? '文件导入' : modelLabel(
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
    resultCount: task?.type === 'upload' ? (parameters.finished ?? 0) : task?.resultCount ?? task?.result_count ?? null,
    completedDate:
      task?.completedDate ??
      task?.completed_time ??
      task?.updated_time ??
      task?.updated_at,
    parameters: {
      ...parameters,
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

export const finiteNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizePredictionResult = (result: any): PredictionResult => {
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

export const normalizeRole = (role: any) => ({
  ...role,
  id: Number(role?.id ?? role?.pk ?? 0),
  permissions: Array.isArray(role?.permissions) ? role.permissions : [],
  permissions_count: Number(role?.permissions_count ?? role?.permission_count ?? 0),
  user_count: Number(role?.user_count ?? role?.userCount ?? 0),
});

export const normalizeUser = (user: any) => ({
  ...user,
  role_names: Array.isArray(user?.role_names) ? user.role_names : [],
  roles: Array.isArray(user?.roles) ? user.roles : [],
});

export const normalizeSystemSetting = (s: any): SystemSetting => ({
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
