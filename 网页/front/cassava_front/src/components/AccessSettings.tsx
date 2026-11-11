import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Collapse, Drawer, Form, Input, Modal, Select, Switch, Table, Tag } from 'antd';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { permissionsApi } from '../services/api';
import { usePermission } from '../hooks/usePermission';
import { message } from '../utils/feedback';
import type { User } from '../types';
import WorkspacePagination from './WorkspacePagination';

type Section = 'users' | 'roles' | 'permissions';
interface Permission { id: number; name: string; codename: string; description: string; category?: string; is_bound?: boolean }
interface Role { id: number; name: string; description: string; permissions: number[]; user_count: number; is_active: boolean }
interface Props { section?: Section; currentUser?: User; onUpdateUser?: (user: User) => void }

const failure = (error: any) => {
  const data = error?.response?.data;
  return typeof data === 'string' ? data : data ? Object.entries(data).map(([key, value]) => `${key === 'non_field_errors' ? '' : key + '：'}${Array.isArray(value) ? value.join('；') : value}`).join('；') : '操作失败，请重试';
};
const groupName = (permission: Permission) => {
  const code = permission.codename;
  if (/image|tag/.test(code)) return '图片';
  if (/folder/.test(code)) return '文件夹';
  if (/task|predict|result|export|correction/.test(code)) return '预测与结果';
  if (/user|role|permission/.test(code)) return '账号与授权';
  return '系统';
};
export const permissionLabel = (p: Permission) => {
  const labels: Record<string, string> = {
    view_task: '查看任务', create_task: '创建预测任务', cancel_task: '取消任务', delete_task: '删除任务',
    view_image: '查看图片', upload_image: '上传图片', delete_image: '删除图片', change_image: '修改图片',
    view_folder: '查看文件夹', create_folder: '新建文件夹', change_folder: '修改文件夹', delete_folder: '删除文件夹',
    view_user: '查看用户', add_user: '新建用户', change_user: '编辑用户', delete_user: '删除用户',
    view_role: '查看角色', add_role: '新建角色', change_role: '编辑角色', delete_role: '删除角色',
    assign_role_permissions: '配置角色权限', assign_user_roles: '分配用户角色', view_permission: '查看功能权限',
    add_permission: '登记权限代码', change_permission: '单独调整用户权限', delete_permission: '删除权限代码',
    view_audit_log: '查看操作日志', view_userpermission: '查看用户授权', view_userrole: '查看用户角色',
  };
  return labels[p.codename] || p.name;
};

async function allPages<T>(fetcher: (params: any) => Promise<any>): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  while (true) {
    const data = await fetcher({ page, page_size: 100 });
    const items = Array.isArray(data) ? data : data.results || [];
    results.push(...items);
    if (!items.length || Array.isArray(data) || results.length >= data.count || !data.next) break;
    page += 1;
  }
  return results;
}

