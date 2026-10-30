import { message } from '../utils/feedback';
import React, { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Drawer, Modal, Progress, Select, Switch, Input, Alert } from 'antd';
import { Upload, History, RotateCcw } from 'lucide-react';
import api from '../services/rest/client';
import { folderPath, useWorkspace, updateWorkspace } from '../utils/workspaceContext';
import { getApiErrorMessage } from '../utils/apiError';
import type { Folder } from '../types';

interface ImportItem { id: number; relative_path: string; size: number; offset: number; state: string; error: string;
  chunk_hashes: Array<{ offset: number; size: number; sha256: string }> }
interface ImportJob { id: number; task_id: number; state: string; error: string; items: ImportItem[];
  target_folder: number | null;
  destination_folder: number | null;
  summary: { total?: number; success?: number; skipped?: number; failed?: number }; options: { resolved_name?: string } }
const terminal = ['completed', 'partial', 'failed', 'cancelled'];
const labels: Record<string, string> = { uploading: '上传中／可续传', queued: '等待导入', running: '正在导入', completed: '已完成', partial: '部分失败', failed: '失败', cancelled: '已取消' };
const supported = /\.(jpe?g|png|bmp|webp|tiff?|mpo|zip|7z|rar)$/i;
const isArchive = (file: File) => /\.(zip|7z|rar)$/i.test(file.name);
const pathOf = (file: File) => file.webkitRelativePath || file.name;
const sha256 = async (blob: Blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');

export default function ImportWorkspace({ folders, onComplete }: { folders: Folder[]; onComplete: () => void }) {
  const workspace = useWorkspace();
  const target = workspace.folder && /^\d+$/.test(workspace.folder) ? workspace.folder : workspace.lastWritableFolder;
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState(false);
  const [mode, setMode] = useState('new');
  const [name, setName] = useState('');
  const [targetId, setTargetId] = useState<string | null>(target);
  const [changeLocation, setChangeLocation] = useState(false);
  const [preserve, setPreserve] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resumeId, setResumeId] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null);
  const previousStates = useRef(new Map<number, string>());
  const completeRef = useRef(onComplete); completeRef.current = onComplete;
  const refresh = async () => {
    try {
      const data = (await api.get<ImportJob[]>('/imports/')).data;
      setJobs(data);
      let changed = false;
      for (const job of data) {
        const before = previousStates.current.get(job.id);
        if (before && !terminal.includes(before) && terminal.includes(job.state)) changed = true;
        previousStates.current.set(job.id, job.state);
      }
      if (changed) completeRef.current();
    } catch { /* Initial request errors are shown when an action is attempted. */ }
  };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 2500); return () => window.clearInterval(timer); }, []);

  const transfer = async (selected: File[], job: ImportJob) => {
    const map = new Map(selected.map(file => [pathOf(file), file]));
    const pending = job.items.filter(item => item.state === 'uploading');
    const total = pending.reduce((sum, item) => sum + item.size, 0);
    let received = pending.reduce((sum, item) => sum + item.offset, 0), next = 0;
    setProgress(Math.round(100 * received / Math.max(total, 1)));
    const lane = async () => {
      while (next < pending.length) {
        const item = pending[next++], file = map.get(item.relative_path);
        if (!file || file.size !== item.size) throw new Error(`请重新选择同一文件或目录：${item.relative_path}`);
        for (const chunk of item.chunk_hashes || []) {
          if (await sha256(file.slice(chunk.offset, chunk.offset + chunk.size)) !== chunk.sha256) throw new Error(`文件内容已变化，不能续传：${item.relative_path}`);
        }
        let offset = item.offset;
        while (offset < file.size) {
          const blob = file.slice(offset, offset + 8 * 1024**2);
          const body = new FormData(); body.append('chunk', blob, 'chunk.bin'); body.append('offset', String(offset));
          const response = await api.post<{ offset: number }>(`/imports/${job.id}/items/${item.id}/chunk/`, body, { timeout: 180000 });
          received += response.data.offset - offset; offset = response.data.offset;
          setProgress(Math.round(100 * received / Math.max(total, 1)));
        }
      }
    };
    const results = await Promise.allSettled([lane(), lane(), lane()]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    await api.post(`/imports/${job.id}/finalize/`);
    message.success('已上传，等待导入');
  };

  const start = async (selected: File[], options: { mode: string; name?: string; preserve_hierarchy: boolean }, destination: string | null) => {
    setBusy(true); setPreview(false); setOpen(true);
    try {
      const job = resumeId ? (await api.get<ImportJob>(`/imports/${resumeId}/`)).data : (await api.post<ImportJob>('/imports/', {
        files: selected.map(file => ({ path: pathOf(file), size: file.size })), target_folder: destination,
        options: { ...options, check_duplicate: true, source_kind: selected.some(file => file.webkitRelativePath) ? 'folder' : 'files' },
      })).data;
      previousStates.current.set(job.id, 'uploading');
      setResumeId(job.id);
      await transfer(selected, job); setResumeId(null);
    } catch (error) { message.error(getApiErrorMessage(error, error instanceof Error ? error.message : '导入失败')); }
    finally { setBusy(false); void refresh(); }
  };

  const choose = (incoming: File[]) => {
    const valid = incoming.filter(file => supported.test(file.name));
    if (valid.length !== incoming.length) message.info(`忽略 ${incoming.length - valid.length} 个非图片或不支持的文件`);
    if (!valid.length) return;
    setFiles(valid); setTargetId(target); setChangeLocation(false);
    if (resumeId) { void start(valid, { mode: 'existing', preserve_hierarchy: true }, target); return; }
    if (valid.some(file => file.webkitRelativePath || isArchive(file))) {
      setMode('new'); setName((valid[0].webkitRelativePath?.split('/')[0] || valid[0].name).replace(/\.(zip|7z|rar)$/i, '')); setPreview(true);
    } else void start(valid, { mode: 'existing', preserve_hierarchy: true }, target);
  };
  const invoke = async (job: ImportJob, action: string) => {
    try { await api.post(`/imports/${job.id}/${action}/`); void refresh(); }
    catch (error) { message.error(getApiErrorMessage(error, '操作失败')); }
  };
  return <div className="import-workspace-controls flex min-w-0 flex-wrap items-center gap-2" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); choose(Array.from(event.dataTransfer.files)); }}>
    <span className="import-target max-w-64 truncate text-xs text-muted" title={folderPath(folders, target)}>上传至：{folderPath(folders, target)}</span>
    <Dropdown trigger={['click']} disabled={busy} menu={{ items: [{ key: 'images', label: '图片（可多选）' }, { key: 'folder', label: '文件夹' }, { key: 'archive', label: '压缩包（ZIP / 7Z / RAR）' }], onClick: ({ key }) => {
      setResumeId(null);
      if (key === 'folder') folderInput.current?.click();
      else if (fileInput.current) { fileInput.current.accept = key === 'archive' ? '.zip,.7z,.rar' : '.jpg,.jpeg,.png,.bmp,.webp,.tif,.tiff,.mpo'; fileInput.current.click(); }
    } }}><Button aria-label="上传" type="primary" icon={<Upload size={15} />} disabled={busy}>上传</Button></Dropdown>
    <Button aria-label="导入任务" icon={<History size={16} />} onClick={() => setOpen(true)} />
    <input ref={fileInput} hidden type="file" multiple accept=".jpg,.jpeg,.png,.bmp,.webp,.tif,.tiff,.mpo,.zip,.7z,.rar" onChange={event => { choose(Array.from(event.target.files || [])); event.target.value = ''; }} />
    <input ref={folderInput} hidden type="file" multiple {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={event => { choose(Array.from(event.target.files || [])); event.target.value = ''; }} />
    <Modal title="确认这批资料如何归档" open={preview} onCancel={() => setPreview(false)} onOk={() => void start(files, { mode, name, preserve_hierarchy: preserve }, targetId)} okText="开始上传" confirmLoading={busy}>
      <p className="mb-4 text-sm text-muted">{files.length} 个文件 · {(files.reduce((sum, file) => sum + file.size, 0) / 1024**2).toFixed(1)} MB</p>
      <div className="space-y-4">
        <div className="rounded-lg bg-surface-muted p-3 text-sm">当前位置：{folderPath(folders, targetId)} <Button type="link" size="small" onClick={() => setChangeLocation(!changeLocation)}>更改位置</Button></div>
        {changeLocation && <Select className="w-full" showSearch optionFilterProp="label" value={targetId || ''} onChange={value => setTargetId(value || null)} options={[{ value: '', label: '未分类' }, ...folders.map(folder => ({ value: String(folder.id), label: folderPath(folders, folder.id) }))]} />}
        <Select className="w-full" value={mode} onChange={setMode} options={[{ value: 'new', label: '按原名称新建子目录' }, { value: 'custom', label: '自定义新目录名称' }, { value: 'existing', label: '直接放入当前位置' }]} />
        {mode !== 'existing' && <Input aria-label="新目录名称" value={name} onChange={event => setName(event.target.value)} />}
        <label className="flex items-center justify-between text-sm">保留内部子目录<Switch checked={preserve} onChange={setPreserve} /></label>

        {mode !== 'existing' && folders.some(folder => folder.name === name && String(folder.parent || '') === String(targetId || '')) && <Button onClick={() => { const existing = folders.find(folder => folder.name === name && String(folder.parent || '') === String(targetId || '')); if (existing) { setTargetId(String(existing.id)); setMode('existing'); } }}>复用已有“{name}”目录</Button>}
      </div>
    </Modal>
    <Drawer title="导入任务" width={Math.min(560, window.innerWidth)} open={open} onClose={() => setOpen(false)}>
      {busy && <div className="mb-5"><p className="text-sm">正在上传</p><Progress percent={progress} /></div>}
      {!jobs.length && <p className="text-muted">尚无导入任务</p>}
      {jobs.map(job => <article key={job.id} className="mb-4 rounded-xl border border-hairline p-4">
        <div className="flex justify-between gap-2"><strong>{job.options.resolved_name || `导入 #${job.id}`}</strong><span className="text-sm">{labels[job.state] || job.state}</span></div>
        <p className="my-2 text-xs text-muted">成功 {job.summary.success || 0} · 跳过 {job.summary.skipped || 0} · 失败 {job.summary.failed || 0}</p>
        {job.error && <Alert type="error" message={job.error} />}
        <div className="flex flex-wrap gap-2">
          <Button size="small" onClick={() => { const folder = job.destination_folder ?? job.target_folder; updateWorkspace({ folder: folder ? String(folder) : 'uncategorized', selectedIds: [] }); setOpen(false); }}>打开文件夹</Button>
          {job.state === 'uploading' && <><Button size="small" disabled={busy} onClick={() => { setResumeId(job.id); fileInput.current?.click(); }}>重选文件续传</Button><Button size="small" disabled={busy} onClick={() => { setResumeId(job.id); folderInput.current?.click(); }}>重选目录续传</Button></>}
          {['partial', 'failed'].includes(job.state) && <Button size="small" icon={<RotateCcw size={13} />} onClick={() => void invoke(job, 'retry')}>仅重试失败项</Button>}
          {!terminal.includes(job.state) && <Button size="small" onClick={() => void invoke(job, 'cancel')}>取消未完成部分</Button>}
        </div>
        {job.items.some(item => item.error) && <details className="mt-3 text-xs"><summary>查看逐项处理说明</summary>{job.items.filter(item => item.error).map(item => <p className="mt-2 break-all" key={item.id}>{item.relative_path}：{item.error}</p>)}</details>}
      </article>)}
    </Drawer>
  </div>;
}
