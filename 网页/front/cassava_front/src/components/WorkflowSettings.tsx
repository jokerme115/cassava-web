import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Form, Input, InputNumber, Modal, Select, Switch, Table, Tag } from 'antd';
import { Plus } from 'lucide-react';
import api from '../services/rest/client';
import { saveUserPreferences } from '../services/preferences';
import { defaultPreferences, type UserPreferences, type PredictionPreset } from '../utils/userPreferences';
import { referenceStyle, type ExportTemplate, type FigureStyle } from '../utils/exportStyle';
import { workspaceStorageKey } from '../utils/workspaceContext';
import { message } from '../utils/feedback';
import type { User } from '../types';
import FigureStyleFields from './FigureStyleFields';
import { DraftStatus, FigureSettingsPreview, ImportSettingsPreview, ListSettingsPreview, PreviewFrame } from './SettingsPreview';
import { frozenModels } from '../utils/predictionPresets';
import { getApiErrorMessage } from '../utils/apiError';

const failure = (e: any) => getApiErrorMessage(e, '保存失败，请重试');
export default function WorkflowSettings({ section, user }: { section: string; user: User }) {
  const [prefs, setPrefs] = useState<UserPreferences>(() => ({ ...defaultPreferences, ...user.profile?.preferences }));
  const [form] = Form.useForm(), [editForm] = Form.useForm();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null), [style, setStyle] = useState<FigureStyle>(referenceStyle);
  const [models, setModels] = useState<Array<{ id: string; label: string; available: boolean; reason?: string }>>([]);
  const [model, setModel] = useState('pbt_c512');
  const [legacy, setLegacy] = useState<ExportTemplate[]>([]);
  const exporting = section === 'export-templates';
  const draft = Form.useWatch([], form) || {};
  const editDraft = Form.useWatch([], editForm) || {};
  const values = { ...prefs, ...draft };
  const activePreset = prefs.predictionPresets.find(p => p.id === values.defaultPredictionPreset);
  const activeStyle = prefs.exportTemplates.find(t => t.name === values.defaultExportTemplate)?.style || referenceStyle;
  useEffect(() => {
    const next = { ...defaultPreferences, ...user.profile?.preferences };
    setPrefs(next); form.setFieldsValue(next);
  }, [user, section, form]);
  useEffect(() => {
    if (section === 'prediction-presets') api.get('/models/').then(r => setModels(r.data)).catch((error) => setError(getApiErrorMessage(error, '模型目录加载失败，请刷新重试')));
    try { setLegacy(JSON.parse(localStorage.getItem(workspaceStorageKey('export-templates')) || '[]')); } catch { setLegacy([]); }
  }, [section]);
  const commit = async (patch: Partial<UserPreferences>) => {
    setBusy(true); setError('');
    try { const saved = await saveUserPreferences(patch); setPrefs({ ...defaultPreferences, ...saved.profile.preferences }); message.success('已保存'); return true; }
    catch (e) { setError(failure(e)); return false; } finally { setBusy(false); }
  };
  const open = (id: string) => {
    setEditing(id); setError('');
    const item = exporting ? prefs.exportTemplates.find(p => p.name === id) : prefs.predictionPresets.find(p => p.id === id);
    setStyle(exporting && item ? (item as ExportTemplate).style : { ...referenceStyle });
    setModel(!exporting && item ? (item as PredictionPreset).model : 'pbt_c512');
  };
  useEffect(() => {
    if (editing === null) return;
    editForm.resetFields();
    const item = exporting ? prefs.exportTemplates.find(p => p.name === editing) : prefs.predictionPresets.find(p => p.id === editing);
    editForm.setFieldsValue(Object.assign({ name: '', model: 'pbt_c512', confidenceThreshold: .5, usePostProcessing: true, useTTA: false }, item, item && !exporting ? (item as PredictionPreset).parameters : {}));
  }, [editing, exporting, editForm]);
  const saveItem = async () => {
    let values; try { values = await editForm.validateFields(); } catch { return; }
    if (exporting) {
      if (prefs.exportTemplates.some(t => t.name === values.name && t.name !== editing)) { setError('模板名称已存在'); return; }
      const old = prefs.exportTemplates.find(t => t.name === editing);
      const item = { name: values.name.trim(), version: (old?.version || 0) + 1, style };
      const next = old ? prefs.exportTemplates.map(t => t.name === editing ? item : t) : [...prefs.exportTemplates, item];
      if (await commit({ exportTemplates: next, ...(old && prefs.defaultExportTemplate === editing ? { defaultExportTemplate: item.name } : {}) })) setEditing(null);
    } else {
      if (prefs.predictionPresets.some(t => t.name === values.name && t.id !== editing)) { setError('预设名称已存在'); return; }
      const old = prefs.predictionPresets.find(t => t.id === editing);
      const parameters = frozenModels.includes(model) || model === 'ensemble' ? {} : { ...old?.parameters, confidenceThreshold: values.confidenceThreshold, usePostProcessing: values.usePostProcessing, useTTA: values.useTTA };
      const item: PredictionPreset = { id: old?.id || crypto.randomUUID(), name: values.name.trim(), model, mode: model === 'ensemble' ? 'ensemble' : 'single', version: (old?.version || 0) + 1, parameters };
      if (await commit({ predictionPresets: old ? prefs.predictionPresets.map(t => t.id === editing ? item : t) : [...prefs.predictionPresets, item] })) setEditing(null);
    }
  };
  const remove = (id: string, name: string) => Modal.confirm({ title: `删除“${name}”？`, content: '已有任务与导出记录保留。删除默认项后将恢复系统默认。', okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: async () => {
    const patch = exporting ? { exportTemplates: prefs.exportTemplates.filter(t => t.name !== id), ...(prefs.defaultExportTemplate === id ? { defaultExportTemplate: '' } : {}) } : { predictionPresets: prefs.predictionPresets.filter(t => t.id !== id), ...(prefs.defaultPredictionPreset === id ? { defaultPredictionPreset: '' } : {}) };
    if (!await commit(patch)) throw new Error('保存失败');
  } });
  const importLegacy = async () => {
    const merged = [...prefs.exportTemplates];
    for (const item of legacy) {
      let name = item.name, suffix = 1;
      while (merged.some(t => t.name === name)) name = `${item.name}（本机 ${suffix++}）`;
      merged.push({ name, version: 1, style: { ...referenceStyle, ...item.style, stages: item.style.stages || ['prediction'] } });
    }
    if (await commit({ exportTemplates: merged })) setLegacy([]);
  };
  return <div className="settings-form">
    {error && <Alert className="my-4" type="error" showIcon message={error} />}
    <div className={`settings-visual-layout${['prediction-presets', 'export-templates'].includes(section) ? ' settings-visual-layout--library' : ''}`}><Form form={form} className="settings-form--visual" layout="vertical" requiredMark={false} disabled={busy} onFinish={values => void commit(values)}>
      {section === 'lists' && <section className="settings-section"><h2>列表默认值</h2><div className="settings-fields">
        <Form.Item name="listView" label="展示方式"><Select options={[{ value: 'grid', label: '网格' }, { value: 'list', label: '列表' }]} /></Form.Item>
        <Form.Item name="listPageSize" label="每页数量"><Select options={[24, 48, 96, 120].map(value => ({ value, label: `${value} 项` }))} /></Form.Item>
        <Form.Item name="listSort" label="图片排序"><Select options={[{ value: 'date', label: '上传时间' }, { value: 'capture_time', label: '拍摄时间' }, { value: 'name', label: '名称' }, { value: 'folder', label: '文件夹' }, { value: 'size', label: '文件大小' }]} /></Form.Item>
        <Form.Item name="listOrder" label="排序方向"><Select options={[{ value: 'desc', label: '倒序' }, { value: 'asc', label: '正序' }]} /></Form.Item>
        <Form.Item name="listGroup" label="图片分组"><Select options={[{ value: 'none', label: '不分组' }, { value: 'year', label: '按年' }, { value: 'month', label: '按月' }, { value: 'day', label: '按日' }]} /></Form.Item>
      </div></section>}
      {section === 'imports' && <section className="settings-section"><h2>导入默认值</h2><div><Form.Item name="importMode" label="文件夹 / 压缩包归档"><Select options={[{ value: 'new', label: '按原名称新建子目录' }, { value: 'existing', label: '放入当前位置' }]} /></Form.Item><Form.Item name="preserveHierarchy" label="保留内部目录层级" valuePropName="checked"><Switch /></Form.Item></div></section>}
      {section === 'prediction-presets' && <section className="settings-section"><h2>预测默认值</h2><div className="settings-fields"><Form.Item name="defaultPredictionPreset" label="默认预设"><Select options={[{ value: '', label: '系统默认 · PBT c512 五种子' }, ...prefs.predictionPresets.map(t => ({ value: t.id, label: t.name }))]} /></Form.Item><Form.Item name="taskNamePrefix" label="任务名称前缀" rules={[{ required: true, whitespace: true }]}><Input maxLength={40} /></Form.Item></div></section>}
      {exporting && <section className="settings-section"><h2>导出默认值</h2><Form.Item name="defaultExportTemplate" label="默认模板"><Select options={[{ value: '', label: '参考图样式' }, ...prefs.exportTemplates.map(t => ({ value: t.name, label: t.name }))]} /></Form.Item></section>}
      <div className="settings-savebar"><Button htmlType="submit" type="primary" loading={busy}>保存默认值</Button><DraftStatus values={draft} saved={prefs}/></div>
    </Form>
    {section === 'lists' && <ListSettingsPreview value={values}/>}
    {section === 'imports' && <ImportSettingsPreview value={values}/>}
    {exporting && <FigureSettingsPreview value={activeStyle}/>}
    {section === 'prediction-presets' && <PreviewFrame title="新任务配置" footer={<span>用于新建任务，已有任务保持原配置</span>}><div className="preview-task"><div className="preview-task-images"><img src="/cases/cassava-lab.jpg" alt="木薯切面示例"/><span>选择图片</span></div><div className="preview-task-settings"><span>任务名称示例</span><strong>{values.taskNamePrefix || '预测任务'}-2026/05/18</strong><span>模型</span><strong>{models.find(m => m.id === (activePreset?.model || 'pbt_c512'))?.label || activePreset?.model || 'PBT c512 五种子'}</strong><span>预设</span><strong>{activePreset ? `${activePreset.name} · v${activePreset.version}` : '系统默认'}</strong><span>推理协议</span><strong>{frozenModels.includes(activePreset?.model || 'pbt_c512') ? '冻结协议' : '使用预设参数'}</strong></div></div></PreviewFrame>}
    {['prediction-presets', 'export-templates'].includes(section) && <div className="access-settings pb-6">
      <div className="settings-toolbar"><h2 className="font-semibold">{exporting ? '账号模板' : '预测预设'}</h2><div className="ml-auto flex gap-2">{exporting && legacy.length > 0 && <Button disabled={busy} onClick={() => void importLegacy()}>导入本机旧模板（{legacy.length}）</Button>}<Button type="primary" icon={<Plus size={15} />} onClick={() => open('')}>{exporting ? '新建模板' : '新建预设'}</Button></div></div>
      <Table<any> rowKey={exporting ? 'name' : 'id'} pagination={false} scroll={{ x: 550 }} dataSource={exporting ? prefs.exportTemplates : prefs.predictionPresets} columns={[
        { title: '名称', dataIndex: 'name' }, { title: '版本', dataIndex: 'version', render: v => <Tag>v{v}</Tag> },
        ...(!exporting ? [{ title: '模型', dataIndex: 'model', render: (id: string) => models.find(m => m.id === id)?.label || id }] : []),
        { title: '操作', render: (_, item) => <div className="flex gap-2"><Button size="small" disabled={busy} onClick={() => open(exporting ? item.name : item.id)}>编辑</Button><Button danger size="small" disabled={busy} onClick={() => remove(exporting ? item.name : item.id, item.name)}>删除</Button></div> },
      ]} locale={{ emptyText: exporting ? '尚无账号模板' : '尚无个人预设' }} />
    </div>}
    </div>
    <Drawer title={exporting ? '导出模板' : '预测预设'} width={exporting ? 960 : 520} open={editing !== null} onClose={() => { if (!busy) setEditing(null); }} destroyOnClose footer={<div className="flex justify-end gap-2"><Button disabled={busy} onClick={() => setEditing(null)}>取消</Button><Button type="primary" loading={busy} onClick={() => void saveItem()}>保存</Button></div>}>
      {error && <Alert className="mb-4" type="error" showIcon message={error} />}
      <div className={exporting ? "settings-template-editor" : undefined}><div>
      <Form form={editForm} layout="vertical" requiredMark={false}><Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: '请输入名称' }]}><Input maxLength={100} /></Form.Item>
        {!exporting && <><Form.Item name="model" label="模型" rules={[{ required: true }]}><Select onChange={setModel} options={models.map(m => ({ value: m.id, label: `${m.label}${m.available ? '' : '（不可用）'}`, disabled: !m.available }))} /></Form.Item>{!frozenModels.includes(model) && model !== 'ensemble' && <><Form.Item name="confidenceThreshold" label="置信度"><InputNumber min={0} max={1} step={.05} /></Form.Item><Form.Item name="usePostProcessing" label="后处理" valuePropName="checked"><Switch /></Form.Item><Form.Item name="useTTA" label="测试时增强" valuePropName="checked"><Switch /></Form.Item></>}</>}
      </Form>
      {exporting && <FigureStyleFields value={style} onChange={setStyle} />}
      </div>
      {!exporting && <PreviewFrame title="预设内容" footer={<span>保存为个人预设，下次创建任务时可直接选择</span>}><div className="preview-task-settings p-5"><span>名称</span><strong>{editDraft.name || '未命名预设'}</strong><span>模型</span><strong>{models.find(m => m.id === model)?.label || model}</strong><span>推理设置</span><strong>{frozenModels.includes(model) ? '冻结实现、预处理与推理协议' : model === 'ensemble' ? '使用模型投票配置' : `置信度 ${editDraft.confidenceThreshold ?? .5} · 后处理${editDraft.usePostProcessing ? '开启' : '关闭'} · TTA ${editDraft.useTTA ? '开启' : '关闭'}`}</strong></div></PreviewFrame>}
      {exporting && <FigureSettingsPreview value={style}/>}
      </div>
    </Drawer>
  </div>;
}
