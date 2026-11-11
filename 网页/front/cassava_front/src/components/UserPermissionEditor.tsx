import { modal } from '../utils/feedback';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Save, 
  RotateCcw, 
  Copy, 
  FileText, 
  Search, 
  ChevronRight, 
  ChevronDown, 
  Shield, 
  Check,
  User as UserIcon,
  AlertCircle,
  Plus,
  History,
  Key
} from 'lucide-react';
import { permissionsApi } from '../services/api';

import { useTranslation } from 'react-i18next';

interface Permission {
  id: number;
  name: string;
  codename: string;
  category: string;
  description: string;
}

interface PermissionTemplate {
  id: number;
  name: string;
  description: string;
  permission_ids: number[];
}

interface User {
  id: number;
  username: string;
  email: string;
}

const UserPermissionEditor: React.FC = () => {
  const { t } = useTranslation();
  const fieldClass = 'w-full rounded-2xl border border-hairline bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-accent-line focus:ring-4 focus:ring-accent-line/15';
  const darkButtonClass = 'inline-flex items-center rounded-full bg-brand-fill px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';
  const softButtonClass = 'inline-flex items-center rounded-full border border-hairline bg-white px-4 py-2.5 text-sm font-medium text-ink-secondary transition hover:border-hairline-strong hover:bg-white';
  
  // Data State
  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [templates, setTemplates] = useState<PermissionTemplate[]>([]);
  
  // Selection State
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // UI State
  const [saving, setSaving] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [notification, setNotification] = useState<{type: 'success' | 'error', message: string} | null>(null);
  const [activeTab, setActiveTab] = useState<'permissions' | 'history'>('permissions');
  const [logs, setLogs] = useState<any[]>([]);

  // Modals State
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
  const [sourceUser, setSourceUser] = useState<User | null>(null);
  const [copySearchQuery, setCopySearchQuery] = useState('');
  
  const [isSaveTemplateModalOpen, setIsSaveTemplateModalOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDesc, setNewTemplateDesc] = useState('');

  const showNotification = useCallback((type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const fetchInitialData = useCallback(async () => {
    try {
      const [usersData, permissionsData, templatesData] = await Promise.all([
        permissionsApi.getAllUsers(),
        permissionsApi.getAllPermissions(),
        permissionsApi.getAllPermissionTemplates()
      ]);
      
      // Ensure data is array
      setUsers(Array.isArray(usersData) ? usersData : (usersData.results || []));
      setPermissions(Array.isArray(permissionsData) ? permissionsData : (permissionsData.results || []));
      setTemplates(Array.isArray(templatesData) ? templatesData : []);
    } catch (error) {
      console.error('Failed to load data:', error);
      showNotification('error', t('user_permission_editor.load_initial_failed'));
      // Initialize with empty arrays on error to prevent crashes
      setUsers([]);
      setPermissions([]);
      setTemplates([]);
    }
  }, [showNotification, t]);

  const fetchUserPermissions = useCallback(async (userId: number) => {
    try {
      const data = await permissionsApi.getUserDetailedPermissions(userId.toString());
      setSelectedPermissions(data.direct_permission_ids);
    } catch {
      showNotification('error', t('user_permission_editor.load_user_permissions_failed'));
    }
  }, [showNotification, t]);

  const fetchUserLogs = useCallback(async (userId: number) => {
    try {
      const res = await permissionsApi.getAuditLogs({
        resourceType: 'UserPermission',
        resourceId: userId.toString(),
      });
      setLogs(Array.isArray(res) ? res : (res.results || []));
    } catch (error) {
      console.error("Failed to fetch logs", error);
    }
  }, []);

  useEffect(() => {
    void fetchInitialData();
  }, [fetchInitialData]);

  useEffect(() => {
    if (selectedUser) void fetchUserPermissions(selectedUser.id);
    else {
      setSelectedPermissions([]);
      setLogs([]);
    }
  }, [fetchUserPermissions, selectedUser]);

  useEffect(() => {
    if (selectedUser && activeTab === 'history') void fetchUserLogs(selectedUser.id);
  }, [activeTab, fetchUserLogs, selectedUser]);

  const handleSave = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      await permissionsApi.updateUserPermissions(selectedUser.id.toString(), selectedPermissions);
      showNotification('success', t('user_permission_editor.update_permissions_success'));
      // Refresh logs if on history tab
      if (activeTab === 'history') {
        fetchUserLogs(selectedUser.id);
      }
    } catch {
      showNotification('error', t('user_permission_editor.update_permissions_failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!newTemplateName.trim()) return;
    try {
      const newTemplate = await permissionsApi.createPermissionTemplate({
        name: newTemplateName,
        description: newTemplateDesc,
        permission_ids: selectedPermissions
      });
      setTemplates([...templates, newTemplate]);
      setIsSaveTemplateModalOpen(false);
      setNewTemplateName('');
      setNewTemplateDesc('');
      showNotification('success', t('user_permission_editor.save_template_success'));
    } catch {
      showNotification('error', t('user_permission_editor.save_template_failed'));
    }
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const togglePermission = (permissionId: number) => {
    setSelectedPermissions(prev => 
      prev.includes(permissionId)
        ? prev.filter(id => id !== permissionId)
        : [...prev, permissionId]
    );
  };

  const toggleCategoryPermissions = (_category: string, permissionIds: number[]) => {
    const allSelected = permissionIds.every(id => selectedPermissions.includes(id));
    if (allSelected) {
      setSelectedPermissions(prev => prev.filter(id => !permissionIds.includes(id)));
    } else {
      setSelectedPermissions(prev => [...new Set([...prev, ...permissionIds])]);
    }
  };

  const applyTemplate = (templateId: string) => {
    const template = templates.find(t => t.id === Number(templateId));
    if (!template) return;
    modal.confirm({
      title: t('user_permission_editor.apply_template_title', { defaultValue: '应用权限模板' }),
      content: t('user_permission_editor.apply_template_confirm', { name: template.name }),
      okText: t('common.confirm', { defaultValue: '确认' }),
      cancelText: t('common.cancel', { defaultValue: '取消' }),
      centered: true,
      onOk: () => setSelectedPermissions(template.permission_ids),
    });
  };

  const handleCopyFromUser = async () => {
    if (!sourceUser) return;
    try {
      const data = await permissionsApi.getUserDetailedPermissions(sourceUser.id.toString());
      setSelectedPermissions(data.direct_permission_ids);
      setIsCopyModalOpen(false);
      showNotification('success', t('user_permission_editor.copied_from_user', { username: sourceUser.username }));
    } catch {
      showNotification('error', t('user_permission_editor.copy_permissions_failed'));
    }
  };

  const groupedPermissions = useMemo(() => {
    const groups: {[key: string]: Permission[]} = {};
    permissions.forEach(p => {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push(p);
    });
    return groups;
  }, [permissions]);

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredCopyUsers = users.filter(u => 
    u.username.toLowerCase().includes(copySearchQuery.toLowerCase()) || 
    u.email.toLowerCase().includes(copySearchQuery.toLowerCase())
  );

  return (
    <div className="flex min-h-[720px] rounded-[16px] border border-hairline/80 bg-surface-sunken shadow-[0_4px_16px_rgba(17,24,28,0.05)] overflow-hidden">
      {/* Sidebar - User List */}
      <div className="flex w-full flex-col border-r border-hairline bg-white lg:w-[320px]">
        <div className="border-b border-hairline px-5 py-5">
          <h2 className="mb-4 flex items-center text-lg font-semibold text-ink">
            <UserIcon className="mr-2 h-5 w-5 text-accent-text" />
            {t('user_permission_editor.users_title')}
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder={t('user_permission_editor.search_users_placeholder')}
              className="w-full rounded-full border border-hairline bg-white py-3 pl-9 pr-4 text-sm text-ink outline-none transition focus:border-accent-line focus:bg-white focus:ring-4 focus:ring-accent-line/15"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredUsers.map(user => (
            <div
              key={user.id}
              onClick={() => setSelectedUser(user)}
              className={`cursor-pointer border-b border-slate-100 px-5 py-4 transition-colors ${
                selectedUser?.id === user.id ? 'border-l-4 border-l-brand-fill bg-[rgba(10,132,255,0.08)]/70' : 'border-l-4 border-l-transparent hover:bg-white'
              }`}
            >
              <div className="font-medium text-ink">{user.username}</div>
              <div className="text-xs text-muted">{user.email}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content - Permission Editor */}
      <div className="flex flex-1 flex-col bg-surface-sunken">
        {selectedUser ? (
          <>
            {/* Toolbar */}
            <div className="z-10 border-b border-hairline bg-white">
              <div className="flex flex-col justify-between gap-4 px-5 py-5 xl:flex-row xl:items-center">
                <div className="flex items-center space-x-4">
                  <h2 className="text-xl font-semibold text-ink">
                    {t('user_permission_editor.editing')} <span className="text-accent-text">{selectedUser.username}</span>
                  </h2>
                </div>
                
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center space-x-2 rounded-full border border-hairline bg-surface-muted p-1.5">
                    <select 
                      className="w-40 border-none bg-transparent text-sm text-ink-secondary focus:ring-0"
                      onChange={(e) => applyTemplate(e.target.value)}
                      value=""
                    >
                      <option value="" disabled>{t('user_permission_editor.load_template')}</option>
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <div className="h-4 w-px bg-gray-300"></div>
                    <button 
                      onClick={() => setIsSaveTemplateModalOpen(true)}
                      className="rounded-full p-2 text-ink-secondary transition hover:bg-white"
                      title={t('user_permission_editor.save_current_as_template')}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  <button
                    onClick={() => setIsCopyModalOpen(true)}
                    className={softButtonClass}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    {t('user_permission_editor.copy_from')}
                  </button>
                  <button
                    onClick={() => fetchUserPermissions(selectedUser.id)}
                    className={softButtonClass}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {t('user_permission_editor.reset')}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className={darkButtonClass}
                  >
                    {saving ? t('user_permission_editor.saving') : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        {t('user_permission_editor.save_changes')}
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-2 px-5 pb-4">
                <button
                  onClick={() => setActiveTab('permissions')}
                  className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === 'permissions' 
                      ? 'bg-brand-fill text-white' 
                      : 'text-muted hover:bg-white hover:text-ink'
                  }`}
                >
                  <Key className="w-4 h-4 mr-2" />
                  {t('user_permission_editor.tab_permissions')}
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === 'history' 
                      ? 'bg-brand-fill text-white' 
                      : 'text-muted hover:bg-white hover:text-ink'
                  }`}
                >
                  <History className="w-4 h-4 mr-2" />
                  {t('user_permission_editor.tab_history')}
                </button>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-5">
              {activeTab === 'permissions' ? (
                // Permission Tree
                Object.entries(groupedPermissions).map(([category, perms]) => {
                  const isExpanded = expandedCategories.includes(category);
                  const categoryPermissionIds = perms.map(p => p.id);
                  const selectedCount = perms.filter(p => selectedPermissions.includes(p.id)).length;
                  const isAllSelected = selectedCount === perms.length;
                  const isIndeterminate = selectedCount > 0 && selectedCount < perms.length;

                  return (
                    <div key={category} className="mb-4 overflow-hidden rounded-[16px] border border-hairline bg-white shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
                      <div 
                        className="flex cursor-pointer items-center justify-between bg-surface-muted px-4 py-4 transition-colors hover:bg-white"
                        onClick={() => toggleCategory(category)}
                      >
                        <div className="flex items-center space-x-3">
                          {isExpanded ? <ChevronDown className="w-5 h-5 text-muted" /> : <ChevronRight className="w-5 h-5 text-muted" />}
                          <span className="font-semibold capitalize text-ink">{category}</span>
                          <span className="rounded-full bg-hairline px-2 py-0.5 text-xs text-ink-secondary">
                            {selectedCount}/{perms.length}
                          </span>
                        </div>
                        <div 
                          className="flex items-center space-x-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            className="w-5 h-5 rounded border-hairline-strong text-purple-600 focus:ring-purple-500"
                            checked={isAllSelected}
                            ref={input => {
                              if (input) input.indeterminate = isIndeterminate;
                            }}
                            onChange={() => toggleCategoryPermissions(category, categoryPermissionIds)}
                          />
                        </div>
                      </div>
                      
                      {isExpanded && (
                        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 p-4 md:grid-cols-2 lg:grid-cols-3">
                          {perms.map(perm => (
                            <div 
                              key={perm.id} 
                              className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                selectedPermissions.includes(perm.id) 
                                  ? 'border-[rgba(23,201,100,0.28)] bg-[rgba(10,132,255,0.08)]' 
                                  : 'border-hairline bg-white hover:border-[rgba(23,201,100,0.28)]'
                              }`}
                              onClick={() => togglePermission(perm.id)}
                              title={perm.description}
                            >
                              <input
                                type="checkbox"
                                checked={selectedPermissions.includes(perm.id)}
                                onChange={() => {}} // Handled by div click
                                className="mt-1 h-4 w-4 rounded border-hairline-strong text-accent-text focus:ring-ok"
                              />
                              <div>
                                <div className="text-sm font-medium text-ink">{perm.name}</div>
                                <div className="mt-0.5 text-xs text-muted">{perm.description}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                // History Log
                <div className="space-y-4">
                  {logs.length > 0 ? (
                    logs.map((log) => (
                      <div key={log.id} className="rounded-[16px] border border-hairline bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center space-x-2">
                            <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                              log.success ? 'bg-green-100 text-accent-text' : 'bg-red-100 text-red-700'
                            }`}>
                              {log.success ? t('user_permission_editor.status_success') : t('user_permission_editor.status_failed')}
                            </span>
                            <span className="text-sm font-medium text-ink">{log.action}</span>
                          </div>
                          <span className="text-xs text-muted">{new Date(log.created_at || log.timestamp).toLocaleString()}</span>
                        </div>
                        <div className="text-sm text-ink-secondary mb-2">
                          <span className="font-medium text-ink-secondary">{t('user_permission_editor.operator')}</span> {log.username}
                        </div>
                        {log.details && (
                          <div className="text-xs card-soft p-2 rounded-lg text-ink-secondary font-mono overflow-x-auto whitespace-pre-wrap">
                            {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-10 text-muted">
                      <FileText className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                      <p>{t('user_permission_editor.no_history')}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-muted">
            <Shield className="mb-4 h-16 w-16 text-muted" />
            <p className="text-lg font-medium">{t('user_permission_editor.select_user_tip')}</p>
          </div>
        )}
      </div>

      {/* Notifications */}
      {notification && (
        <div className={`fixed bottom-4 right-4 z-50 flex items-center rounded-full px-6 py-3 text-sm font-medium text-white shadow-[0_4px_16px_rgba(17,24,28,0.05)] animate-fade-in-up ${
          notification.type === 'success' ? 'bg-ok' : 'bg-danger'
        }`}>
          {notification.type === 'success' ? <Check className="w-5 h-5 mr-2" /> : <AlertCircle className="w-5 h-5 mr-2" />}
          {notification.message}
        </div>
      )}

      {/* Copy From User Modal */}
      {isCopyModalOpen && (
        <div className="fixed inset-0 bg-[rgba(15,23,42,0.28)] flex items-center justify-center z-50">
          <div className="w-full max-w-md rounded-[16px] border border-hairline bg-white p-6 shadow-[0_32px_110px_rgba(15,23,42,0.14)]">
            <h3 className="mb-4 text-xl font-semibold text-ink">{t('user_permission_editor.copy_modal_title')}</h3>
            <div className="mb-4">
              <input
                type="text"
                placeholder={t('user_permission_editor.search_source_user_placeholder')}
                className={`${fieldClass} mb-2`}
                value={copySearchQuery}
                onChange={(e) => setCopySearchQuery(e.target.value)}
              />
              <div className="max-h-60 overflow-y-auto rounded-2xl border border-hairline">
                {filteredCopyUsers.map(user => (
                  <div
                    key={user.id}
                    className={`p-3 cursor-pointer hover:bg-white flex justify-between items-center ${
                      sourceUser?.id === user.id ? 'bg-[rgba(10,132,255,0.08)]' : ''
                    }`}
                    onClick={() => setSourceUser(user)}
                  >
                    <span className="font-medium text-ink-secondary">{user.username}</span>
                    {sourceUser?.id === user.id && <Check className="h-4 w-4 text-accent-text" />}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setIsCopyModalOpen(false)}
                className={softButtonClass}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCopyFromUser}
                disabled={!sourceUser}
                className={darkButtonClass}
              >
                {t('user_permission_editor.copy_permissions')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Template Modal */}
      {isSaveTemplateModalOpen && (
        <div className="fixed inset-0 bg-[rgba(15,23,42,0.28)] flex items-center justify-center z-50">
          <div className="w-full max-w-md rounded-[16px] border border-hairline bg-white p-6 shadow-[0_32px_110px_rgba(15,23,42,0.14)]">
            <h3 className="mb-4 text-xl font-semibold text-ink">{t('user_permission_editor.save_template_modal_title')}</h3>
            <div className="mb-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink-secondary">{t('user_permission_editor.template_name')}</label>
                <input
                  type="text"
                  placeholder={t('user_permission_editor.template_name_placeholder')}
                  className={fieldClass}
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink-secondary">{t('user_permission_editor.template_desc')}</label>
                <textarea
                  placeholder={t('user_permission_editor.template_desc_placeholder')}
                  className={`${fieldClass} min-h-[80px]`}
                  value={newTemplateDesc}
                  onChange={(e) => setNewTemplateDesc(e.target.value)}
                />
              </div>
              <div className="text-sm text-muted">
                <p>{t('user_permission_editor.save_template_hint', { count: selectedPermissions.length })}</p>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setIsSaveTemplateModalOpen(false)}
                className={softButtonClass}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveTemplate}
                disabled={!newTemplateName.trim()}
                className={darkButtonClass}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserPermissionEditor;
