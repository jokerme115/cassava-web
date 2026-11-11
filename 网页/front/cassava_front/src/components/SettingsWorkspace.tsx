import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Form, Input, InputNumber, Select, Slider, Switch } from 'antd';
import { Camera, FileText, KeyRound, LockKeyhole, LogOut, Settings2, Shield, SlidersHorizontal, UserRound, Users, BarChart3 } from 'lucide-react';
import AccessSettings from './AccessSettings';
import AuditLogs from './AuditLogs';
import { authApi, systemSettingsApi } from '../services/api';
import { usePermission } from '../hooks/usePermission';
import { message } from '../utils/feedback';
import { cacheUserPreferences, defaultPreferences, type UserPreferences } from '../utils/userPreferences';
import WorkflowSettings from './WorkflowSettings';
import { saveUserPreferences } from '../services/preferences';
import type { User, SystemSetting } from '../types';
import { DraftStatus, EditorSettingsPreview, PreviewFrame } from './SettingsPreview';
import './SettingsWorkspace.css';

const VisitorAnalytics = lazy(() => import('./VisitorAnalytics'));
interface Props { currentUser: User; onLogout: () => void; onUpdateUser?: (user: User) => void }
const errorText = (error: any) => {
  const data = error?.response?.data;
  if (!data) return '操作失败，请重试';
  if (typeof data === 'string') return data;
  return Object.entries(data).map(([key, value]) => `${['error', 'detail', 'non_field_errors'].includes(key) ? '' : key + '：'}${Array.isArray(value) ? value.join('；') : JSON.stringify(value)}`).join('；');
};

function SiteSettings() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [saved, setSaved] = useState<Record<string, unknown>>({});
  const draft = Form.useWatch([], form) || {};
  const load = async () => {
    setLoading(true); setError('');
    try { const values = await systemSettingsApi.get(); form.setFieldsValue(values); setSaved({ ...values }); } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const save = async (values: Partial<SystemSetting>) => {
    setSaving(true); setError('');
    try { const result = await systemSettingsApi.update(values); form.setFieldsValue(result); setSaved({ ...result }); window.dispatchEvent(new Event('systemSettings:updated')); message.success('站点设置已保存'); }
    catch (e) { setError(errorText(e)); } finally { setSaving(false); }
  };
  return <div className="settings-visual-layout"><Form form={form} layout="vertical" onFinish={save} disabled={loading || saving} requiredMark={false} className="settings-form settings-form--visual">
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => void load()}>重新加载</Button>} />}
    <section className="settings-section"><h2>站点信息</h2>
      <Form.Item name="siteTitle" label="站点名称" rules={[{ required: true, whitespace: true, message: '请输入站点名称' }]}><Input maxLength={100} /></Form.Item>
      <Form.Item name="siteAnnouncement" label="公告"><Input.TextArea rows={3} maxLength={2000} /></Form.Item>
    </section>
    <section className="settings-section"><h2>访问控制</h2>
      <div className="settings-switch-row"><label htmlFor="site-guest">允许访客试用</label><Form.Item name="enableGuestAccess" valuePropName="checked" noStyle><Switch id="site-guest" /></Form.Item></div>
      <div className="settings-switch-row"><label htmlFor="site-register">开放注册</label><Form.Item name="allowRegistration" valuePropName="checked" noStyle><Switch id="site-register" /></Form.Item></div>
      <div className="settings-switch-row"><label htmlFor="site-maintenance">维护模式<span className="block text-xs text-muted">暂停普通用户访问工作区</span></label><Form.Item name="maintenanceMode" valuePropName="checked" noStyle><Switch id="site-maintenance" /></Form.Item></div>
    </section>
    <section className="settings-section"><h2>单张图片上传</h2><Form.Item name="uploadSizeLimitMb" label="单张图片大小上限（MB）" rules={[{ required: true, message: '请输入大小上限' }]}><InputNumber min={1} max={500} /></Form.Item><p className="text-xs text-muted">分块导入支持每批不超过 5GB，单独按导入规则校验。</p></section>
    <div className="settings-savebar"><Button type="primary" htmlType="submit" loading={saving} disabled={loading || !!error}>保存站点设置</Button><DraftStatus values={draft} saved={saved}/></div>
  </Form><PreviewFrame title="站点显示与访问" footer={<span>保存后对全站生效</span>}><div className="preview-site"><div className="preview-site-brand"><img src="/assets/logo-128.webp" alt="站点标志"/><strong>{draft.siteTitle || 'Cassava System'}</strong></div>{draft.siteAnnouncement && <div className="preview-site-announcement">{draft.siteAnnouncement}</div>}<div className="preview-site-access"><strong>{draft.maintenanceMode ? '工作区维护中' : '工作区正常开放'}</strong><span>访客试用：{draft.enableGuestAccess ? '开放' : '关闭'}</span><span>新账号注册：{draft.allowRegistration ? '开放' : '关闭'}</span><span>单张图片上限：{draft.uploadSizeLimitMb || '—'} MB</span></div></div></PreviewFrame></div>;
}

