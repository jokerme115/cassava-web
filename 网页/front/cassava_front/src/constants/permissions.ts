/**
 * Permission constants definition
 * Used to unify permission codes throughout the application
 */

export const PERMISSIONS = {
  // Permission management permissions
  PERMISSIONS: {
    // Permission operations
    ADD_PERMISSION: 'add_permission',
    CHANGE_PERMISSION: 'change_permission',
    DELETE_PERMISSION: 'delete_permission',
    VIEW_PERMISSION: 'view_permission',
    
    // Role operations
    ADD_ROLE: 'add_role',
    CHANGE_ROLE: 'change_role',
    DELETE_ROLE: 'delete_role',
    VIEW_ROLE: 'view_role',
    ASSIGN_ROLE_PERMISSIONS: 'assign_role_permissions',
    
    // User operations
    ADD_USER: 'add_user',
    CHANGE_USER: 'change_user',
    DELETE_USER: 'delete_user',
    VIEW_USER: 'view_user',
    ASSIGN_USER_ROLES: 'assign_user_roles',
    
    // Permission checks
    CHECK_PERMISSION: 'check_permission',
    CHECK_ROLE: 'check_role',
    
    // Audit log permissions
    VIEW_AUDIT_LOGS: 'view_audit_log',
    EXPORT_AUDIT_LOGS: 'export_audit_logs',
    DELETE_AUDIT_LOGS: 'delete_audit_logs',
  },
  
  // System management permissions
  SYSTEM: {
    MANAGE_SYSTEM: 'manage_system',
    VIEW_SYSTEM_INFO: 'view_system_info',
    MANAGE_SETTINGS: 'manage_settings',
  },
  
  // Data management permissions
  DATA: {
    VIEW_DATA: 'view_image',
    ADD_DATA: 'upload_image',
    CHANGE_DATA: 'edit_image',
    DELETE_DATA: 'delete_image',
    EXPORT_DATA: 'export_data',
    IMPORT_DATA: 'import_data',
  },
  
  // Prediction analysis permissions
  PREDICTION: {
    VIEW_PREDICTION: 'view_prediction',
    RUN_PREDICTION: 'create_prediction',
    MANAGE_MODELS: 'manage_models',
    VIEW_HISTORY: 'view_prediction',
    DELETE_HISTORY: 'delete_prediction',
  },
  
  // Report permissions
  REPORTS: {
    VIEW_REPORTS: 'view_reports',
    GENERATE_REPORTS: 'generate_reports',
    EXPORT_REPORTS: 'export_reports',
    MANAGE_REPORT_TEMPLATES: 'manage_report_templates',
  },
} as const;

/**
 * Role constants definition
 */
export const ROLES = {
  SUPERUSER: '超级管理员',
  ADMIN: '管理员',
  USER: '普通用户',
  VIEWER: '查看者',
  DATA_MANAGER: '数据管理员',
  PREDICTION_OPERATOR: '预测操作员',
} as const;

/**
 * Permission group definition - used for batch permission checking
 */
export const PERMISSION_GROUPS = {
  // Admin permission group
  ADMIN: [
    PERMISSIONS.PERMISSIONS.ADD_PERMISSION,
    PERMISSIONS.PERMISSIONS.CHANGE_PERMISSION,
    PERMISSIONS.PERMISSIONS.DELETE_PERMISSION,
    PERMISSIONS.PERMISSIONS.ADD_ROLE,
    PERMISSIONS.PERMISSIONS.CHANGE_ROLE,
    PERMISSIONS.PERMISSIONS.DELETE_ROLE,
    PERMISSIONS.PERMISSIONS.ADD_USER,
    PERMISSIONS.PERMISSIONS.CHANGE_USER,
    PERMISSIONS.PERMISSIONS.DELETE_USER,
    PERMISSIONS.SYSTEM.MANAGE_SYSTEM,
  ],
  
  // Data manager permission group
  DATA_MANAGER: [
    PERMISSIONS.DATA.VIEW_DATA,
    PERMISSIONS.DATA.ADD_DATA,
    PERMISSIONS.DATA.CHANGE_DATA,
    PERMISSIONS.DATA.DELETE_DATA,
    PERMISSIONS.DATA.EXPORT_DATA,
    PERMISSIONS.DATA.IMPORT_DATA,
  ],
  
  // Prediction operator permission group
  PREDICTION_OPERATOR: [
    PERMISSIONS.PREDICTION.VIEW_PREDICTION,
    PERMISSIONS.PREDICTION.RUN_PREDICTION,
    PERMISSIONS.PREDICTION.VIEW_HISTORY,
  ],
  
  // Viewer permission group
  VIEWER: [
    PERMISSIONS.DATA.VIEW_DATA,
    PERMISSIONS.PREDICTION.VIEW_PREDICTION,
    PERMISSIONS.REPORTS.VIEW_REPORTS,
  ],
} as const;

