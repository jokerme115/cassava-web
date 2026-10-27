import api, { parseListResult, toPaginatedResult, unwrapApiData } from './client';
import { normalizeRole, normalizeUser } from './normalizers';
import type { ResourceShare } from '../../types';

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