export default function SettingsWorkspace({ currentUser, onLogout, onUpdateUser }: Props) {
  const { i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { hasPermission, isLoading } = usePermission();
  const root = !!currentUser.is_superuser;
  const can = (code: string) => root || hasPermission(code);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [profileForm] = Form.useForm(), [passwordForm] = Form.useForm(), [preferencesForm] = Form.useForm();
  const profileValues = Form.useWatch([], profileForm) || {};
  const preferenceValues = Form.useWatch([], preferencesForm) || {};
  const [savedProfile, setSavedProfile] = useState<Record<string, unknown>>({});
  const [savedPreferences, setSavedPreferences] = useState<UserPreferences>({ ...defaultPreferences, ...currentUser.profile?.preferences });
  const previewPreferences = { ...savedPreferences, ...preferenceValues };
  const displayName = `${profileValues.last_name || ''}${profileValues.first_name || ''}` || currentUser.username;
  const accountItems = [
    { id: 'account', label: '个人资料', icon: UserRound },
    { id: 'security', label: '账号安全', icon: LockKeyhole },
    { id: 'preferences', label: '复检与通用', icon: SlidersHorizontal },
    { id: 'lists', label: '图片与列表', icon: SlidersHorizontal },
    { id: 'imports', label: '导入默认', icon: Settings2 },
    { id: 'prediction-presets', label: '预测预设', icon: SlidersHorizontal },
    { id: 'export-templates', label: '导出模板', icon: FileText },
  ];
  const adminItems = [
    ...(can('view_user') ? [{ id: 'users', label: '用户', icon: Users }] : []),
    ...(can('view_role') ? [{ id: 'roles', label: '角色', icon: Shield }] : []),
    ...(can('view_permission') ? [{ id: 'permissions', label: '功能权限', icon: KeyRound }] : []),
    ...(root ? [{ id: 'site', label: '站点设置', icon: Settings2 }] : []),
    ...(can('view_audit_log') ? [{ id: 'audit', label: '操作日志', icon: FileText }] : []),
    ...(root ? [{ id: 'analytics', label: '访问统计', icon: BarChart3 }] : []),
  ];
  const allItems = [...accountItems, ...adminItems];
  const requested = params.get('tab') || 'account';
  const section = allItems.some(item => item.id === requested) ? requested : 'account';
  const title = allItems.find(item => item.id === section)?.label;
  const navigate = (id: string) => { setParams({ tab: id }); setError(''); };
  useEffect(() => {
    if (section === 'account') {
      const values = { ...currentUser, department: currentUser.profile?.department || '', phone: currentUser.profile?.phone || '', bio: currentUser.profile?.bio || '' };
      profileForm.setFieldsValue(values); setSavedProfile(values);
    }
    const preferences = { ...defaultPreferences, ...currentUser.profile?.preferences };
    if (section === 'preferences') { preferencesForm.setFieldsValue(preferences); setSavedPreferences(preferences); }
    cacheUserPreferences(preferences, currentUser.profile?.preferences_etag);
    setAvatarFailed(false);
  }, [currentUser, profileForm, preferencesForm, section]);
  const saveProfile = async (values: any) => {
    setBusy(true); setError('');
    try { const user = await authApi.updateProfile(values); setSavedProfile(values); onUpdateUser?.(user); message.success('资料已保存'); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const uploadAvatar = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) { message.error('请选择 5MB 以内的图片'); return; }
    const data = new FormData(); data.append('avatar', file); setBusy(true); setError('');
    try { onUpdateUser?.(await authApi.updateProfile(data)); message.success('头像已更新'); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const changePassword = async (values: any) => {
    setBusy(true); setError('');
    try { await authApi.changePassword(values.current, values.password); passwordForm.resetFields(); message.success('密码已更新，其他设备需重新登录'); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const savePreferences = async (values: UserPreferences) => {
    setBusy(true); setError('');
    try {
      const user = await saveUserPreferences(values);
      cacheUserPreferences(user.profile?.preferences || values, user.profile?.preferences_etag); onUpdateUser?.(user);
      setSavedPreferences({ ...defaultPreferences, ...user.profile?.preferences });
      await i18n.changeLanguage(values.language); message.success('工作区偏好已保存');
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const menu = (items: typeof accountItems) => items.map(item => <button key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={17} /><span>{item.label}</span></button>);
  return <div className="settings-workspace">
    <aside className="settings-sidebar">
      <div className="settings-identity"><div className="settings-avatar">{currentUser.profile?.avatar_url && !avatarFailed ? <img src={currentUser.profile.avatar_url} alt="" onError={() => setAvatarFailed(true)} /> : currentUser.username.charAt(0).toUpperCase()}</div><div className="min-w-0"><p className="truncate font-semibold">{currentUser.username}</p><p className="mt-1 text-xs text-muted">{root ? '超级管理员' : currentUser.role_names?.join('、') || '用户'}</p></div></div>
      <nav aria-label="设置分类"><p className="settings-nav-label">账号设置</p>{menu(accountItems)}{adminItems.length > 0 && <><p className="settings-nav-label">管理设置</p>{menu(adminItems)}</>}</nav>
      <button className="settings-logout" onClick={onLogout}><LogOut size={17} />退出登录</button>
    </aside>
    <main className="settings-content">
      <header className="settings-page-header"><Settings2 size={18} /><h1>{title}</h1></header>
      <div className="settings-mobile-nav"><Select aria-label="设置分类" value={section} onChange={navigate} options={allItems.map(item => ({ value: item.id, label: item.label }))} className="w-full" /></div>
      <div className={`settings-body${['users', 'roles', 'permissions', 'audit'].includes(section) ? ' settings-body--list' : ''}`}>
      {error && <Alert className="mb-5" type="error" message={error} showIcon closable onClose={() => setError('')} />}
      {section === 'account' && <div className="settings-visual-layout settings-account-layout"><Form form={profileForm} layout="vertical" requiredMark={false} onFinish={saveProfile} className="settings-form settings-form--visual">
        <section className="settings-section"><h2>头像与账号</h2><div className="mb-6 flex items-center gap-4"><div className="settings-avatar settings-avatar--large">{currentUser.profile?.avatar_url && !avatarFailed ? <img src={currentUser.profile.avatar_url} alt="头像" onError={() => setAvatarFailed(true)} /> : currentUser.username.charAt(0).toUpperCase()}</div><div><Button icon={<Camera size={15} />} loading={busy} onClick={() => fileRef.current?.click()}>更换头像</Button><p className="mt-2 text-xs text-muted">图片不超过 5MB</p></div><input ref={fileRef} type="file" accept="image/*" aria-label="上传头像" hidden onChange={e => void uploadAvatar(e.target.files?.[0])} /></div>
          <div className="settings-fields"><Form.Item label="用户名"><Input value={currentUser.username} disabled /></Form.Item><Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '请输入有效邮箱' }]}><Input type="email" autoComplete="email" /></Form.Item><Form.Item name="last_name" label="姓"><Input autoComplete="family-name" /></Form.Item><Form.Item name="first_name" label="名"><Input autoComplete="given-name" /></Form.Item></div>
        </section>
        <section className="settings-section"><h2>联系资料</h2><div className="settings-fields"><Form.Item name="department" label="单位 / 团队"><Input maxLength={100} /></Form.Item><Form.Item name="phone" label="联系电话"><Input type="tel" maxLength={20} /></Form.Item></div><Form.Item name="bio" label="个人简介"><Input.TextArea rows={3} /></Form.Item></section>
        <div className="settings-savebar"><Button type="primary" htmlType="submit" loading={busy}>保存资料</Button><DraftStatus values={profileValues} saved={savedProfile}/></div>
      </Form><PreviewFrame title="资料预览" footer={<span>保存后更新账号资料</span>}><div className="preview-profile-cover"><img src="/cases/cassava-lab.jpg" alt="木薯切面"/></div><div className="preview-profile-content"><div className="settings-avatar settings-avatar--large">{currentUser.profile?.avatar_url && !avatarFailed ? <img src={currentUser.profile.avatar_url} alt="头像" onError={() => setAvatarFailed(true)}/> : displayName.charAt(0).toUpperCase()}</div><h2>{displayName}</h2><p className="preview-profile-handle">@{currentUser.username}</p><p>{profileValues.department || '单位 / 团队未填写'}</p><dl><dt>邮箱</dt><dd>{profileValues.email || '未填写'}</dd><dt>电话</dt><dd>{profileValues.phone || '未填写'}</dd></dl><p className="preview-profile-bio">{profileValues.bio || '添加一段个人简介'}</p></div></PreviewFrame></div>}
      {section === 'security' && <Form form={passwordForm} layout="vertical" requiredMark={false} onFinish={changePassword} className="settings-form">
        <section className="settings-section"><h2>修改密码</h2><div className="max-w-md"><Form.Item name="current" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}><Input.Password autoComplete="current-password" /></Form.Item><Form.Item name="password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 8, message: '密码至少 8 位' }]}><Input.Password autoComplete="new-password" /></Form.Item><Form.Item name="confirm" label="再次输入新密码" dependencies={['password']} rules={[{ required: true, message: '请再次输入新密码' }, ({ getFieldValue }) => ({ validator: (_, value) => !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error('两次密码不一致')) })]}><Input.Password autoComplete="new-password" /></Form.Item></div></section>
        <div className="settings-savebar"><Button type="primary" htmlType="submit" loading={busy}>更新密码</Button></div>
      </Form>}
      {section === 'preferences' && <div className="settings-visual-layout"><Form form={preferencesForm} layout="vertical" requiredMark={false} onFinish={savePreferences} className="settings-form settings-form--visual">
        <section className="settings-section"><h2>通用</h2><Form.Item name="language" label="界面语言"><Select options={[{ value: 'zh', label: '简体中文' }, { value: 'en', label: 'English' }]} className="max-w-xs" /></Form.Item></section>
        <section className="settings-section"><h2>人工复检默认值</h2><div className="settings-fields"><Form.Item name="editorTheme" label="画布外观"><Select options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]} /></Form.Item><Form.Item name="brushSize" label="画笔直径（原图像素）"><InputNumber min={1} max={120} /></Form.Item><Form.Item name="vertexSize" label="顶点大小（屏幕像素）"><InputNumber min={1} max={4} step={.5} /></Form.Item></div><div className="settings-fields"><Form.Item name="cassavaOpacity" label="木薯范围透明度"><Slider min={0} max={1} step={.01} tooltip={{ formatter: value => `${Math.round(Number(value) * 100)}%` }} /></Form.Item><Form.Item name="rottenOpacity" label="病斑范围透明度"><Slider min={0} max={1} step={.01} tooltip={{ formatter: value => `${Math.round(Number(value) * 100)}%` }} /></Form.Item></div></section>

        <section className="settings-section"><h2>连续复检</h2><div className="settings-fields">
          <Form.Item name="editorResetZoom" label="切图时适应窗口" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="editorDimOutside" label="压暗主体外背景" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="editorShowCassava" label="默认显示主体" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="editorShowRotten" label="默认显示病斑" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="autoAdvanceReview" label="完成复检后自动下一张" valuePropName="checked"><Switch /></Form.Item>
        </div></section>
        <div className="settings-savebar"><Button type="primary" htmlType="submit" loading={busy}>保存偏好</Button><Button onClick={() => preferencesForm.setFieldsValue(defaultPreferences)}>恢复默认值</Button><DraftStatus values={preferenceValues} saved={savedPreferences}/></div>
      </Form><EditorSettingsPreview value={previewPreferences}/></div>}
      {['lists', 'imports', 'prediction-presets', 'export-templates'].includes(section) && <WorkflowSettings key={section} section={section} user={currentUser} />}
      {['users', 'roles', 'permissions'].includes(section) && !isLoading && <AccessSettings key={section} section={section as 'users' | 'roles' | 'permissions'} currentUser={currentUser} onUpdateUser={onUpdateUser} />}
      {section === 'site' && root && <SiteSettings />}
      {section === 'audit' && <AuditLogs />}
      {section === 'analytics' && <Suspense fallback={<p className="py-8 text-muted">正在加载…</p>}><VisitorAnalytics /></Suspense>}
      </div>
    </main>
  </div>;
}