/**
 * Permission check utility functions
 */
export const hasPermission = (userPermissions: string[], permission: string): boolean => {
  return userPermissions.includes(permission);
};

export const hasAnyPermission = (userPermissions: string[], permissions: string[] | readonly string[]): boolean => {
  return permissions.some(permission => userPermissions.includes(permission));
};

export const hasAllPermissions = (userPermissions: string[], permissions: string[] | readonly string[]): boolean => {
  return permissions.every(permission => userPermissions.includes(permission));
};

export const hasRole = (userRoles: string[], role: string): boolean => {
  return userRoles.includes(role);
};

/**
 * Get permission description
 */
export const getPermissionDescription = (permissionCode: string): string => {
  const descriptions: Record<string, string> = {
    [PERMISSIONS.PERMISSIONS.ADD_PERMISSION]: 'permissions.descriptions.add_permission',
    [PERMISSIONS.PERMISSIONS.CHANGE_PERMISSION]: 'permissions.descriptions.change_permission',
    [PERMISSIONS.PERMISSIONS.DELETE_PERMISSION]: 'permissions.descriptions.delete_permission',
    [PERMISSIONS.PERMISSIONS.VIEW_PERMISSION]: 'permissions.descriptions.view_permission',
    [PERMISSIONS.PERMISSIONS.ADD_ROLE]: 'permissions.descriptions.add_role',
    [PERMISSIONS.PERMISSIONS.CHANGE_ROLE]: 'permissions.descriptions.change_role',
    [PERMISSIONS.PERMISSIONS.DELETE_ROLE]: 'permissions.descriptions.delete_role',
    [PERMISSIONS.PERMISSIONS.VIEW_ROLE]: 'permissions.descriptions.view_role',
    [PERMISSIONS.PERMISSIONS.ASSIGN_ROLE_PERMISSIONS]: 'permissions.descriptions.assign_role_permissions',
    [PERMISSIONS.PERMISSIONS.ADD_USER]: 'permissions.descriptions.add_user',
    [PERMISSIONS.PERMISSIONS.CHANGE_USER]: 'permissions.descriptions.change_user',
    [PERMISSIONS.PERMISSIONS.DELETE_USER]: 'permissions.descriptions.delete_user',
    [PERMISSIONS.PERMISSIONS.VIEW_USER]: 'permissions.descriptions.view_user',
    [PERMISSIONS.PERMISSIONS.ASSIGN_USER_ROLES]: 'permissions.descriptions.assign_user_roles',
    [PERMISSIONS.PERMISSIONS.CHECK_PERMISSION]: 'permissions.descriptions.check_permission',
    [PERMISSIONS.PERMISSIONS.CHECK_ROLE]: 'permissions.descriptions.check_role',
    [PERMISSIONS.SYSTEM.MANAGE_SYSTEM]: 'permissions.descriptions.manage_system',
    [PERMISSIONS.SYSTEM.VIEW_SYSTEM_INFO]: 'permissions.descriptions.view_system_info',
    [PERMISSIONS.SYSTEM.MANAGE_SETTINGS]: 'permissions.descriptions.manage_settings',
    [PERMISSIONS.DATA.VIEW_DATA]: 'permissions.descriptions.view_image',
    [PERMISSIONS.DATA.ADD_DATA]: 'permissions.descriptions.upload_image',
    [PERMISSIONS.DATA.CHANGE_DATA]: 'permissions.descriptions.edit_image',
    [PERMISSIONS.DATA.DELETE_DATA]: 'permissions.descriptions.delete_image',
    [PERMISSIONS.DATA.EXPORT_DATA]: 'permissions.descriptions.export_data',
    [PERMISSIONS.DATA.IMPORT_DATA]: 'permissions.descriptions.import_data',
    [PERMISSIONS.PREDICTION.VIEW_PREDICTION]: 'permissions.descriptions.view_prediction',
    [PERMISSIONS.PREDICTION.RUN_PREDICTION]: 'permissions.descriptions.run_prediction',
    [PERMISSIONS.PREDICTION.MANAGE_MODELS]: 'permissions.descriptions.manage_models',
    [PERMISSIONS.PREDICTION.DELETE_HISTORY]: 'permissions.descriptions.delete_history',
    [PERMISSIONS.REPORTS.VIEW_REPORTS]: 'permissions.descriptions.view_reports',
    [PERMISSIONS.REPORTS.GENERATE_REPORTS]: 'permissions.descriptions.generate_reports',
    [PERMISSIONS.REPORTS.EXPORT_REPORTS]: 'permissions.descriptions.export_reports',
    [PERMISSIONS.REPORTS.MANAGE_REPORT_TEMPLATES]: 'permissions.descriptions.manage_report_templates',
  };
  
  return descriptions[permissionCode] || 'permissions.descriptions.unknown';
};