import { permissionsApi } from './api';

/**
 * Audit Action Types
 */
export enum AuditAction {
  // Permission related actions
  PERMISSION_CREATE = 'permission_create',
  PERMISSION_UPDATE = 'permission_update',
  PERMISSION_DELETE = 'permission_delete',
  
  // Role related actions
  ROLE_CREATE = 'role_create',
  ROLE_UPDATE = 'role_update',
  ROLE_DELETE = 'role_delete',
  ROLE_PERMISSION_ASSIGN = 'role_permission_assign',
  
  // User related actions
  USER_CREATE = 'user_create',
  USER_UPDATE = 'user_update',
  USER_DELETE = 'user_delete',
  USER_ROLE_ASSIGN = 'user_role_assign',
  
  // System actions
  LOGIN = 'login',
  LOGOUT = 'logout',
  ACCESS_DENIED = 'access_denied',
  PERMISSION_CHECK = 'permission_check',
}

/**
 * Audit Log Interface
 */
export interface AuditLog {
  id: string;
  userId: string;
  username: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
  success: boolean;
}

/**
 * Audit Log Query Params
 */
export interface AuditLogQueryParams {
  page?: number;
  pageSize?: number;
  userId?: string;
  action?: AuditAction;
  resourceType?: string;
  startDate?: string;
  endDate?: string;
  success?: boolean;
}

/**
 * Audit Log Response
 */
export interface AuditLogResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Audit Service
 */
export class AuditService {
  /**
   * Log permission action
   */
  static async logPermissionAction(
    action: AuditAction,
    resourceType: string,
    resourceId?: string,
    resourceName?: string,
    details?: Record<string, any>
  ): Promise<void> {
    try {
      await permissionsApi.logAuditAction({
        action,
        resourceType,
        resourceId,
        resourceName,
        details
      });
    } catch (error) {
      console.error('Failed to log audit action:', error);
      // Audit log failure should not affect main flow
    }
  }

  /**
   * 记录权限检查日志
   */
  static async logPermissionCheck(
    permissionCode: string,
    success: boolean,
    resourceType?: string,
    resourceId?: string
  ): Promise<void> {
    try {
      await permissionsApi.logAuditAction({
        action: AuditAction.PERMISSION_CHECK,
        resourceType: resourceType || 'permission',
        resourceId,
        resourceName: permissionCode,
        details: {
          permission: permissionCode,
          success,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('记录权限检查日志失败:', error);
    }
  }

  /**
   * 记录访问被拒绝日志
   */
  static async logAccessDenied(
    permissionCode: string,
    resourceType: string,
    resourceId?: string
  ): Promise<void> {
    try {
      await permissionsApi.logAuditAction({
        action: AuditAction.ACCESS_DENIED,
        resourceType,
        resourceId,
        resourceName: permissionCode,
        details: {
          permission: permissionCode,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('记录访问拒绝日志失败:', error);
    }
  }

  /**
   * 获取审计日志列表
   */
  static async getAuditLogs(params: AuditLogQueryParams): Promise<AuditLogResponse> {
    try {
      const response = await permissionsApi.getAuditLogs(params);
      return response;
    } catch (error) {
      console.error('获取审计日志失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户活动统计
   */
  static async getUserActivityStats(userId: string, days: number = 30): Promise<any> {
    try {
      const response = await permissionsApi.getUserActivityStats(userId, days);
      return response;
    } catch (error) {
      console.error('获取用户活动统计失败:', error);
      throw error;
    }
  }

  /**
   * 获取系统安全报告
   */
  static async getSecurityReport(days: number = 30): Promise<any> {
    try {
      const response = await permissionsApi.getSecurityReport(days);
      return response;
    } catch (error) {
      console.error('获取安全报告失败:', error);
      throw error;
    }
  }
}

/**
 * 审计日志Hook
 */
export const useAuditLog = () => {
  const logAction = async (
    action: AuditAction,
    resourceType: string,
    resourceId?: string,
    resourceName?: string,
    details?: Record<string, any>
  ) => {
    return AuditService.logPermissionAction(action, resourceType, resourceId, resourceName, details);
  };

  const logPermissionCheck = async (
    permissionCode: string,
    success: boolean,
    resourceType?: string,
    resourceId?: string
  ) => {
    return AuditService.logPermissionCheck(permissionCode, success, resourceType, resourceId);
  };

  const logAccessDenied = async (
    permissionCode: string,
    resourceType: string,
    resourceId?: string
  ) => {
    return AuditService.logAccessDenied(permissionCode, resourceType, resourceId);
  };

  return {
    logAction,
    logPermissionCheck,
    logAccessDenied
  };
};