export default function AccessSettings({ section = 'users', currentUser, onUpdateUser }: Props) {
  const { hasPermission, isLoading, error: accessError } = usePermission();
  const root = !!currentUser?.is_superuser;
  const can = (code: string) => root || hasPermission(code);
  const [rows, setRows] = useState<any[]>([]), [total, setTotal] = useState(0);
  const [roles, setRoles] = useState<Role[]>([]), [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(24);
  const [editing, setEditing] = useState<User | Role | 'new' | null>(null);
  const [saving, setSaving] = useState(false), [formError, setFormError] = useState('');
  const [form] = Form.useForm();
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [selectedPermissions, setSelectedPermissions] = useState<number[]>([]);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [specialUser, setSpecialUser] = useState<User | null>(null);
  const [overrides, setOverrides] = useState<Record<number, 'inherit' | 'grant' | 'revoke'>>({});
  const [inherited, setInherited] = useState<number[]>([]), [overrideLoading, setOverrideLoading] = useState(false);
  const [overrideReady, setOverrideReady] = useState(false);
  const [memberRole, setMemberRole] = useState<Role | null>(null), [members, setMembers] = useState<User[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);
  const generation = useRef(0);
  const canView = can(`view_${section === 'users' ? 'user' : section === 'roles' ? 'role' : 'permission'}`);
  useEffect(() => { if (editing) { form.resetFields(); form.setFieldsValue(formValues); } }, [editing, formValues, form]);

  const load = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true); setError('');
    try {
      const fetcher = section === 'users' ? permissionsApi.getAllUsers : section === 'roles' ? permissionsApi.getAllRoles : permissionsApi.getAllPermissions;
      const data = await fetcher({ page, page_size: pageSize, search: query, ...(section === 'users' && status !== 'all' ? { is_active: status } : {}) });
      if (id === generation.current) { setRows(data.results || []); setTotal(data.count ?? 0); }
    } catch (e) { if (id === generation.current) setError(failure(e)); }
    finally { if (id === generation.current) setLoading(false); }
  }, [section, page, pageSize, query, status]);

  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setSearch(''); setQuery(''); setPage(1); setStatus('all'); setEditing(null); }, [section]);
  useEffect(() => { if (!isLoading && canView) void load(); return () => { generation.current += 1; }; }, [load, isLoading, canView]);

  const loadChoices = async () => {
    const [allRoles, allPermissions] = await Promise.all([
      can('view_role') ? allPages<Role>(permissionsApi.getAllRoles) : Promise.resolve([]),
      can('view_permission') ? allPages<Permission>(permissionsApi.getAllPermissions) : Promise.resolve([]),
    ]);
    setRoles(allRoles); setPermissions(allPermissions);
  };

  const openEdit = async (record: User | Role | 'new') => {
    setFormError(''); setPermissionSearch(''); setLoading(true);
    try {
      await loadChoices();
      if (section === 'roles') {
        const role = record === 'new' ? null : await permissionsApi.getRoleById(String(record.id));
        setSelectedPermissions((role?.permission_ids || role?.permissions || []).map(Number));
        setFormValues(role || { name: '', description: '', is_active: true });
      } else setFormValues(record === 'new' ? { is_active: true, role_ids: [] } : { ...record, role_ids: (record as User).roles || [] });
      setEditing(record);
    } catch (e) { message.error(failure(e)); }
    finally { setLoading(false); }
  };
  const refreshed = async () => {
    await load();
    window.dispatchEvent(new Event('permissions:updated'));
  };
  const save = async () => {
    let values;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true); setFormError('');
    try {
      if (section === 'roles') {
        const payload = { ...values, ...(can('assign_role_permissions') ? { permission_ids: selectedPermissions } : {}) };
        if (editing === 'new') await permissionsApi.createRole(payload);
        else await permissionsApi.updateRole(String(editing!.id), payload);
      } else {
        if (!values.password) delete values.password;
        if (!can('assign_user_roles')) delete values.role_ids;
        const saved = editing === 'new' ? await permissionsApi.createUser(values) : await permissionsApi.updateUser(String(editing!.id), values);
        if (currentUser && saved.id === currentUser.id) onUpdateUser?.(saved);
      }
      setEditing(null); message.success('已保存'); await refreshed();
    } catch (e) { setFormError(failure(e)); } finally { setSaving(false); }
  };
  const showMembers = async (role: Role) => {
    setMemberRole(role); setMembers([]); setMemberLoading(true);
    try { setMembers(await permissionsApi.getRoleUsers(String(role.id))); } catch (e) { message.error(failure(e)); } finally { setMemberLoading(false); }
  };
  const openOverrides = async (user: User) => {
    setSpecialUser(user); setOverrideLoading(true); setOverrideReady(false); setFormError(''); setPermissionSearch('');
    try {
      await loadChoices();
      const data = await permissionsApi.getUserDetailedPermissions(String(user.id));
      const next: Record<number, 'inherit' | 'grant' | 'revoke'> = {};
      data.direct_permission_ids.forEach(id => { next[id] = 'grant'; });
      (data.revoked_permission_ids || []).forEach(id => { next[id] = 'revoke'; });
      setOverrides(next); setInherited(data.inherited_permission_ids || []); setOverrideReady(true);
    } catch (e) { setFormError(failure(e)); } finally { setOverrideLoading(false); }
  };
  const saveOverrides = async () => {
    if (!specialUser) return;
    setSaving(true); setFormError('');
    try {
      await permissionsApi.updateUserPermissions(String(specialUser.id), Object.keys(overrides).filter(id => overrides[Number(id)] === 'grant').map(Number), Object.keys(overrides).filter(id => overrides[Number(id)] === 'revoke').map(Number));
      setSpecialUser(null); message.success('单独授权已保存'); await refreshed();
    } catch (e) { setFormError(failure(e)); } finally { setSaving(false); }
  };
  const removeRole = (role: Role) => {
    Modal.confirm({ title: `删除角色“${role.name}”？`, content: '仅删除角色定义，不删除用户和历史任务。有成员的角色需先更换成员角色。', okText: '删除角色', okButtonProps: { danger: true }, cancelText: '取消', onOk: async () => {
      try { await permissionsApi.deleteRole(String(role.id)); message.success('角色已删除'); await refreshed(); } catch (e) { message.error(failure(e)); throw e; }
    } });
  };
  const groups = ['图片', '文件夹', '预测与结果', '账号与授权', '系统'];
  const filteredPermissions = permissions.filter(p => `${p.name} ${p.codename}`.toLowerCase().includes(permissionSearch.toLowerCase()));
  const permissionPicker = <>
    <Input aria-label="筛选功能权限" prefix={<Search size={15} />} placeholder="筛选功能" value={permissionSearch} onChange={e => setPermissionSearch(e.target.value)} className="mb-3" />
    <Collapse defaultActiveKey={['图片', '预测与结果']} items={groups.map(group => ({
      key: group,
      label: `${group} · ${filteredPermissions.filter(p => groupName(p) === group).length}`,
      children: <div className="space-y-3">{filteredPermissions.filter(p => groupName(p) === group).map(p =>
        <div key={p.id} className="flex items-center gap-2 text-sm">
          <Checkbox disabled={!can('assign_role_permissions') || p.is_bound === false}
            checked={selectedPermissions.includes(p.id)}
            onChange={e => setSelectedPermissions(prev => e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id))}>
            {permissionLabel(p)}
          </Checkbox>
          {p.is_bound === false && <Tag>未接入</Tag>}
        </div>)}</div>,
    }))} />
  </>;

  if (isLoading) return <div className="py-12 text-center text-muted">正在读取授权…</div>;
  if (accessError) return <Alert type="error" showIcon message={accessError} />;
  if (!canView) return <Alert type="warning" showIcon message="当前账号没有此项管理权限" />;
  const userColumns = [
    { title: '用户', dataIndex: 'username', render: (_: unknown, user: User) => <div><span className="font-medium">{user.username}</span>{user.is_superuser && <Tag className="ml-2" color="green">超级管理员</Tag>}<div className="mt-1 text-xs text-muted">{user.email || '未填写邮箱'}</div></div> },
    { title: '角色', render: (_: unknown, user: User) => user.role_names?.length ? <div className="flex flex-wrap gap-1">{user.role_names.map(name => <Tag key={name}>{name}</Tag>)}</div> : <span className="text-muted">未分配</span> },
    { title: '状态', render: (_: unknown, user: User) => <Tag color={user.is_active ? 'green' : 'default'}>{user.is_active ? '正常' : '已停用'}</Tag> },
    { title: '最近登录', dataIndex: 'last_login', render: (date: string) => <span className="text-xs text-muted">{date ? new Date(date).toLocaleString() : '尚未登录'}</span> },
    { title: '操作', render: (_: unknown, user: User) => <div className="flex gap-2">{can('change_user') && <Button size="small" onClick={() => void openEdit(user)}>编辑</Button>}{can('change_permission') && can('view_userpermission') && !user.is_superuser && <Button size="small" onClick={() => void openOverrides(user)}>单独授权</Button>}</div> },
  ];
  const roleColumns = [
    { title: '角色', dataIndex: 'name', render: (name: string, role: Role) => <div className="max-w-md"><span className="font-medium">{name}</span><div className="mt-1 text-xs text-muted">{role.description || '未填写说明'}</div></div> },
    { title: '成员', render: (_: unknown, role: Role) => <Button type="link" onClick={() => void showMembers(role)}>{role.user_count} 人</Button> },
    { title: '功能权限', dataIndex: 'permissions_count', render: (count: number) => `${count} 项` },
    { title: '状态', dataIndex: 'is_active', render: (active: boolean) => <Tag color={active ? 'green' : 'default'}>{active ? '启用' : '停用'}</Tag> },
    { title: '操作', render: (_: unknown, role: Role) => <div className="flex gap-2">{can('change_role') && <Button size="small" onClick={() => void openEdit(role)}>编辑与权限</Button>}{can('delete_role') && <Button size="small" danger disabled={role.user_count > 0} onClick={() => removeRole(role)}>删除</Button>}</div> },
  ];
  const permissionColumns = [
    { title: '功能', render: (_: unknown, p: Permission) => <span className="font-medium">{permissionLabel(p)}</span> },
    { title: '分组', render: (_: unknown, p: Permission) => groupName(p) },
    { title: '权限代码', dataIndex: 'codename', render: (code: string) => <code className="text-xs text-muted">{code}</code> },
    { title: '接入状态', render: (_: unknown, p: Permission) => <Tag color={p.is_bound ? 'green' : 'default'}>{p.is_bound ? '已接入功能' : '未绑定接口'}</Tag> },
  ];
  return <div className="access-settings">
    <div className="settings-toolbar">
      <Input aria-label="搜索管理列表" allowClear prefix={<Search size={16} />} placeholder={section === 'users' ? '搜索用户名或邮箱' : section === 'roles' ? '搜索角色' : '搜索功能或权限代码'} value={search} onChange={e => setSearch(e.target.value)} className="sm:max-w-sm" />
      {section === 'users' && <Select aria-label="用户状态" value={status} onChange={value => { setStatus(value); setPage(1); }} options={[{ value: 'all', label: '全部状态' }, { value: 'true', label: '正常' }, { value: 'false', label: '已停用' }]} />}
      <div className="ml-auto flex gap-2"><Button aria-label="刷新列表" icon={<RefreshCw size={15} />} onClick={() => void load()} />{section !== 'permissions' && can(section === 'users' ? 'add_user' : 'add_role') && <Button type="primary" icon={<Plus size={15} />} onClick={() => void openEdit('new')}>{section === 'users' ? '新建用户' : '新建角色'}</Button>}</div>
    </div>
    {section === 'permissions' && <p className="px-1 py-3 text-sm text-muted">在角色中勾选功能，再把角色分配给用户。权限代码由系统功能定义，新增代码不会产生新功能。</p>}
    {error && <Alert className="mb-3" type="error" showIcon message={error} action={<Button onClick={() => void load()}>重试</Button>} />}
    {section === 'users' ? <Table<User> rowKey="id" dataSource={rows} columns={userColumns} loading={loading} pagination={false} scroll={{ x: 700 }} locale={{ emptyText: error ? '加载失败' : '没有符合条件的记录' }} /> : section === 'roles' ? <Table<Role> rowKey="id" dataSource={rows} columns={roleColumns} loading={loading} pagination={false} scroll={{ x: 700 }} /> : <Table<Permission> rowKey="id" dataSource={rows} columns={permissionColumns} loading={loading} pagination={false} scroll={{ x: 700 }} />}
    <WorkspacePagination page={page} pageSize={pageSize} total={total} onChange={(p, size) => { setPage(p); setPageSize(size); }} />

    <Drawer title={`${editing === 'new' ? '新建' : '编辑'}${section === 'roles' ? '角色' : '用户'}`} open={!!editing} width={560} onClose={() => { if (!saving) setEditing(null); }} destroyOnClose maskClosable={!saving} footer={<div className="flex justify-end gap-2"><Button disabled={saving} onClick={() => setEditing(null)}>取消</Button><Button type="primary" loading={saving} onClick={() => void save()}>保存</Button></div>}>
      {formError && <Alert className="mb-4" type="error" showIcon message={formError} />}
      <Form form={form} layout="vertical" requiredMark={false}>
        {section === 'roles' ? <>
          <Form.Item name="name" label="角色名称" rules={[{ required: true, whitespace: true, message: '请输入角色名称' }]}><Input maxLength={100} /></Form.Item>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="is_active" label="启用角色" valuePropName="checked"><Switch /></Form.Item>
          <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">可使用的功能</h3><span className="text-xs text-muted">已选 {selectedPermissions.length} 项</span></div>
          {permissionPicker}
        </> : <>
          <Form.Item name="username" label="用户名" rules={[{ required: true, whitespace: true, message: '请输入用户名' }]}><Input disabled={editing !== 'new'} autoComplete="off" /></Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '请输入有效邮箱' }]}><Input autoComplete="off" /></Form.Item>
          <div className="grid grid-cols-2 gap-3"><Form.Item name="last_name" label="姓"><Input /></Form.Item><Form.Item name="first_name" label="名"><Input /></Form.Item></div>
          <Form.Item name="password" label={editing === 'new' ? '初始密码' : '重置密码（留空保留原密码）'} rules={editing === 'new' ? [{ required: true, message: '请输入初始密码' }] : []}><Input.Password autoComplete="new-password" /></Form.Item>
          {can('assign_user_roles') && <Form.Item name="role_ids" label="所属角色"><Select mode="multiple" placeholder="选择角色" options={roles.map(role => ({ value: role.id, label: `${role.name}${role.is_active ? '' : '（停用）'}` }))} /></Form.Item>}
          <Form.Item name="is_active" label="启用账号" valuePropName="checked"><Switch disabled={editing !== 'new' && editing?.id === currentUser?.id} /></Form.Item>
        </>}
      </Form>
    </Drawer>
    <Drawer title={`单独授权 · ${specialUser?.username || ''}`} open={!!specialUser} width={640} onClose={() => { if (!saving) setSpecialUser(null); }} destroyOnClose footer={<div className="flex justify-end gap-2"><Button disabled={saving} onClick={() => setSpecialUser(null)}>取消</Button><Button type="primary" disabled={overrideLoading || !overrideReady} loading={saving} onClick={() => void saveOverrides()}>保存授权</Button></div>}>
      <p className="mb-4 text-sm text-muted">默认继承角色；单独允许或禁止会覆盖角色设置。</p>
      {formError && <Alert type="error" showIcon message={formError} />}
      <Table rowKey="id" loading={overrideLoading} dataSource={permissions} pagination={false} columns={[
        { title: '功能', render: (_, p: Permission) => permissionLabel(p) },
        { title: '角色权限', render: (_, p: Permission) => <span className="text-xs text-muted">{inherited.includes(p.id) ? '已允许' : '未允许'}</span> },
        { title: '单独设置', render: (_, p: Permission) => <Select aria-label={`单独设置${permissionLabel(p)}`} value={overrides[p.id] || 'inherit'} onChange={value => setOverrides(prev => ({ ...prev, [p.id]: value }))} options={[{ value: 'inherit', label: '继承角色' }, { value: 'grant', label: '单独允许' }, { value: 'revoke', label: '单独禁止' }]} /> },
      ]} />
    </Drawer>
    <Drawer title={`${memberRole?.name || ''} · 成员`} open={!!memberRole} onClose={() => setMemberRole(null)} width={480}>
      <Table rowKey="id" dataSource={members} loading={memberLoading} pagination={false} columns={[{ title: '用户名', dataIndex: 'username' }, { title: '邮箱', dataIndex: 'email' }]} locale={{ emptyText: '尚无成员，在用户编辑中分配此角色' }} />
    </Drawer>
  </div>;
}

