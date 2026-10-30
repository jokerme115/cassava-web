import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../hooks/usePermission';

interface PermissionGuardProps {
  /** Permission code required */
  permission?: string;
  /** Role name required */
  role?: string;
  /** List of permissions required (any one) */
  anyPermissions?: string[];
  /** List of permissions required (all) */
  allPermissions?: string[];
  /** Whether superuser is required */
  requireSuperuser?: boolean;
  /** Content to display when permission is denied */
  fallback?: React.ReactNode;
  /** Child components */
  children: React.ReactNode;
}

/**
 * Permission Guard Component
 * Controls the display of child components based on permission conditions
 */
export const PermissionGuard: React.FC<PermissionGuardProps> = ({
  permission,
  role,
  anyPermissions,
  allPermissions,
  requireSuperuser,
  fallback,
  children
}) => {
  const { t } = useTranslation();
  const { 
    hasPermission, 
    hasRole, 
    hasAnyPermission, 
    hasAllPermissions, 
    isSuperuser, 
    isLoading 
  } = usePermission();

  // Default permission denied fallback
  const defaultFallback = (
    <div className="flex items-center justify-center p-6">
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center max-w-md">
        <h3 className="text-lg font-medium text-red-800">{t('navigation.permission_guard.access_denied_title')}</h3>
        <p className="mt-2 text-red-700">{t('navigation.permission_guard.access_denied_message')}</p>
      </div>
    </div>
  );

  // Check permission conditions
  const checkPermission = () => {
    // Check superuser permission
    if (requireSuperuser && !isSuperuser()) {
      return false;
    }

    // Check single permission
    if (permission && !hasPermission(permission)) {
      return false;
    }

    // Check single role
    if (role && !hasRole(role)) {
      return false;
    }

    // Check any permissions
    if (anyPermissions && anyPermissions.length > 0 && !hasAnyPermission(anyPermissions)) {
      return false;
    }

    // Check all permissions
    if (allPermissions && allPermissions.length > 0 && !hasAllPermissions(allPermissions)) {
      return false;
    }

    return true;
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-ink-secondary">{t('navigation.permission_guard.checking')}</span>
      </div>
    );
  }

  // Permission check
  if (!checkPermission()) {
    return <>{fallback || defaultFallback}</>;
  }

  return <>{children}</>;
};

/**
 * 快捷权限守卫组件 - 检查单个权限
 */
export const WithPermission: React.FC<Omit<PermissionGuardProps, 'permission' | 'role' | 'anyPermissions' | 'allPermissions' | 'requireSuperuser'> & { permission: string }> = (props) => {
  return <PermissionGuard {...props} />;
};

/**
 * 快捷权限守卫组件 - 检查单个角色
 */
export const WithRole: React.FC<Omit<PermissionGuardProps, 'permission' | 'role' | 'anyPermissions' | 'allPermissions' | 'requireSuperuser'> & { role: string }> = (props) => {
  return <PermissionGuard {...props} />;
};

/**
 * 快捷权限守卫组件 - 检查超级管理员
 */
export const WithSuperuser: React.FC<Omit<PermissionGuardProps, 'permission' | 'role' | 'anyPermissions' | 'allPermissions' | 'requireSuperuser'>> = (props) => {
  return <PermissionGuard requireSuperuser={true} {...props} />;
};
