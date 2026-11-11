import { useState } from 'react';
import { Button, Modal } from 'antd';
import api from '../services/rest/client';
import { message } from '../utils/feedback';
import { getApiErrorMessage } from '../utils/apiError';

export default function BulkCaptureTime({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false), [value, setValue] = useState(''), [saving, setSaving] = useState(false);
  const save = async () => {
    if (!value) return;
    setSaving(true);
    try {
      const { data } = await api.post('/images/capture-metadata/', { image_ids: ids, capture_time: `${value}+08:00` });
      message.success(`已更新 ${data.updated} 张图片的拍摄时间`); setOpen(false); onDone();
    } catch (error) { message.error(getApiErrorMessage(error, '批量补填失败')); }
    finally { setSaving(false); }
  };
  return <><Button onClick={() => setOpen(true)}>批量补填拍摄时间</Button><Modal title={`为所选 ${ids.length} 张图片补填拍摄时间`} open={open} onCancel={() => setOpen(false)} onOk={() => void save()} confirmLoading={saving} okButtonProps={{ disabled: !value }} okText="保存时间">
    <label className="block text-sm">拍摄时间（北京时间 UTC+8）<input type="datetime-local" aria-label="批量拍摄时间" value={value} onChange={event => setValue(event.target.value)} className="my-3 w-full rounded-lg border border-hairline p-3" /></label>

  </Modal></>;
}
