import { message } from '../utils/feedback';
import React, { useState, useEffect, Fragment, useCallback } from 'react';
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { Pagination } from 'antd';
import { 
  Shield, 
  Users, 
  Key, 
  Plus, 
  Trash2, 
  Search, 
  Filter,
  MoreVertical,
  CheckCircle,
  XCircle,
  Edit3,
  AlertCircle,
  FileText
} from 'lucide-react';
import { permissionsApi } from '../services/api';
import { PermissionGuard } from '../components/PermissionGuard';
import { PERMISSIONS, getPermissionDescription } from '../constants/permissions';
import { usePermission } from '../hooks/usePermission';
import AuditLogs from './AuditLogs';
import UserPermissionEditor from './UserPermissionEditor';
import { useTranslation } from 'react-i18next';
import { User } from '../types';

// Interface definitions
interface Permission {
  id: number;
  name: string;
  codename: string;
  description: string;
}

interface Role {
  id: number;
  name: string;
  description: string;
  permissions: number[];
  user_count: number;
  permissions_count?: number;
}

// StatCard component
const StatCard = ({ icon: Icon, title, value, color }: { 
  icon: React.ElementType; 
  title: string; 
  value: number; 
  color: string; 
}) => (
  <div className="min-w-0 px-3 py-2" data-tone={color}>
    <div className="flex items-center gap-3">
      <div className="text-accent-text">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-muted">{title}</p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</p>
      </div>
    </div>
  </div>
);

