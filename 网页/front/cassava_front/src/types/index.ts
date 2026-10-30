export interface Image {
  id: string;
  name: string;
  url: string;
  image_url?: string; // 兼容后端返回的真实图片URL
  preview_url?: string; // 预览图URL
  pixel_width?: number | null;
  pixel_height?: number | null;
  resolution?: { status: string; low_resolution: boolean | null; warning?: string | null };
  folderId?: string | null;
  uploadDate: string;
  size?: number;
  created_time?: string;
  format: string;
  hasPPD?: boolean;
  ppdValue?: number;
  lastPrediction?: string;
  owner?: number; // Owner ID
  description?: string;
  capture_time?: string;
  capture_time_source?: string;
}

export interface Folder {
  id: string;
  name: string;
  description?: string;
  parent?: string | null;
  imageCount: number;
  createdDate: string;
}

export interface PredictionTask {
  type?: string;
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  updated_time?: string;
  progress: number;
  imageCount: number;
  modelType: string;
  createdDate: string;
  completedDate?: string;
  /** 等待中的任务在队列里的位置，1 表示下一个执行；非等待状态为 null */
  queuePosition?: number | null;
  /** 任务实际产出的结果条数（后端统计），用于对照 imageCount 识别部分失败 */
  resultCount?: number | null;
  /** 任务级错误/警告：失败原因，或“部分图片未出结果”的提示 */
  error?: string | null;
  parameters: {
    confidenceThreshold: number;
    usePostProcessing: boolean;
    useTTA: boolean;
    minArea: number;
    morphKernelSize: number;
    morphIterations: number;
    overlayOpacity: number;
    stage1Confidence?: number;
    stage2Confidence?: number;
    roiPadding?: number;
    fallbackRoiPadding?: number;
    expectedCount?: number;
    stageBoxIou?: number;
    patchSize?: [number, number] | number[];
    stride?: [number, number] | number[];
  };
  statistics?: {
    totalProcessed: number;
    healthyCount: number;
    diseaseCount: number;
    averageConfidence: number;
    processingTime: number;
  };
}

export interface PredictionResult {
  id: string;
  taskId: string;
  imageName: string;
  imageUrl: string;
  ppdValue: number;
  confidence: number | null;
  prediction: string;
  processingTime: number;
  folderId?: string | number | null;
  folderName?: string | null;
  detectionAreas?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
    class: string;
  }>;
  overlayImageUrl?: string;
  metadata?: {
    imageSize: { width: number; height: number };
    detectedRegions: number;
    averageRegionSize: number;
  };
  subPpdValues?: number[];
  errorCode?: string;
  errorMessage?: string;
  // 新增后端字段
  ppd_value?: number;
  sub_ppd_values?: number[];
  result_image?: string;
  error_code?: string;
  error_message?: string;
  ensemble_details?: {
    method: string;
    agreement_percent: number | null;
    disagreement_pixels: number;
    members: { model: string; label: string; ppd_percent: number | null }[];
  };
  vis_images?: Record<string, string>;
  ppd_unit?: 'percent' | 'ratio' | 'unknown' | string;
  cassava_mask_url?: string | null;
  rotten_mask_url?: string | null;
  confidence_map_url?: string | null;
  has_correction?: boolean;
  latest_correction_ppd?: number | null;
  latest_correction?: PredictionCorrection | null;
  measurement?: {
    final_ppd: number | null;
    measurement_source: 'manual' | 'model';
    measurement_status: string;
    correction_version: number;
    review_status: string;
    execution_warning?: string | null;
  };
  editor_available?: boolean;
  current_correction?: PredictionCorrection | null;
  corrections?: PredictionCorrection[];
  split_count?: number;
  splitCount?: number;
  original_image_folder_id?: string | number | null;
  original_image_folder_name?: string | null;
}

export interface PredictionCorrection {
  id: string | number;
  prediction: string | number;
  version: number;
  cassava_mask_url: string;
  rotten_mask_url: string;
  width: number;
  height: number;
  cassava_pixels: number;
  rotten_pixels: number;
  ppd_percent: number;
  edit_data?: Record<string, unknown>;
  note?: string;
  created_at?: string;
  created_by_username?: string;
}

export interface TaskStatistics {
  totalPredictions: number;
  averagePPD: number;
  highestPPD: number;
  lowestPPD: number;
  completedTasks: number;
  runningTasks: number;
}

export interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  error?: string;
}

export interface ResourceShare {
  id: string;
  resource_type: 'image' | 'folder';
  resource_id: string;
  shared_by: number;
  shared_by_username: string;
  shared_with: number;
  shared_with_username: string;
  permission: 'view' | 'edit' | 'manage';
  expires_at?: string;
  created_at: string;
  resource_details?: Image | Folder;
}

export interface User {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_active: boolean;
  is_superuser?: boolean;
  is_guest?: boolean;
  roles?: number[];
  role_names?: string[];
  last_login?: string;
  is_online?: boolean;
  avatar?: string;
  profile?: {
    avatar_url?: string;
  };
}

export interface SystemSetting {
  maxDisplayImages: number;
  maxDisplayResults: number;
  siteTitle?: string;
  siteAnnouncement?: string;
  announcementLevel?: 'info' | 'warning' | 'error';
  enableGuestAccess?: boolean;
  allowRegistration?: boolean;
  maintenanceMode?: boolean;
  uploadSizeLimitMb?: number;
  guestDataRetentionDays?: number;
  auditLogRetentionDays?: number;
  updatedAt?: string;
  updatedBy?: number | string | null;
  site_title?: string;
  site_announcement?: string;
  announcement_level?: 'info' | 'warning' | 'error';
  enable_guest_access?: boolean;
  allow_registration?: boolean;
  maintenance_mode?: boolean;
  upload_size_limit_mb?: number;
  guest_data_retention_days?: number;
  audit_log_retention_days?: number;
  updated_at?: string;
  updated_by?: number | string | null;
  [key: string]: any;
}
