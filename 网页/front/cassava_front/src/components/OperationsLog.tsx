import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Drawer, Select, Table, Tag } from 'antd';
import { RefreshCw } from 'lucide-react';
import { permissionsApi } from '../services/api';
import WorkspacePagination from './WorkspacePagination';

interface Log { id: number; timestamp: string; username: string; action: string; resourceType: string; resourceId: string; success: boolean; details: unknown }
const actions: Record<string, string> = { CREATE: '创建', UPDATE: '更新', DELETE: '删除', LOGIN: '登录', LOGOUT: '退出', ASSIGN: '授权', ASSIGN_ROLE: '分配角色', REMOVE_ROLE: '移除角色', EXPORT: '导出' };
const resources: Record<string, string> = { User: '用户', Role: '角色', Permission: '功能权限', UserPermission: '单独授权', UserRole: '用户角色', UserProfile: '个人设置', CassavaImage: '图片', Folder: '文件夹', ProcessingTask: '任务', PredictionResult: '结果', SystemSetting: '站点设置' };
export default function OperationsLog() {
  const [rows, setRows] = useState<Log[]>([]), [total, setTotal] = useState(0);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(24);
  const [action, setAction] = useState(''), [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [selected, setSelected] = useState<Log | null>(null);
  const sequence = useState(() => ({ value: 0 }))[0];
  const load = useCallback(async () => {
    const id = ++sequence.value;
    setLoading(true); setError('');
    try {
      const data = await permissionsApi.getAuditLogs({ page, page_size: pageSize, ...(action ? { action } : {}), ...(success ? { success } : {}), ...(query ? { resourceType: query } : {}) });
      if (id === sequence.value) { setRows(data.results || []); setTotal(data.count || 0); }
    } catch { if (id === sequence.value) setError('操作日志加载失败，请重试'); }
    finally { if (id === sequence.value) setLoading(false); }
  }, [page, pageSize, action, success, query, sequence]);
  useEffect(() => { void load(); return () => { sequence.value += 1; }; }, [load, sequence]);
  return <div className="access-settings">
    <div className="settings-toolbar">
      <Select aria-label="筛选日志资源" value={query} onChange={value => { setQuery(value); setPage(1); }} options={[{ value: '', label: '全部对象' }, ...Object.entries(resources).map(([value, label]) => ({ value, label }))]} />
      <Select aria-label="日志操作" value={action} onChange={value => { setAction(value); setPage(1); }} options={[{ value: '', label: '全部操作' }, ...Object.entries(actions).map(([value, label]) => ({ value, label }))]} />
      <Select aria-label="日志结果" value={success} onChange={value => { setSuccess(value); setPage(1); }} options={[{ value: '', label: '全部结果' }, { value: 'true', label: '成功' }, { value: 'false', label: '失败' }]} />
      <Button className="ml-auto" aria-label="刷新日志" icon={<RefreshCw size={15} />} onClick={() => void load()} />
    </div>
    {error && <Alert className="mb-4" message={error} showIcon type="error" />}
    <Table<Log> rowKey="id" loading={loading} dataSource={rows} pagination={false} scroll={{ x: 720 }} columns={[
      { title: '时间', dataIndex: 'timestamp', render: value => <span className="text-xs text-muted">{new Date(value).toLocaleString()}</span> },
      { title: '操作人', dataIndex: 'username', render: value => value || '系统' },
      { title: '操作', dataIndex: 'action', render: value => actions[value] || value },
      { title: '对象', render: (_, log) => <>{resources[log.resourceType] || log.resourceType}{log.resourceId && <span className="ml-2 text-xs text-muted">#{log.resourceId}</span>}</> },
      { title: '结果', dataIndex: 'success', render: value => <Tag color={value ? 'green' : 'red'}>{value ? '成功' : '失败'}</Tag> },
      { title: '记录', render: (_, log) => <Button size="small" onClick={() => setSelected(log)}>详情</Button> },
    ]} />
    <WorkspacePagination page={page} pageSize={pageSize} total={total} onChange={(p, size) => { setPage(p); setPageSize(size); }} />
    <Drawer title="操作记录" open={!!selected} onClose={() => setSelected(null)} width={540}><pre className="whitespace-pre-wrap break-words text-sm text-ink-secondary">{typeof selected?.details === 'string' ? selected.details : JSON.stringify(selected?.details || {}, null, 2)}</pre></Drawer>
  </div>;
}