// TabButton component
const TabButton = ({ active, onClick, children }: { 
  active: boolean; 
  onClick: () => void; 
  children: React.ReactNode; 
}) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
      active 
        ? 'bg-brand-fill text-white shadow-[0_14px_30px_rgba(15,23,42,0.16)]' 
        : 'text-ink-secondary hover:bg-surface-muted hover:text-ink'
    }`}
  >
    {children}
  </button>
);

const PermissionManagement = () => {
  const { t, i18n } = useTranslation();
  const editorTabLabel = i18n.language.startsWith('zh') ? '权限工作台' : 'Permission Studio';
  const primaryActionClass = 'inline-flex items-center justify-center rounded-full bg-brand-fill px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-fill-hover';
  const secondaryActionClass = 'inline-flex items-center justify-center rounded-full card px-5 py-2.5 text-sm font-medium text-ink-secondary transition hover:border-hairline-strong hover:bg-white';
  const fieldClass = 'w-full rounded-2xl card px-4 py-3 text-sm text-ink outline-none transition focus:border-accent-line focus:ring-4 focus:ring-accent-line/15';
  // State management
  const [activeTab, setActiveTab] = useState<'permissions' | 'roles' | 'users' | 'config' | 'audit' | 'editor'>('users');
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [permissionPage, setPermissionPage] = useState(1);
  const [permissionPageSize, setPermissionPageSize] = useState(10);
  const [totalPermissionCount, setTotalPermissionCount] = useState(0);

  const [roles, setRoles] = useState<Role[]>([]);
  const [rolePage, setRolePage] = useState(1);
  const [rolePageSize, setRolePageSize] = useState(10);
  const [totalRoleCount, setTotalRoleCount] = useState(0);

  const [users, setUsers] = useState<User[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(10);
  const [totalUserCount, setTotalUserCount] = useState(0);
  const [guestStats, setGuestStats] = useState<{today_count: number, total_count: number}>({today_count: 0, total_count: 0});
  
  // Modal state
  const [showCreatePermissionModal, setShowCreatePermissionModal] = useState(false);
  const [editingPermission, setEditingPermission] = useState<Permission | null>(null);
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showEditRoleModal, setShowEditRoleModal] = useState(false);
  const [showAssignRoleModal, setShowAssignRoleModal] = useState(false);
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  
  // Form state
  const [newPermission, setNewPermission] = useState({ name: '', codename: '', description: '' });
  const [newRole, setNewRole] = useState({ name: '', description: '' });
  const [newUser, setNewUser] = useState({ 
    username: '', 
    email: '', 
    password: '', 
    first_name: '', 
    last_name: '', 
    is_active: true 
  });
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<number[]>([]);
  const [selectedUserRoles, setSelectedUserRoles] = useState<number[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  
  // Search and filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [filterActive, setFilterActive] = useState<boolean | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Data fetching
  const fetchPermissions = useCallback(async (page: number, pageSize: number, search: string = '') => {
    try {
      const response = await permissionsApi.getAllPermissions({
        page,
        page_size: pageSize,
        search
      });
      
      if (response?.results) {
        setPermissions(response.results);
        setTotalPermissionCount(response.count ?? response.results.length);
      } else if (Array.isArray(response)) {
        setPermissions(response);
        setTotalPermissionCount(response.length);
      }
    } catch (error) {
      console.error('Failed to fetch permissions:', error);
      setPermissions([]);
    }
  }, []);

  const fetchRoles = useCallback(async (page: number, pageSize: number, search: string = '') => {
    try {
      const response = await permissionsApi.getAllRoles({
        page,
        page_size: pageSize,
        search
      });
      
      if (response?.results) {
        setRoles(response.results);
        setTotalRoleCount(response.count ?? response.results.length);
      } else if (Array.isArray(response)) {
        setRoles(response);
        setTotalRoleCount(response.length);
      }
    } catch (error) {
      console.error('Failed to fetch roles:', error);
      setRoles([]);
    }
  }, []);

  const fetchUsers = useCallback(async (page: number, pageSize: number, search: string = '', isActive: boolean | null = null) => {
    try {
      const params: any = {
        page,
        page_size: pageSize,
        search
      };
      
      if (isActive !== null) {
        params.is_active = isActive;
      }

      const response = await permissionsApi.getAllUsers(params);
      
      if (response?.results) {
        setUsers(response.results);
        setTotalUserCount(response.count ?? response.results.length);
      } else if (Array.isArray(response)) {
        // Fallback for non-paginated API
        setUsers(response);
        setTotalUserCount(response.length);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
         const [permissionsResponse, rolesResponse, guestStatsResponse] = await Promise.all([
           permissionsApi.getAllPermissions(),
           permissionsApi.getAllRoles(),
           permissionsApi.getGuestStats()
         ]);
         
         const initialPermissions = Array.isArray(permissionsResponse)
           ? permissionsResponse
           : (permissionsResponse?.results || []);
         const initialRoles = Array.isArray(rolesResponse)
           ? rolesResponse
           : (rolesResponse?.results || []);

         setPermissions(initialPermissions);
         setRoles(initialRoles);
         setTotalPermissionCount(
           Array.isArray(permissionsResponse)
             ? permissionsResponse.length
             : (permissionsResponse?.count ?? initialPermissions.length)
         );
         setTotalRoleCount(
           Array.isArray(rolesResponse)
             ? rolesResponse.length
             : (rolesResponse?.count ?? initialRoles.length)
         );
         setGuestStats(guestStatsResponse || {today_count: 0, total_count: 0});
      } catch (error) {
        console.error('Failed to fetch data:', error);
        setPermissions([]);
        setRoles([]);
      }
    };
    
    fetchInitialData();
  }, []);

  // Fetch users when page, pageSize or search changes
  // Fetch data when active tab changes
  useEffect(() => {
    if (activeTab === 'permissions') {
      void fetchPermissions(permissionPage, permissionPageSize, searchTerm);
    } else if (activeTab === 'roles') {
      void fetchRoles(rolePage, rolePageSize, searchTerm);
    }
  }, [activeTab, fetchPermissions, fetchRoles, permissionPage, permissionPageSize, rolePage, rolePageSize, searchTerm]);

  useEffect(() => {
    // Debounce search for users
    const timer = setTimeout(() => {
      if (activeTab === 'users') {
        fetchUsers(userPage, userPageSize, searchTerm, filterActive);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [userPage, userPageSize, searchTerm, filterActive, activeTab, fetchUsers]);

  // Data processing functions
  // Permissions and Roles are now filtered by backend
  const displayPermissions = permissions;
  const displayRoles = roles;

  // Users are filtered by backend
  const displayUsers = users;

  // Event handlers
  const handleCreatePermission = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      if (editingPermission) await permissionsApi.updatePermission(String(editingPermission.id), newPermission);
      else await permissionsApi.createPermission(newPermission);
      await fetchPermissions(permissionPage, permissionPageSize, searchTerm);
      setEditingPermission(null);
      setNewPermission({ name: '', codename: '', description: '' });
      setShowCreatePermissionModal(false);
    } catch (error: any) {
      console.error('Failed to create permission:', error);
      if (error.response && error.response.data && error.response.data.error) {
          setFormError(error.response.data.error);
      } else {
          setFormError(t('permissions.create_permission_error'));
      }
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      const newRoleData = await permissionsApi.createRole(newRole);
      setRoles([...roles, newRoleData]);
      setNewRole({ name: '', description: '' });
      setShowCreateRoleModal(false);
    } catch (error: any) {
      console.error('Failed to create role:', error);
      if (error.response && error.response.data && error.response.data.error) {
          setFormError(error.response.data.error);
      } else {
          setFormError(t('permissions.create_role_error'));
      }
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await permissionsApi.createUser(newUser);
      setUserPage(1);
      await fetchUsers(1, userPageSize, searchTerm, filterActive);
      setNewUser({ username: '', email: '', password: '', first_name: '', last_name: '', is_active: true });
      setShowCreateUserModal(false);
      message.success(t('permissions.create_user'));
    } catch (error: any) {
      console.error('Failed to create user:', error);
      if (error.response && error.response.data && error.response.data.error) {
          setFormError(error.response.data.error + (error.response.data.details ? ': ' + error.response.data.details.join(', ') : ''));
      } else {
          setFormError(t('permissions.create_user_error'));
      }
    }
  };

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;
    
    setFormError(null);
    try {
      // Update basic info
      await permissionsApi.updateRole(editingRole.id.toString(), {
        name: editingRole.name,
        description: editingRole.description
      });

      // Update permissions
      const currentPermissions = editingRole.permissions || [];
      const newPermissions = selectedPermissions;
      
      const toAdd = newPermissions.filter(id => !currentPermissions.includes(id));
      const toRemove = currentPermissions.filter(id => !newPermissions.includes(id));
      
      if (toAdd.length > 0) {
        await permissionsApi.assignPermissionsToRole(
          editingRole.id.toString(), 
          toAdd.map(String)
        );
      }
      
      if (toRemove.length > 0) {
        await permissionsApi.removePermissionsFromRole(
          editingRole.id.toString(), 
          toRemove.map(String)
        );
      }
      
      // Update local state
      const updatedRole = {
        ...editingRole,
        permissions: selectedPermissions,
      };
      
      setRoles(roles.map(r => r.id === editingRole.id ? updatedRole : r));
      setShowEditRoleModal(false);
      setEditingRole(null);
    } catch (error: any) {
      console.error('Failed to update role:', error);
      if (error.response && error.response.data && error.response.data.error) {
          setFormError(error.response.data.error);
      } else {
          setFormError(t('permissions.update_role_error'));
      }
    }
  };

  const handleAssignUserRoles = async (userId: number, roleIds: number[]) => {
    try {
      const currentUser = users.find(u => u.id === userId);
      const currentRoles = currentUser ? (currentUser.roles || []) : [];
      
      const toAdd = roleIds.filter(id => !currentRoles.includes(id));
      const toRemove = currentRoles.filter(id => !roleIds.includes(id));
      
      await Promise.all([
        ...toAdd.map(id => permissionsApi.assignRoleToUser(userId.toString(), id.toString())),
        ...toRemove.map(id => permissionsApi.removeRoleFromUser(userId.toString(), id.toString()))
      ]);
      await fetchUsers(userPage, userPageSize, searchTerm, filterActive);
      setShowAssignRoleModal(false);
      setSelectedUser(null);
      setSelectedUserRoles([]);
      message.success(t('permissions.save_changes'));
    } catch (error) {
      console.error('Failed to assign roles:', error);
      message.error(t('permissions.update_role_error'));
    }
  };

  const handleEditUser = async (user: User) => {
    try {
      await permissionsApi.updateUser(user.id.toString(), user);
      await fetchUsers(userPage, userPageSize, searchTerm, filterActive);
      setShowEditUserModal(false);
      setEditingUser(null);
      message.success(t('permissions.save_changes'));
    } catch (error) {
      console.error('Failed to update user:', error);
      message.error(t('permissions.update_role_error'));
    }
  };

  const handleDeletePermission = async (id: number) => {
    try {
      await permissionsApi.deletePermission(id.toString());
      setPermissions(permissions.filter(p => p.id !== id));
    } catch (error) {
      console.error('Failed to delete permission:', error);
    }
  };

  const handleDeleteRole = async (id: number) => {
    try {
      await permissionsApi.deleteRole(id.toString());
      setRoles(roles.filter(r => r.id !== id));
    } catch (error) {
      console.error('Failed to delete role:', error);
    }
  };

  const handleDeleteUser = async (id: number) => {
    try {
      await permissionsApi.deleteUser(id.toString());
      await fetchUsers(userPage, userPageSize, searchTerm, filterActive);
      message.success(t('images.delete'));
    } catch (error) {
      console.error('Failed to delete user:', error);
      message.error(t('permissions.access_denied'));
    }
  };

  // Render permissions section
  const renderPermissions = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold tracking-normal text-ink">{t('permissions.title')}</h2>
        <PermissionGuard permission={PERMISSIONS.PERMISSIONS.ADD_PERMISSION}>
          <button
            onClick={() => { setEditingPermission(null); setNewPermission({name: '', codename: '', description: ''}); setShowCreatePermissionModal(true); setFormError(null); }}
            className={primaryActionClass}
          >
            <Plus className="h-5 w-5" />
            <span>{t('permissions.create_permission')}</span>
          </button>
        </PermissionGuard>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {displayPermissions.map(permission => (
          <div key={permission.id} className="rounded-[16px] border border-hairline bg-white p-6 shadow-[0_4px_16px_rgba(17,24,28,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Key className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-ink">{permission.name}</h3>
                  <p className="text-sm text-ink-secondary">{permission.codename}</p>
                </div>
              </div>
              <Menu as="div" className="relative inline-block text-left">
                <MenuButton aria-label={`权限操作：${permission.name}`} className="rounded-lg p-2 hover:bg-surface-muted"><MoreVertical className="h-4 w-4 text-muted" /></MenuButton>
                <MenuItems className="absolute right-0 z-30 mt-1 w-32 rounded-lg border border-hairline bg-white p-1 shadow-lg focus:outline-none">
                  <PermissionGuard permission={PERMISSIONS.PERMISSIONS.CHANGE_PERMISSION}><MenuItem><button onClick={() => { setEditingPermission(permission); setNewPermission({ name: permission.name, codename: permission.codename, description: permission.description || '' }); setFormError(null); setShowCreatePermissionModal(true); }} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-surface-muted">{t('permissions.edit')}</button></MenuItem></PermissionGuard>
                  <PermissionGuard permission={PERMISSIONS.PERMISSIONS.DELETE_PERMISSION}><MenuItem><button onClick={() => handleDeletePermission(permission.id)} className="block w-full rounded px-3 py-2 text-left text-sm text-danger-text hover:bg-red-50">{t('images.delete')}</button></MenuItem></PermissionGuard>
                </MenuItems>
              </Menu>

            </div>
            <p className="text-ink-secondary text-sm mb-4">{t(getPermissionDescription(permission.codename))}</p>
            <div className="flex items-center justify-between text-xs text-muted">
              <span>ID: {permission.id}</span>
              <span>{t('images.created_time')}: {new Date().toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>
      
      {/* Pagination Control */}
      <div className="flex justify-center mt-6">
          <Pagination
              current={permissionPage}
              total={totalPermissionCount}
              pageSize={permissionPageSize}
              onChange={(page, pageSize) => {
                  setPermissionPage(page);
                  setPermissionPageSize(pageSize);
              }}
              showSizeChanger
              showQuickJumper
              showTotal={(total) => t('permissions.total_items', { count: total })}
          />
      </div>
    </div>
  );

  // Render roles section
  const renderRoles = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold tracking-normal text-ink">{t('permissions.roles')}</h2>
        <PermissionGuard permission={PERMISSIONS.PERMISSIONS.ADD_ROLE}>
          <button
            onClick={() => { setShowCreateRoleModal(true); setFormError(null); }}
            className={primaryActionClass}
          >
            <Plus className="h-5 w-5" />
            <span>{t('permissions.create_role')}</span>
          </button>
        </PermissionGuard>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {displayRoles.map(role => (
          <div key={role.id} className="rounded-[16px] border border-hairline bg-white p-6 shadow-[0_4px_16px_rgba(17,24,28,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Shield className="h-6 w-6 text-accent-text" />
                </div>
                <div>
                  <h3 className="font-semibold text-ink">{role.name}</h3>
                  <p className="text-sm text-ink-secondary">{t('permissions.user_count', { count: role.user_count ?? 0 })}</p>
                </div>
              </div>
              <Menu as="div" className="relative inline-block text-left">
                <MenuButton className="p-2 hover:bg-white rounded-lg transition-colors">
                  <MoreVertical className="h-4 w-4 text-muted" />
                </MenuButton>
                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <MenuItems className="absolute right-0 mt-2 w-32 origin-top-right bg-white divide-y divide-gray-100 rounded-xl shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-10">
                    <div className="p-1">
                      <PermissionGuard permission={PERMISSIONS.PERMISSIONS.CHANGE_ROLE}>
                        <MenuItem>
                          {({ focus }) => (
                            <button 
                              onClick={() => {
                                setEditingRole(role);
                                setSelectedPermissions(role.permissions || []);
                                setShowEditRoleModal(true);
                              }}
                              className={`${focus ? 'bg-surface-muted' : ''} group flex rounded-lg items-center w-full p-2 text-sm text-ink-secondary`}
                            >
                              {t('permissions.edit_role')}
                            </button>
                          )}
                        </MenuItem>
                      </PermissionGuard>
                      <PermissionGuard permission={PERMISSIONS.PERMISSIONS.DELETE_ROLE}>
                        <MenuItem>
                          {({ focus }: { focus: boolean }) => (
                            <button 
                              onClick={() => handleDeleteRole(role.id)}
                              className={`${focus ? 'bg-red-50' : ''} group flex rounded-lg items-center w-full p-2 text-sm text-danger-text`}
                            >
                              {t('images.delete')}
                            </button>
                          )}
                        </MenuItem>
                      </PermissionGuard>
                    </div>
                  </MenuItems>
                </Transition>
              </Menu>
            </div>
            <p className="text-ink-secondary text-sm mb-4">{role.description}</p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">{t('permissions.permission_count', { count: role.permissions_count ?? role.permissions?.length ?? 0 })}</span>
              <button 
                onClick={() => {
                  setEditingRole(role);
                  setSelectedPermissions(role.permissions || []);
                  setShowEditRoleModal(true);
                }}
                className="text-accent-text hover:text-blue-700 text-sm font-medium transition-colors"
              >
                {t('permissions.view_permissions')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination Control */}
      <div className="flex justify-center mt-6">
          <Pagination
              current={rolePage}
              total={totalRoleCount}
              pageSize={rolePageSize}
              onChange={(page, pageSize) => {
                  setRolePage(page);
                  setRolePageSize(pageSize);
              }}
              showSizeChanger
              showQuickJumper
              showTotal={(total) => t('permissions.total_items', { count: total })}
          />
      </div>
    </div>
  );

  // Render users section
  const renderUsers = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold tracking-normal text-ink">{t('permissions.users')}</h2>
        <PermissionGuard permission={PERMISSIONS.PERMISSIONS.ADD_USER}>
          <button
            onClick={() => { setShowCreateUserModal(true); setFormError(null); }}
            className={primaryActionClass}
          >
            <Plus className="h-5 w-5" />
            <span>{t('permissions.create_user')}</span>
          </button>
        </PermissionGuard>
      </div>

      <div className="overflow-hidden rounded-[16px] border border-hairline/80 bg-white shadow-[0_4px_16px_rgba(17,24,28,0.05)]">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-muted">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted">{t('permissions.user')}</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted">{t('permissions.email')}</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted">{t('permissions.role')}</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted">{t('permissions.status')}</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted">{t('permissions.last_login')}</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted">{t('permissions.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayUsers.map(user => (
                <tr key={user.id} className="transition-colors hover:bg-white">
                  <td className="px-6 py-4">
                    <div>
                      <div className="font-medium text-ink">{user.username}</div>
                      <div className="text-sm text-ink-secondary">{user.first_name} {user.last_name}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-ink">{user.email}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {(() => {
                        const resolvedRoleNames = user.role_names?.length
                          ? user.role_names
                          : user.roles?.map(roleId => {
                              const role = roles.find(r => String(r.id) === String(roleId));
                              return role?.name;
                            }).filter(Boolean) || [];
                        const roleNames = resolvedRoleNames.length
                          ? resolvedRoleNames
                          : (user.is_superuser ? [i18n.language === 'zh' ? '超级管理员' : 'Superuser'] : []);

                        return roleNames.map(roleName => {
                        return roleName ? (
                          <span key={roleName} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                            {roleName}
                          </span>
                        ) : null;
                        });
                      })()}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      {user.is_active ? (
                        <CheckCircle className="h-5 w-5 text-accent-text" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-500" />
                      )}
                      <span className="ml-2 text-sm font-medium">
                        {user.is_active ? t('permissions.active') : t('permissions.inactive')}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted">
                    {user.last_login ? new Date(user.last_login).toLocaleString(i18n.language === 'zh' ? 'zh-CN' : 'en-US') : t('permissions.never_login')}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      <PermissionGuard permission={PERMISSIONS.PERMISSIONS.ASSIGN_USER_ROLES}>
                        <button
                          onClick={() => {
                            setSelectedUser(user);
                            setSelectedUserRoles(user.roles || []);
                            setShowAssignRoleModal(true);
                          }}
                          className="p-2 text-accent-text hover:bg-[rgba(10,132,255,0.08)] rounded-lg transition-colors"
                          title={t('permissions.assign_user_roles')}
                        >
                          <Users className="h-4 w-4" />
                        </button>
                      </PermissionGuard>
                      <PermissionGuard permission={PERMISSIONS.PERMISSIONS.CHANGE_USER}>
                        <button
                          onClick={() => {
                            setEditingUser(user);
                            setShowEditUserModal(true);
                          }}
                          className="p-2 text-accent-text hover:bg-[rgba(10,132,255,0.08)] rounded-lg transition-colors"
                          title={t('permissions.edit_user')}
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                      </PermissionGuard>
                      <PermissionGuard permission={PERMISSIONS.PERMISSIONS.DELETE_USER}>
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="p-2 text-danger-text hover:bg-red-50 rounded-lg transition-colors"
                          title={t('images.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </PermissionGuard>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination Control */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-center">
            <Pagination
                current={userPage}
                total={totalUserCount}
                pageSize={userPageSize}
                onChange={(page, pageSize) => {
                    setUserPage(page);
                    setUserPageSize(pageSize);
                }}
                showSizeChanger
                showQuickJumper
                showTotal={(total) => t('permissions.total_items', { count: total })}
            />
        </div>
      </div>
    </div>
  );

  // Global permission check: Only users with permission management related permissions can access
  const { hasAnyPermission, isLoading } = usePermission();
  
  // Define basic permissions required for permission management
  const requiredPermissions = [
    PERMISSIONS.PERMISSIONS.VIEW_PERMISSION,
    PERMISSIONS.PERMISSIONS.VIEW_ROLE,
    PERMISSIONS.PERMISSIONS.VIEW_USER
  ];
  
  // Loading state
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-sunken p-6">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-accent-line/20 border-t-brand-fill"></div>
      </div>
    );
  }
  
  // Permission denied state
  if (!hasAnyPermission(requiredPermissions)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-sunken p-6">
        <div className="max-w-md rounded-[16px] border border-[rgba(243,18,96,0.24)] bg-white p-8 text-center shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
          <AlertCircle className="h-12 w-12 text-danger-text mx-auto mb-4" />
          <h2 className="mb-2 text-xl font-semibold text-red-800">{t('permissions.access_denied')}</h2>
          <p className="text-red-700">{t('permissions.access_denied_desc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="w-full space-y-4">
        {/* Header stats cards */}
        <div className="grid grid-cols-2 gap-2 border-b border-hairline pb-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard 
            icon={Key} 
            title={t('permissions.total_permissions')} 
            value={totalPermissionCount || permissions?.length || 0} 
            color="text-purple-600" 
          />
          <StatCard 
            icon={Shield} 
            title={t('permissions.total_roles')} 
            value={totalRoleCount || roles?.length || 0} 
            color="text-accent-text" 
          />
          <StatCard 
            icon={Users} 
            title={t('permissions.total_users')} 
            value={totalUserCount || users?.length || 0} 
            color="text-accent-text" 
          />
          <StatCard 
            icon={Users} 
            title={t('permissions.today_guests')} 
            value={guestStats.today_count} 
            color="text-orange-600" 
          />
          <StatCard 
            icon={Users} 
            title={t('permissions.total_guests')} 
            value={guestStats.total_count} 
            color="text-indigo-600" 
          />
        </div>

        {/* Main content area */}
        <div className="min-w-0 bg-white">
          {/* Tab navigation */}
          <div className="border-b border-hairline bg-white px-4 py-4 sm:px-6">
            <div className="flex flex-wrap gap-2">
              <TabButton 
                active={activeTab === 'permissions'} 
                onClick={() => setActiveTab('permissions')}
              >
                <Key className="h-4 w-4 mr-2" />
                {t('permissions.permissions')}
              </TabButton>
              <TabButton 
                active={activeTab === 'roles'} 
                onClick={() => setActiveTab('roles')}
              >
                <Shield className="h-4 w-4 mr-2" />
                {t('permissions.roles')}
              </TabButton>
              <TabButton 
                active={activeTab === 'users'} 
                onClick={() => setActiveTab('users')}
              >
                <Users className="h-4 w-4 mr-2" />
                {t('permissions.users')}
              </TabButton>
              <TabButton 
                active={activeTab === 'editor'} 
                onClick={() => setActiveTab('editor')}
              >
                <Edit3 className="h-4 w-4 mr-2" />
                {editorTabLabel}
              </TabButton>
              <PermissionGuard permission={PERMISSIONS.PERMISSIONS.VIEW_AUDIT_LOGS}>
                <TabButton 
                  active={activeTab === 'audit'} 
                  onClick={() => setActiveTab('audit')}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {t('permissions.audit')}
                </TabButton>
              </PermissionGuard>
            </div>
          </div>

          {/* Search and filter bar */}
          {activeTab !== 'editor' && (
          <div className="border-b border-hairline bg-white px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted" />
                <input
                  type="text"
                  placeholder={t('permissions.search_placeholder', { 
                    type: activeTab === 'permissions' ? t('permissions.permissions') : 
                          activeTab === 'roles' ? t('permissions.roles') : t('permissions.users') 
                  })}
                  value={searchTerm}
                  onChange={(e) => {
                      setSearchTerm(e.target.value);
                      if (activeTab === 'users') setUserPage(1); // Reset to first page when search changes
                  }}
                  className="w-full rounded-full border border-hairline bg-white py-3 pl-10 pr-4 text-sm text-ink outline-none transition focus:border-accent-line focus:bg-white focus:ring-4 focus:ring-accent-line/15"
                />
              </div>
              {activeTab === 'users' && (
                <div className="flex items-center gap-3">
                  <Filter className="h-4 w-4 text-muted" />
                  <select
                    value={filterActive === null ? '' : filterActive.toString()}
                    aria-label={t('permissions.filter_status')}
                    onChange={(e) => setFilterActive(e.target.value === '' ? null : e.target.value === 'true')}
                    className="rounded-full border border-hairline bg-white px-4 py-3 text-sm text-ink-secondary outline-none transition focus:border-accent-line focus:bg-white focus:ring-4 focus:ring-accent-line/15"
                  >
                    <option value="">{t('permissions.all_status')}</option>
                    <option value="true">{t('permissions.active')}</option>
                    <option value="false">{t('permissions.inactive')}</option>
                  </select>
                </div>
              )}
            </div>
          </div>
          )}

          {/* Content area */}
          <div className="p-4 sm:p-6">
            {activeTab === 'permissions' && renderPermissions()}
            {activeTab === 'roles' && renderRoles()}
            {activeTab === 'users' && renderUsers()}
            {activeTab === 'editor' && <UserPermissionEditor />}
            {activeTab === 'audit' && (
              <PermissionGuard permission={PERMISSIONS.PERMISSIONS.VIEW_AUDIT_LOGS}>
                <AuditLogs />
              </PermissionGuard>
            )}
          </div>
        </div>

        {/* Create permission modal */}
        {showCreatePermissionModal && (
          <div className="fixed inset-0 bg-[rgba(15,23,42,0.28)] z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-[16px] card shadow-[0_32px_110px_rgba(15,23,42,0.14)]">
              <div className="rounded-t-[16px] border-b border-hairline bg-brand-fill px-6 py-5">
                <div className="flex items-center space-x-3">
                  <Plus className="h-6 w-6 text-white" />
                  <h3 className="text-xl font-semibold text-white">{editingPermission ? t('permissions.edit') : t('permissions.create_permission')}</h3>
                </div>
              </div>
              <form onSubmit={handleCreatePermission}>
                <div className="px-6 py-6 space-y-5">
                  {formError && (
                    <div className="bg-red-50 border border-red-200 text-danger-text px-4 py-3 rounded-xl text-sm flex items-center">
                      <AlertCircle className="h-5 w-5 mr-2" />
                      {formError}
                    </div>
                  )}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.permission_name')}</label>
                      <input
                        type="text"
                        required
                        value={newPermission.name}
                        onChange={(e) => setNewPermission({...newPermission, name: e.target.value})}
                        className={fieldClass}
                        placeholder={t('permissions.permission_name')}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.permission_codename')}</label>
                      <input
                        type="text"
                        required
                        value={newPermission.codename}
                        onChange={(e) => setNewPermission({...newPermission, codename: e.target.value})}
                        className={fieldClass}
                        placeholder={t('permissions.permission_codename')}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.permission_description')}</label>
                      <textarea
                        value={newPermission.description}
                        onChange={(e) => setNewPermission({...newPermission, description: e.target.value})}
                        className={`${fieldClass} min-h-[100px]`}
                        placeholder={t('permissions.permission_description')}
                      />
                    </div>
                  </div>
                </div>
                <div className="px-6 py-5 card-soft/50 rounded-b-2xl flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowCreatePermissionModal(false)}
                    className={secondaryActionClass}
                  >
                    {t('permissions.cancel')}
                  </button>
                  <button
                    type="submit"
                    className={primaryActionClass}
                  >
                    {editingPermission ? t('common.save') : t('permissions.create')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Create role modal */}
        {showCreateRoleModal && (
          <div className="fixed inset-0 bg-[rgba(15,23,42,0.28)] z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-[16px] card shadow-[0_32px_110px_rgba(15,23,42,0.14)]">
              <div className="rounded-t-[16px] border-b border-hairline bg-brand-fill px-6 py-5">
                <div className="flex items-center space-x-3">
                  <Plus className="h-6 w-6 text-white" />
                  <h3 className="text-xl font-semibold text-white">{t('permissions.create_role')}</h3>
                </div>
              </div>
              <form onSubmit={handleCreateRole}>
                <div className="px-6 py-6 space-y-5">
                  {formError && (
                    <div className="bg-red-50 border border-red-200 text-danger-text px-4 py-3 rounded-xl text-sm flex items-center">
                      <AlertCircle className="h-5 w-5 mr-2" />
                      {formError}
                    </div>
                  )}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.role_name')}</label>
                      <input
                        type="text"
                        required
                        value={newRole.name}
                        onChange={(e) => setNewRole({...newRole, name: e.target.value})}
                        className={fieldClass}
                        placeholder={t('permissions.role_name')}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.role_description')}</label>
                      <textarea
                        value={newRole.description}
                        onChange={(e) => setNewRole({...newRole, description: e.target.value})}
                        className={`${fieldClass} min-h-[100px]`}
                        placeholder={t('permissions.role_description')}
                      />
                    </div>
                  </div>
                </div>
                <div className="px-6 py-5 card-soft/50 rounded-b-2xl flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowCreateRoleModal(false)}
                    className={secondaryActionClass}
                  >
                    {t('permissions.cancel')}
                  </button>
                  <button
                    type="submit"
                    className={primaryActionClass}
                  >
                    {t('permissions.create')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Create user modal */}
        {showCreateUserModal && (
          <div className="fixed inset-0 bg-[rgba(15,23,42,0.28)] z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-[16px] card shadow-[0_32px_110px_rgba(15,23,42,0.14)]">
              <div className="rounded-t-[16px] border-b border-hairline bg-brand-fill px-6 py-5">
                <div className="flex items-center space-x-3">
                  <Plus className="h-6 w-6 text-white" />
                  <h3 className="text-xl font-semibold text-white">{t('permissions.create_user')}</h3>
                </div>
              </div>
              <form onSubmit={handleCreateUser}>
                <div className="px-6 py-6 space-y-5">
                  {formError && (
                    <div className="bg-red-50 border border-red-200 text-danger-text px-4 py-3 rounded-xl text-sm flex items-center">
                      <AlertCircle className="h-5 w-5 mr-2" />
                      {formError}
                    </div>
                  )}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.username')}</label>
                      <input
                        type="text"
                        required
                        value={newUser.username}
                        onChange={(e) => setNewUser({...newUser, username: e.target.value})}
                        className={fieldClass}
                        placeholder={t('permissions.username')}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.email')}</label>
                      <input
                        type="email"
                        required
                        value={newUser.email}
                        onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                        className={fieldClass}
                        placeholder={t('permissions.email')}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.password')}</label>
                      <input
                        type="password"
                        required
                        value={newUser.password}
                        onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                        className={fieldClass}
                        placeholder={t('permissions.password')}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.first_name')}</label>
                        <input
                          type="text"
                          value={newUser.first_name}
                          onChange={(e) => setNewUser({...newUser, first_name: e.target.value})}
                          className={fieldClass}
                          placeholder={t('permissions.first_name')}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.last_name')}</label>
                        <input
                          type="text"
                          value={newUser.last_name}
                          onChange={(e) => setNewUser({...newUser, last_name: e.target.value})}
                          className={fieldClass}
                          placeholder={t('permissions.last_name')}
                        />
                      </div>
                    </div>
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={newUser.is_active}
                        onChange={(e) => setNewUser({...newUser, is_active: e.target.checked})}
                        className="h-4 w-4 text-accent-text focus:ring-accent-line border-hairline-strong rounded"
                      />
                      <label className="ml-2 block text-sm text-ink">{t('permissions.active_user')}</label>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-5 card-soft/50 rounded-b-2xl flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowCreateUserModal(false)}
                    className={secondaryActionClass}
                  >
                    {t('permissions.cancel')}
                  </button>
                  <button
                    type="submit"
                    className={primaryActionClass}
                  >
                    {t('permissions.create')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit role modal */}
        {showEditRoleModal && editingRole && (
          <div className="fixed inset-0 bg-[rgba(15,23,42,0.28)] z-50 flex items-center justify-center p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[16px] card shadow-[0_32px_110px_rgba(15,23,42,0.14)]">
              <div className="sticky top-0 z-10 rounded-t-[16px] border-b border-hairline bg-brand-fill px-6 py-5">
                <div className="flex items-center space-x-3">
                  <Edit3 className="h-6 w-6 text-white" />
                  <h3 className="text-xl font-semibold text-white">{t('permissions.edit_role')}</h3>
                </div>
              </div>
              <form onSubmit={handleUpdateRole}>
                <div className="px-6 py-6 space-y-5">
                  {formError && (
                    <div className="bg-red-50 border border-red-200 text-danger-text px-4 py-3 rounded-xl text-sm flex items-center">
                      <AlertCircle className="h-5 w-5 mr-2" />
                      {formError}
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.role_name')}</label>
                      <input
                        type="text"
                        required
                        value={editingRole.name}
                        onChange={(e) => setEditingRole({...editingRole, name: e.target.value})}
                        className={fieldClass}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.role_description')}</label>
                      <textarea
                        value={editingRole.description}
                        onChange={(e) => setEditingRole({...editingRole, description: e.target.value})}
                        className={`${fieldClass} min-h-[80px]`}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-ink-secondary mb-3">{t('permissions.permissions')}</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto p-2 border border-gray-100 rounded-xl bg-surface-muted">
                      {permissions.map(perm => (
                        <div key={perm.id} className="flex items-start space-x-3 p-2 hover:card rounded-lg transition-colors">
                          <input
                            type="checkbox"
                            id={`perm-${perm.id}`}
                            checked={selectedPermissions.includes(perm.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPermissions([...selectedPermissions, perm.id]);
                              } else {
                                setSelectedPermissions(selectedPermissions.filter(id => id !== perm.id));
                              }
                            }}
                            className="mt-1 h-4 w-4 text-accent-text focus:ring-blue-500 border-hairline-strong rounded"
                          />
                          <label htmlFor={`perm-${perm.id}`} className="text-sm cursor-pointer select-none">
                            <div className="font-medium text-ink">{perm.name}</div>
                            <div className="text-xs text-muted">{t(getPermissionDescription(perm.codename))}</div>
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="px-6 py-5 card-soft/50 rounded-b-2xl flex justify-end space-x-3 sticky bottom-0 z-10">
                  <button
                    type="button"
                    onClick={() => { setShowEditRoleModal(false); setEditingRole(null); }}
                    className={secondaryActionClass}
                  >
                    {t('permissions.cancel')}
                  </button>
                  <button
                    type="submit"
                    className={primaryActionClass}
                  >
                    {t('permissions.save_changes')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Assign role modal */}
        {showAssignRoleModal && selectedUser && (
          <div className="fixed inset-0 bg-[rgba(15,23,42,0.28)] z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-[16px] card shadow-[0_32px_110px_rgba(15,23,42,0.14)]">
              <div className="rounded-t-[16px] border-b border-hairline bg-brand-fill px-6 py-5">
                <div className="flex items-center space-x-3">
                  <Shield className="h-6 w-6 text-white" />
                  <h3 className="text-xl font-semibold text-white">{t('permissions.assign_roles')}</h3>
                </div>
                <p className="text-purple-100 text-sm mt-1">{t('permissions.assign_roles_for', { user: selectedUser.username })}</p>
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                handleAssignUserRoles(selectedUser.id, selectedUserRoles);
              }}>
                <div className="px-6 py-6">
                  <div className="space-y-3 max-h-60 overflow-y-auto">
                    {roles.map(role => (
                      <div key={role.id} className="flex items-center space-x-3 p-3 border border-gray-100 rounded-xl hover:bg-white transition-colors">
                        <input
                          type="checkbox"
                          id={`role-${role.id}`}
                          checked={selectedUserRoles.includes(role.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedUserRoles([...selectedUserRoles, role.id]);
                            } else {
                              setSelectedUserRoles(selectedUserRoles.filter(id => id !== role.id));
                            }
                          }}
                          className="h-5 w-5 text-purple-600 focus:ring-purple-500 border-hairline-strong rounded"
                        />
                        <label htmlFor={`role-${role.id}`} className="flex-1 cursor-pointer select-none">
                          <div className="font-medium text-ink">{role.name}</div>
                          <div className="text-xs text-muted">{role.description}</div>
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="px-6 py-5 card-soft/50 rounded-b-2xl flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => { setShowAssignRoleModal(false); setSelectedUser(null); }}
                    className={secondaryActionClass}
                  >
                    {t('permissions.cancel')}
                  </button>
                  <button
                    type="submit"
                    className={primaryActionClass}
                  >
                    {t('permissions.save_changes')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit user modal */}
        {showEditUserModal && editingUser && (
          <div className="fixed inset-0 bg-[rgba(15,23,42,0.28)] z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-[16px] card shadow-[0_32px_110px_rgba(15,23,42,0.14)]">
              <div className="rounded-t-[16px] border-b border-hairline bg-brand-fill px-6 py-5">
                <div className="flex items-center space-x-3">
                  <Edit3 className="h-6 w-6 text-white" />
                  <h3 className="text-xl font-semibold text-white">{t('permissions.edit_user')}</h3>
                </div>
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                handleEditUser(editingUser);
              }}>
                <div className="px-6 py-6 space-y-5">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.username')}</label>
                      <input
                        type="text"
                        required
                        value={editingUser.username}
                        onChange={(e) => setEditingUser({...editingUser, username: e.target.value})}
                        className={fieldClass}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.email')}</label>
                      <input
                        type="email"
                        required
                        value={editingUser.email}
                        onChange={(e) => setEditingUser({...editingUser, email: e.target.value})}
                        className={fieldClass}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.first_name')}</label>
                        <input
                          type="text"
                          value={editingUser.first_name || ''}
                          onChange={(e) => setEditingUser({...editingUser, first_name: e.target.value})}
                          className={fieldClass}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-ink-secondary mb-2">{t('permissions.last_name')}</label>
                        <input
                          type="text"
                          value={editingUser.last_name || ''}
                          onChange={(e) => setEditingUser({...editingUser, last_name: e.target.value})}
                          className={fieldClass}
                        />
                      </div>
                    </div>
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={editingUser.is_active}
                        onChange={(e) => setEditingUser({...editingUser, is_active: e.target.checked})}
                        className="h-4 w-4 text-accent-text focus:ring-accent-line border-hairline-strong rounded"
                      />
                      <label className="ml-2 block text-sm text-ink">{t('permissions.active_user')}</label>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-5 card-soft/50 rounded-b-2xl flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => { setShowEditUserModal(false); setEditingUser(null); }}
                    className={secondaryActionClass}
                  >
                    {t('permissions.cancel')}
                  </button>
                  <button
                    type="submit"
                    className={primaryActionClass}
                  >
                    {t('permissions.save_changes')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PermissionManagement;
