import { message } from '../utils/feedback';
import { useEffect, useState } from 'react';
import { Button, Drawer, Modal, Tabs, Empty } from 'antd';
import { Trash2 } from 'lucide-react';
import api, { parseListResult } from '../services/rest/client';
import { getApiErrorMessage } from '../utils/apiError';

interface Entry { id: number; name: string; deleted_at?: string }

// 回收站里“恢复/永久清除”属于删除类操作，按分类分别要求对应的删除权限；
// 没有权限的分类整页签不出现，避免点下去才收到 403。
const TABS = [
  { key: 'images', label: '图片', code: 'delete_image' },
  { key: 'folders', label: '文件夹', code: 'delete_folder' },
  { key: 'tasks', label: '任务', code: 'delete_task' },
] as const;

type Kind = typeof TABS[number]['key'];

export default function RecycleBin({ onChange, canManage }: { onChange: () => void; canManage?: (code: string) => boolean }) {
  const allow = canManage ?? (() => true);
  const tabs = TABS.filter(tab => allow(tab.code));
  const [open, setOpen] = useState(false), [kind, setKind] = useState<Kind>('images');
  const activeKind: Kind = tabs.some(tab => tab.key === kind) ? kind : (tabs[0]?.key ?? 'images');
  const [items, setItems] = useState<Entry[]>([]), [page, setPage] = useState(1), [more, setMore] = useState(false);
  const [modal, contextHolder] = Modal.useModal();
  const load = async (nextPage = 1) => {
    try {
      const response = await api.get(`/${activeKind}/`, { params: { trash: 1, page: nextPage, page_size: 50 } });
      const data = parseListResult<Entry>(response.data);
      setItems(previous => nextPage === 1 ? data.items : [...previous, ...data.items]); setPage(nextPage); setMore(Boolean(data.next));
    } catch (error) { message.error(getApiErrorMessage(error, '回收站加载失败')); }
  };
  useEffect(() => { setItems([]); if (open) void load(); }, [open, activeKind]);
  const restore = async (entry: Entry) => {
    try { await api.post(`/${activeKind}/${entry.id}/restore/`); message.success('已恢复'); void load(); onChange(); }
    catch (error) { message.error(getApiErrorMessage(error, '恢复失败')); }
  };
  const purge = async (entry: Entry) => {
    try {
      const { data } = await api.get(`/${activeKind}/${entry.id}/deletion-impact/`);
      modal.confirm({ title: `永久清除“${entry.name}”？`, content: `将删除原图 ${data.images} 张、历史预测 ${data.predictions} 条、人工修订 ${data.corrections} 版。此操作无法恢复。`, okText: '永久清除', okButtonProps: { danger: true }, cancelText: '取消', onOk: async () => {
        try {
          await api.post(`/${activeKind}/${entry.id}/purge/`, { confirm: 'PERMANENT_DELETE' });
        } catch (error) {
          message.error(getApiErrorMessage(error, '永久清除失败'));
          throw error;
        }
        void load(); onChange();
      } });
    } catch (error) { message.error(getApiErrorMessage(error, '无法读取删除影响')); }
  };
  if (!tabs.length) return null;
  return <>{contextHolder}<Button icon={<Trash2 size={15} />} onClick={() => setOpen(true)}>回收站</Button>
    <Drawer title="回收站" width={Math.min(600, window.innerWidth)} open={open} onClose={() => setOpen(false)}>
      {tabs.length > 1 && <Tabs activeKey={activeKind} onChange={key => setKind(key as Kind)} items={tabs.map(tab => ({ key: tab.key, label: tab.label }))} />}
      {!items.length && <Empty description="回收站为空" />}
      {items.map(entry => <div key={entry.id} className="mb-3 flex items-center gap-2 rounded-lg border border-hairline p-3"><span className="min-w-0 flex-1 truncate">{entry.name}</span><Button size="small" onClick={() => void restore(entry)}>恢复</Button><Button size="small" danger onClick={() => void purge(entry)}>永久清除</Button></div>)}
      {more && <Button onClick={() => void load(page + 1)}>加载更多</Button>}
    </Drawer></>;
}
