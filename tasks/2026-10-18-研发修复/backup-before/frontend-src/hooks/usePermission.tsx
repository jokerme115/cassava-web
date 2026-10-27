import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { permissionsApi } from '../services/api';
import { PERMISSIONS, ROLES, PERMISSION_GROUPS } from '../constants/permissions';

interface PermissionState {
  permissions: string[];
  roles: string[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Permission Management Hook
 * Provides permission checking, role checking functionalities
 */
export const usePermission = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<PermissionState>({
    permissions: [],
    roles: [],
    isLoading: true,
    error: null
  });

  // Load user permissions and roles
  const loadPermissions = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      // Get user permissions
      const permissionsResponse = await permissionsApi.getCurrentUserPermissionsList();
      const permissions = Array.isArray(permissionsResponse)
        ? permissionsResponse
        : permissionsResponse?.permissions || [];
      
      // Get user roles
      const rolesResponse = await permissionsApi.getCurrentUserRolesList();
      const roles = Array.isArray(rolesResponse)
        ? rolesResponse.map((role: any) => role.name)
        : [];
      
      setState({
        permissions,
        roles,
        isLoading: false,
        error: null
      });
    } catch (error) {
      console.error('Failed to load permissions:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: t('navigation.permission_guard.load_error')
      }));
    }
  }, [t]);

  // Check if user has specific permission
  const hasPermission = useCallback((permissionCode: string): boolean => {
    return state.permissions.includes(permissionCode);
  }, [state.permissions]);

  // Check if user has specific role
  const hasRole = useCallback((roleName: string): boolean => {
    return state.roles.includes(roleName);
  }, [state.roles]);

  // Check if user has any of the permissions
  const hasAnyPermission = useCallback((permissionCodes: string[] | readonly string[]): boolean => {
    return permissionCodes.some(code => state.permissions.includes(code));
  }, [state.permissions]);

  // Check if user has all permissions
  const hasAllPermissions = useCallback((permissionCodes: string[] | readonly string[]): boolean => {
    return permissionCodes.every(code => state.permissions.includes(code));
  }, [state.permissions]);

  // Check if user is superuser
  const isSuperuser = useCallback((): boolean => {
    return hasRole(ROLES.SUPERUSER) || hasRole(ROLES.ADMIN) || hasPermission(PERMISSIONS.SYSTEM.MANAGE_SYSTEM);
  }, [hasRole, hasPermission]);

  // Check if user has admin privileges
  const isAdmin = useCallback((): boolean => {
    return hasRole(ROLES.ADMIN) || isSuperuser();
  }, [hasRole, isSuperuser]);

  // Check if user has data manager privileges
  const isDataManager = useCallback((): boolean => {
    return hasRole(ROLES.DATA_MANAGER) || hasAnyPermission(PERMISSION_GROUPS.DATA_MANAGER) || isAdmin();
  }, [hasRole, hasAnyPermission, isAdmin]);

  // Check if user has prediction operator privileges
  const isPredictionOperator = useCallback((): boolean => {
    return hasRole(ROLES.PREDICTION_OPERATOR) || hasAnyPermission(PERMISSION_GROUPS.PREDICTION_OPERATOR) || isAdmin();
  }, [hasRole, hasAnyPermission, isAdmin]);

  // Check if user has viewer privileges
  const isViewer = useCallback((): boolean => {
    return hasRole(ROLES.VIEWER) || hasAnyPermission(PERMISSION_GROUPS.VIEWER) || isDataManager() || isPredictionOperator() || isAdmin();
  }, [hasRole, hasAnyPermission, isDataManager, isPredictionOperator, isAdmin]);

  // Check if user has permissions of a specific group
  const hasPermissionGroup = useCallback((groupName: keyof typeof PERMISSION_GROUPS): boolean => {
    const permissions = PERMISSION_GROUPS[groupName];
    return hasAnyPermission(permissions);
  }, [hasAnyPermission]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  return {
    ...state,
    hasPermission,
    hasRole,
    hasAnyPermission,
    hasAllPermissions,
    isSuperuser,
    isAdmin,
    isDataManager,
    isPredictionOperator,
    isViewer,
    hasPermissionGroup,
    reloadPermissions: loadPermissions
  };
};

/**
 * Permission Check HOC
 */
export const withPermission = (permissionCode: string) => (Component: React.ComponentType) => {
  return (props: any) => {
    const { hasPermission, isLoading } = usePermission();
    
    if (isLoading) {
      return null;
    }
    
    if (!hasPermission(permissionCode)) {
      return null;
    }
    
    return <Component {...props} />;
  };
};

/**
 * Role Check HOC
 */
export const withRole = (roleName: string) => (Component: React.ComponentType) => {
  return (props: any) => {
    const { hasRole, isLoading } = usePermission();
    
    if (isLoading) {
      return null;
    }
    
    if (!hasRole(roleName)) {
      return null;
    }
    
    return <Component {...props} />;
  };
};
