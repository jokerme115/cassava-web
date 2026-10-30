import { message } from '../utils/feedback';
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  User, Shield, Lock, Settings, FileText, Bell, Palette, 
  Camera, LogOut, ChevronRight, Mail, BarChart2
} from 'lucide-react';
import { Switch, Input, Button, InputNumber } from 'antd';
import PermissionManagement from './PermissionManagement';
import AuditLogs from './AuditLogs';
import { authApi, systemSettingsApi } from '../services/api';
import { User as UserType } from '../types';

const VisitorAnalytics = lazy(() => import('./VisitorAnalytics'));

interface UserProfileProps {
  currentUser: UserType;
  onLogout: () => void;
  onUpdateUser?: (user: UserType) => void;
}

const MenuButton = ({ icon: Icon, label, active, onClick }: any) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center px-3 py-3 rounded-lg transition-all duration-200 ${
      active 
        ? 'bg-[rgba(10,132,255,0.08)] text-brand-fill-hover font-medium shadow-sm' 
        : 'text-ink-secondary hover:bg-white hover:text-ink'
    }`}
  >
    <Icon className={`w-5 h-5 mr-3 ${active ? 'text-accent-text' : 'text-muted'}`} />
    <span>{label}</span>
    {active && <ChevronRight className="w-4 h-4 ml-auto text-accent-text" />}
  </button>
);

const UserProfile: React.FC<UserProfileProps> = ({ currentUser, onLogout, onUpdateUser }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('profile');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [systemSettingsLoading, setSystemSettingsLoading] = useState(false);
  const [systemSettingsSaving, setSystemSettingsSaving] = useState(false);
  const [maxDisplayImages, setMaxDisplayImages] = useState<number>(200);
  const [maxDisplayResults, setMaxDisplayResults] = useState<number>(100);
  const [enableGuestAccess, setEnableGuestAccess] = useState<boolean>(true);
  const [uploadSizeLimitMb, setUploadSizeLimitMb] = useState<number>(50);
  const [siteTitle, setSiteTitle] = useState<string>('');
  const [siteAnnouncement, setSiteAnnouncement] = useState<string>('');
  const [allowRegistration, setAllowRegistration] = useState<boolean>(true);
  const [maintenanceMode, setMaintenanceMode] = useState<boolean>(false);
  const [guestRetention, setGuestRetention] = useState<number>(7);
  const [auditRetention, setAuditRetention] = useState<number>(180);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);

  // Profile Form State
  const [profileData, setProfileData] = useState({
    first_name: currentUser?.first_name || '',
    last_name: currentUser?.last_name || '',
    email: currentUser?.email || '',
    username: currentUser?.username || '',
    // Add other fields if backend supports (department, etc.)
  });

  // Password Form State
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  useEffect(() => {
    if (currentUser) {
      setProfileData({
        first_name: currentUser.first_name || '',
        last_name: currentUser.last_name || '',
        email: currentUser.email || '',
        username: currentUser.username || '',
      });
      setAvatarLoadFailed(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser?.is_superuser) return;
    if (activeTab !== 'site_settings') return;
    const load = async () => {
      setSystemSettingsLoading(true);
      try {
        const s = await systemSettingsApi.get();
        setMaxDisplayImages(Number(s.maxDisplayImages) || 200);
        setMaxDisplayResults(Number(s.maxDisplayResults) || 100);
        setEnableGuestAccess(s.enableGuestAccess ?? s.enable_guest_access ?? true);
        setAllowRegistration(s.allowRegistration ?? s.allow_registration ?? true);
        setMaintenanceMode(s.maintenanceMode ?? s.maintenance_mode ?? false);
        setSiteTitle(s.siteTitle ?? s.site_title ?? '');
        setSiteAnnouncement(s.siteAnnouncement ?? s.site_announcement ?? '');
        setUploadSizeLimitMb(Number(s.uploadSizeLimitMb ?? s.upload_size_limit_mb) || 50);
        setGuestRetention(Number(s.guestDataRetentionDays ?? s.guest_data_retention_days) || 7);
        setAuditRetention(Number(s.auditLogRetentionDays ?? s.audit_log_retention_days) || 180);
      } catch {
        message.error(t('system.settings_load_failed'));
      } finally {
        setSystemSettingsLoading(false);
      }
    };
    load();
  }, [activeTab, currentUser?.is_superuser, t]);

  const handleSaveSystemSettings = async () => {
    setSystemSettingsSaving(true);
    try {
      const saved = await systemSettingsApi.update({
        maxDisplayImages,
        maxDisplayResults,
        enableGuestAccess,
        allowRegistration,
        maintenanceMode,
        siteTitle,
        siteAnnouncement,
        uploadSizeLimitMb,
        guestDataRetentionDays: guestRetention,
        auditLogRetentionDays: auditRetention,
      });
      setMaxDisplayImages(Number(saved.maxDisplayImages) || maxDisplayImages);
      setMaxDisplayResults(Number(saved.maxDisplayResults) || maxDisplayResults);
      setEnableGuestAccess(saved.enableGuestAccess ?? saved.enable_guest_access ?? enableGuestAccess);
      setAllowRegistration(saved.allowRegistration ?? saved.allow_registration ?? allowRegistration);
      setMaintenanceMode(saved.maintenanceMode ?? saved.maintenance_mode ?? maintenanceMode);
      setSiteTitle(saved.siteTitle ?? saved.site_title ?? siteTitle);
      setSiteAnnouncement(saved.siteAnnouncement ?? saved.site_announcement ?? siteAnnouncement);
      setUploadSizeLimitMb(Number(saved.uploadSizeLimitMb ?? saved.upload_size_limit_mb) || uploadSizeLimitMb);
      setGuestRetention(Number(saved.guestDataRetentionDays ?? saved.guest_data_retention_days) || guestRetention);
      setAuditRetention(Number(saved.auditLogRetentionDays ?? saved.audit_log_retention_days) || auditRetention);
      message.success(t('system.settings_saved'));
      window.dispatchEvent(new CustomEvent('systemSettings:updated'));
      // Trigger results reload
      window.dispatchEvent(new CustomEvent('results:reload'));
    } catch (e: any) {
      const detail = e?.response?.data?.detail || t('system.settings_save_failed');
      message.error(String(detail));
    } finally {
      setSystemSettingsSaving(false);
    }
  };

  const handleUpdateProfile = async () => {
    setLoading(true);
    try {
      const payload = {
        email: profileData.email,
        first_name: profileData.first_name,
        last_name: profileData.last_name,
      };
      const res = await authApi.updateProfile(payload);
      message.success(t('profile.update_success'));
      if (onUpdateUser) onUpdateUser(res);
    } catch (error) {
      console.error(error);
      message.error(t('profile.update_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      message.error(t('register.passwords_not_match'));
      return;
    }
    if (!passwordData.currentPassword || !passwordData.newPassword) {
      message.error(t('profile.password_required'));
      return;
    }
    setLoading(true);
    try {
      await authApi.changePassword(passwordData.currentPassword, passwordData.newPassword);
      message.success(t('profile.password_changed'));
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error: any) {
      message.error(error?.response?.data?.error || t('profile.update_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const formData = new FormData();
      formData.append('avatar', file);
      setLoading(true);
      try {
        const res = await authApi.updateProfile(formData);
        message.success(t('profile.update_success'));
        if (onUpdateUser) onUpdateUser(res);
      } catch (error: any) {
        message.error(error?.response?.data?.error || t('profile.update_failed'));
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="flex min-h-0 flex-col items-stretch sm:flex-row sm:items-start">
      {/* Sidebar */}
      <div className="z-10 flex w-full shrink-0 flex-col border-b border-hairline bg-white sm:sticky sm:top-0 sm:h-[calc(100vh-95px)] sm:w-64 sm:border-b-0 sm:border-r">
         {/* User Info Summary */}
         <div className="hidden flex-col items-center border-b border-hairline p-6 sm:flex">
            <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
              <div className="w-20 h-20 rounded-full bg-brand-fill flex items-center justify-center text-white text-3xl font-semibold mb-3 shadow-md overflow-hidden">
                 {currentUser?.profile?.avatar_url && !avatarLoadFailed ? (
                   <img
                     src={currentUser.profile.avatar_url}
                     alt={t('profile.avatar_alt')}
                     className="w-full h-full object-cover"
                     onError={() => setAvatarLoadFailed(true)}
                   />
                  ) : (
                    currentUser?.username?.charAt(0).toUpperCase()
                  )}
              </div>
              <div className="absolute inset-0 bg-black/30 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <Camera className="w-6 h-6 text-white" />
              </div>
              <input id="profile-avatar-upload" name="profile-avatar-upload" type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarChange} />
            </div>
            <p className="font-semibold text-ink">{currentUser?.username}</p>
            <p className="text-xs text-muted mt-1">{currentUser?.email}</p>
            <div className="mt-2 px-2 py-0.5 bg-[rgba(10,132,255,0.08)] text-brand-fill-hover text-xs rounded-full font-medium">
              {currentUser?.is_superuser ? t('permissions.admin') : t('permissions.user_role')}
            </div>
         </div>
         
         <div className="flex items-center gap-3 border-b border-hairline px-4 py-3 sm:hidden">
           <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-fill text-base font-semibold text-white">
             {currentUser?.profile?.avatar_url && !avatarLoadFailed ? (
               <img src={currentUser.profile.avatar_url} alt="" className="h-full w-full object-cover" onError={() => setAvatarLoadFailed(true)} />
             ) : (
               currentUser?.username?.charAt(0).toUpperCase()
             )}
           </div>
           <div className="min-w-0 flex-1">
             <p className="truncate text-sm font-semibold text-ink">{currentUser?.username}</p>
             <p className="truncate text-xs text-muted">{currentUser?.email}</p>
           </div>
           <span className="shrink-0 rounded-full bg-[rgba(10,132,255,0.08)] px-2 py-0.5 text-xs font-medium text-brand-fill-hover">
             {currentUser?.is_superuser ? t('permissions.admin') : t('permissions.user_role')}
           </span>
         </div>
         <div className="px-4 py-3 sm:hidden">
           <label htmlFor="profile-section" className="sr-only">{t('profile.account_settings')}</label>
           <select
             id="profile-section"
             value={activeTab}
             onChange={(e) => setActiveTab(e.target.value)}
             className="w-full rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-sm text-ink focus:border-accent-line focus:outline-none focus:ring-2 focus:ring-accent-line/20"
           >
             <option value="profile">{t('profile.personal_info')}</option>
             <option value="security">{t('profile.security')}</option>
             <option value="preferences">{t('profile.preferences')}</option>
             {(currentUser?.is_superuser || currentUser?.role_names?.includes('Admin')) && (
               <option value="system">{t('system.user_role_mgmt')}</option>
             )}
             {currentUser?.is_superuser && <option value="site_settings">{t('system.site_settings')}</option>}
             {(currentUser?.is_superuser || currentUser?.role_names?.includes('Admin')) && (
               <option value="audit">{t('permissions.audit')}</option>
             )}
             {currentUser?.is_superuser && <option value="analytics">{t('profile.visitor_statistics')}</option>}
           </select>
         </div>
         {/* Menu */}
         <nav className="hidden flex-1 space-y-1 overflow-y-auto p-4 sm:block">
            <div className="px-3 mb-2 text-xs font-semibold text-muted uppercase tracking-wider">{t('profile.account_settings')}</div>
            <MenuButton id="profile" icon={User} label={t('profile.personal_info')} active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
            <MenuButton id="security" icon={Lock} label={t('profile.security')} active={activeTab === 'security'} onClick={() => setActiveTab('security')} />
            <MenuButton id="preferences" icon={Settings} label={t('profile.preferences')} active={activeTab === 'preferences'} onClick={() => setActiveTab('preferences')} />
            
            {(currentUser?.is_superuser || currentUser?.role_names?.includes('Admin')) && (
              <>
                <div className="my-4 border-t border-gray-100"></div>
                <div className="px-3 mb-2 text-xs font-semibold text-muted uppercase tracking-wider">{t('system.management')}</div>
                <MenuButton id="system" icon={Shield} label={t('system.user_role_mgmt')} active={activeTab === 'system'} onClick={() => setActiveTab('system')} />
                {currentUser?.is_superuser && (
                  <MenuButton id="site_settings" icon={Settings} label={t('system.site_settings')} active={activeTab === 'site_settings'} onClick={() => setActiveTab('site_settings')} />
                )}
                <MenuButton id="audit" icon={FileText} label={t('permissions.audit')} active={activeTab === 'audit'} onClick={() => setActiveTab('audit')} />
                {currentUser?.is_superuser && (
                  <MenuButton id="analytics" icon={BarChart2} label={t('profile.visitor_statistics')} active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} />
                )}
              </>
            )}
         </nav>

         <div className="p-4 sm:border-t sm:border-gray-100">
           <button 
             onClick={onLogout}
             className="w-full flex items-center px-3 py-2 text-danger-text hover:bg-red-50 rounded-lg transition-colors duration-200"
           >
             <LogOut className="w-5 h-5 mr-3" />
             <span>{t('navigation.logout')}</span>
           </button>
         </div>
      </div>

      {/* Main Content */}
      <div className="min-w-0 flex-1 px-5 py-5 sm:px-6 lg:px-8">
         <div className={activeTab === 'system' ? 'w-full' : 'mx-auto max-w-4xl'}>
           {/* Header */}
           <div className="mb-8">
             <h1 className="text-xl font-semibold tracking-normal text-ink">
               {activeTab === 'profile' && t('profile.personal_info')}
               {activeTab === 'security' && t('profile.security')}
               {activeTab === 'preferences' && t('profile.preferences')}
               {activeTab === 'system' && t('system.user_role_mgmt')}
               {activeTab === 'site_settings' && t('system.site_settings')}
               {activeTab === 'audit' && t('permissions.audit')}
               {activeTab === 'analytics' && t('profile.visitor_statistics')}
             </h1>
           </div>

           {/* Content Sections */}
           {activeTab === 'profile' && (
             <div className="card rounded-xl shadow-sm border p-8">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div>
                   <label htmlFor="profile-username" className="block text-sm font-medium text-ink-secondary mb-2">{t('register.username')}</label>
                   <Input 
                     id="profile-username"
                     name="profile-username"
                     value={profileData.username} 
                     disabled 
                     className="bg-surface-muted" 
                     prefix={<User className="w-4 h-4 text-muted" />}
                   />
                   <p className="text-xs text-muted mt-1">{t('profile.username_immutable_hint')}</p>
                 </div>
                 
                 <div>
                   <label htmlFor="profile-email" className="block text-sm font-medium text-ink-secondary mb-2">{t('register.email')}</label>
                   <Input 
                     id="profile-email"
                     name="profile-email"
                     value={profileData.email} 
                     onChange={e => setProfileData({...profileData, email: e.target.value})}
                     prefix={<Mail className="w-4 h-4 text-muted" />}
                   />
                 </div>

                 <div>
                   <label htmlFor="profile-first-name" className="block text-sm font-medium text-ink-secondary mb-2">{t('register.first_name')}</label>
                   <Input 
                     id="profile-first-name"
                     name="profile-first-name"
                     value={profileData.first_name} 
                     onChange={e => setProfileData({...profileData, first_name: e.target.value})}
                   />
                 </div>

                 <div>
                   <label htmlFor="profile-last-name" className="block text-sm font-medium text-ink-secondary mb-2">{t('register.last_name')}</label>
                   <Input 
                     id="profile-last-name"
                     name="profile-last-name"
                     value={profileData.last_name} 
                     onChange={e => setProfileData({...profileData, last_name: e.target.value})}
                   />
                 </div>
               </div>

               <div className="mt-8 pt-8 border-t border-gray-100 flex justify-end">
                 <Button type="primary" size="large" onClick={handleUpdateProfile} loading={loading} className="bg-brand-fill hover:bg-brand-fill-hover">
                   {t('common.save')}
                 </Button>
               </div>
             </div>
           )}

           {activeTab === 'security' && (
             <div className="space-y-6">
               <div className="card rounded-xl shadow-sm border p-8">
                 <h2 className="mb-6 flex items-center text-lg font-medium text-ink">
                  <Lock className="w-5 h-5 mr-2 text-accent-text" />
                  {t('profile.change_password')}
                </h2>
                <div className="space-y-4 max-w-md">
                  <div>
                    <label htmlFor="profile-current-password" className="block text-sm font-medium text-ink-secondary mb-2">{t('profile.current_password')}</label>
                    <Input.Password 
                      id="profile-current-password"
                      name="profile-current-password"
                      value={passwordData.currentPassword}
                      onChange={e => setPasswordData({...passwordData, currentPassword: e.target.value})}
                    />
                  </div>
                  <div>
                    <label htmlFor="profile-new-password" className="block text-sm font-medium text-ink-secondary mb-2">{t('profile.new_password')}</label>
                    <Input.Password 
                      id="profile-new-password"
                      name="profile-new-password"
                      value={passwordData.newPassword}
                      onChange={e => setPasswordData({...passwordData, newPassword: e.target.value})}
                    />
                  </div>
                  <div>
                    <label htmlFor="profile-confirm-password" className="block text-sm font-medium text-ink-secondary mb-2">{t('profile.confirm_new_password')}</label>
                    <Input.Password 
                      id="profile-confirm-password"
                      name="profile-confirm-password"
                      value={passwordData.confirmPassword}
                      onChange={e => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                    />
                  </div>
                  <Button type="primary" onClick={handleChangePassword} className="bg-brand-fill hover:bg-brand-fill-hover mt-2">
                    {t('profile.update_password')}
                  </Button>
                </div>
              </div>
              
              <div className="card rounded-xl shadow-sm border p-8">
                <h2 className="mb-6 flex items-center text-lg font-medium text-ink">
                  <Shield className="w-5 h-5 mr-2 text-accent-text" />
                  {t('profile.two_factor_auth')}
                </h2>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-ink-secondary font-medium">{t('profile.enable_2fa')}</p>
                    <p className="text-xs text-muted mt-1">{t('profile.enable_2fa_desc')}</p>
                  </div>
                  <Switch disabled />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'preferences' && (
            <div className="card rounded-xl shadow-sm border p-8">
               <div className="space-y-6">
                 <div className="flex items-center justify-between py-4 border-b border-gray-100">
                   <div className="flex items-center">
                     <Bell className="w-5 h-5 mr-3 text-muted" />
                     <div>
                       <p className="font-medium text-ink">{t('profile.email_notifications')}</p>
                       <p className="text-xs text-muted">{t('profile.email_notifications_desc')}</p>
                     </div>
                   </div>
                   <Switch defaultChecked />
                 </div>
                 
                 <div className="flex items-center justify-between py-4 border-b border-gray-100">
                   <div className="flex items-center">
                     <Palette className="w-5 h-5 mr-3 text-muted" />
                     <div>
                       <p className="font-medium text-ink">{t('profile.dark_mode')}</p>
                       <p className="text-xs text-muted">{t('profile.dark_mode_desc')}</p>
                     </div>
                   </div>
                   <Switch disabled checked={false} />
                 </div>
               </div>
            </div>
          )}

           {activeTab === 'system' && (
             <div className="min-h-[600px] w-full">
               {/* Embed PermissionManagement directly */}
               <PermissionManagement />
             </div>
           )}

           {activeTab === 'site_settings' && (
             <div className="card rounded-xl shadow-sm border p-8">
               
               <div className="space-y-10">
                 {/* General Settings */}
                 <div>
                   <h2 className="mb-4 flex items-center border-b border-hairline pb-2 text-lg font-medium text-ink">
                     <span className="w-1 h-5 bg-[rgba(10,132,255,0.08)] rounded-full mr-2"></span>
                     {t('system.general_settings') || 'General Settings'}
                   </h2>
                   <div className="grid grid-cols-1 gap-6">
                     <div>
                       <label htmlFor="system-site-title" className="block text-sm font-medium text-ink-secondary mb-2">{t('system.site_title') || 'Site Title'}</label>
                       <Input id="system-site-title" name="system-site-title" value={siteTitle} onChange={e => setSiteTitle(e.target.value)} placeholder="Cassava System" />
                     </div>
                     <div>
                       <label htmlFor="system-site-announcement" className="block text-sm font-medium text-ink-secondary mb-2">{t('system.site_announcement') || 'System Announcement'}</label>
                       <Input.TextArea 
                         id="system-site-announcement"
                         name="system-site-announcement"
                         value={siteAnnouncement} 
                         onChange={e => setSiteAnnouncement(e.target.value)} 
                         placeholder="Broadcast a message to all users..."
                         rows={3}
                       />
                       <p className="text-xs text-muted mt-1">{t('system.announcement_desc') || 'Visible on the top of the homepage.'}</p>
                     </div>
                   </div>
                 </div>

                 {/* Security & Access */}
                 <div>
                   <h2 className="mb-4 flex items-center border-b border-hairline pb-2 text-lg font-medium text-ink">
                     <span className="w-1 h-5 bg-[rgba(10,132,255,0.08)] rounded-full mr-2"></span>
                     {t('system.security_access') || 'Security & Access'}
                   </h2>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
                     <div className="flex items-center justify-between p-4 card-soft rounded-lg">
                       <div>
                         <label htmlFor="system-enable-guest-access" className="block text-sm font-medium text-ink">{t('system.enable_guest_access') || 'Enable Guest Access'}</label>
                         <p className="text-xs text-muted mt-1">{t('system.enable_guest_access_desc') || 'Allow unauthenticated users to access public resources'}</p>
                       </div>
                       <Switch id="system-enable-guest-access" checked={enableGuestAccess} onChange={setEnableGuestAccess} />
                     </div>

                     <div className="flex items-center justify-between p-4 card-soft rounded-lg">
                       <div>
                         <label htmlFor="system-allow-registration" className="block text-sm font-medium text-ink">{t('system.allow_registration') || 'Allow Registration'}</label>
                         <p className="text-xs text-muted mt-1">{t('system.allow_registration_desc') || 'Allow new users to sign up'}</p>
                       </div>
                       <Switch id="system-allow-registration" checked={allowRegistration} onChange={setAllowRegistration} />
                     </div>
                     
                     <div className="flex items-center justify-between p-4 bg-red-50 rounded-lg border border-red-100 md:col-span-2">
                       <div>
                         <label htmlFor="system-maintenance-mode" className="block text-sm font-medium text-red-900">{t('system.maintenance_mode') || 'Maintenance Mode'}</label>
                         <p className="text-xs text-danger-text mt-1">{t('system.maintenance_mode_desc') || 'Only administrators can login when enabled'}</p>
                       </div>
                       <Switch id="system-maintenance-mode" className="bg-red-200" checked={maintenanceMode} onChange={setMaintenanceMode} />
                     </div>
                   </div>
                 </div>

                 {/* Storage & Limits */}
                 <div>
                   <h2 className="mb-4 flex items-center border-b border-hairline pb-2 text-lg font-medium text-ink">
                     <span className="w-1 h-5 bg-purple-500 rounded-full mr-2"></span>
                     {t('system.storage_limits') || 'Storage & Limits'}
                   </h2>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div>
                       <label htmlFor="system-upload-size-limit" className="block text-sm font-medium text-ink-secondary mb-2">{t('system.upload_size_limit') || 'Upload Size Limit (MB)'}</label>
                       <InputNumber id="system-upload-size-limit" min={1} max={500} value={uploadSizeLimitMb} className="w-full" onChange={(val) => setUploadSizeLimitMb(Number(val))} />
                     </div>
                     <div>
                       <label htmlFor="system-max-display-images" className="block text-sm font-medium text-ink-secondary mb-2">{t('system.max_display_images')}</label>
                       <InputNumber id="system-max-display-images" min={1} max={1000} value={maxDisplayImages} className="w-full" onChange={(val) => setMaxDisplayImages(Number(val))} />
                     </div>
                     <div>
                       <label htmlFor="system-guest-retention" className="block text-sm font-medium text-ink-secondary mb-2">{t('system.guest_retention') || 'Guest Data Retention (Days)'}</label>
                       <InputNumber id="system-guest-retention" min={1} max={365} value={guestRetention} className="w-full" onChange={(val) => setGuestRetention(Number(val))} />
                     </div>
                     <div>
                       <label htmlFor="system-audit-retention" className="block text-sm font-medium text-ink-secondary mb-2">{t('system.audit_retention') || 'Audit Log Retention (Days)'}</label>
                       <InputNumber id="system-audit-retention" min={30} max={3650} value={auditRetention} className="w-full" onChange={(val) => setAuditRetention(Number(val))} />
                     </div>
                   </div>
                 </div>
               </div>

               <div className="mt-8 pt-8 border-t border-gray-100 flex justify-end sticky bottom-0 bg-white p-4 shadow-top z-10">
                 <Button
                   type="primary"
                   size="large"
                   onClick={handleSaveSystemSettings}
                   loading={systemSettingsSaving}
                   disabled={systemSettingsLoading}
                   className="bg-brand-fill hover:bg-brand-fill-hover px-8"
                 >
                   {t('common.save')}
                 </Button>
               </div>
             </div>
           )}
           
           {activeTab === 'analytics' && (
             <Suspense
               fallback={
                 <div className="rounded-2xl card px-4 py-8 text-center text-sm text-muted">
                   {t('common.loading') || 'Loading...'}
                 </div>
               }
             >
               <div className="card rounded-xl shadow-sm border min-h-[600px]">
                 <VisitorAnalytics />
               </div>
             </Suspense>
           )}

           {activeTab === 'audit' && (
              <div className="card rounded-xl shadow-sm border min-h-[600px] p-6">
                <AuditLogs />
              </div>
           )}
         </div>
      </div>
    </div>
  );
};

export default UserProfile;
