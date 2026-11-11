import { message } from '../utils/feedback';
import { useEffect, useState } from 'react';
import { Button, Drawer, Modal, Tabs, Empty } from 'antd';
import { Trash2 } from 'lucide-react';
import api, { parseListResult } from '../services/rest/client';
import { getApiErrorMessage } from '../utils/apiError';

interface Entry { id: number; name: string; deleted_at?: string }
export default function RecycleBin({ onChange }: { onChange: () => void }) {
  const [open, setOpen] = useState(false), [kind, setKind] = useState('images');
  const [items, setItems] = useState<Entry[]>([]), [page, setPage] = useState(1), [more, setMore] = useState(false);
  const [modal, contextHolder] = Modal.useModal();
  const load = async (nextPage = 1) => {
    try {
      const response = await api.get(`/${kind}/`, { params: { trash: 1, page: nextPage, page_size: 50 } });
      const data = parseListResult<Entry>(response.data);
      setItems(previous => nextPage === 1 ? data.items : [...previous, ...data.items]); setPage(nextPage); setMore(Boolean(data.next));
    } catch (error) { message.error(getApiErrorMessage(error, '回收站加载失败')); }
  };
  useEffect(() => { if (open) void load(); }, [open, kind]);
  const restore = async (entry: Entry) => {
    try { await api.post(`/${kind}/${entry.id}/restore/`); message.success('已恢复'); void load(); onChange(); }
    catch (error) { message.error(getApiErrorMessage(error, '恢复失败')); }
  };
  const purge = async (entry: Entry) => {
    try {
      const { data } = await api.get(`/${kind}/${entry.id}/deletion-impact/`);
      modal.confirm({ title: `永久清除“${entry.name}”？`, content: `将删除原图 ${data.images} 张、历史预测 ${data.predictions} 条、人工修订 ${data.corrections} 版。此操作无法恢复。`, okText: '永久清除', okButtonProps: { danger: true }, cancelText: '取消', onOk: async () => {
        await api.post(`/${kind}/${entry.id}/purge/`, { confirm: 'PERMANENT_DELETE' }); void load(); onChange();
      } });
    } catch (error) { message.error(getApiErrorMessage(error, '无法读取删除影响')); }
  };
  return <>{contextHolder}<Button icon={<Trash2 size={15} />} onClick={() => setOpen(true)}>回收站</Button>
    <Drawer title="回收站" width={Math.min(600, window.innerWidth)} open={open} onClose={() => setOpen(false)}>
      <Tabs activeKey={kind} onChange={setKind} items={[{ key: 'images', label: '图片' }, { key: 'folders', label: '文件夹' }, { key: 'tasks', label: '任务' }]} />
      {!items.length && <Empty description="回收站为空" />}
      {items.map(entry => <div key={entry.id} className="mb-3 flex items-center gap-2 rounded-lg border border-hairline p-3"><span className="min-w-0 flex-1 truncate">{entry.name}</span><Button size="small" onClick={() => void restore(entry)}>恢复</Button><Button size="small" danger onClick={() => void purge(entry)}>永久清除</Button></div>)}
      {more && <Button onClick={() => void load(page + 1)}>加载更多</Button>}
    </Drawer></>;
}
