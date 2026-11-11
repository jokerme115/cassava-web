from pathlib import Path
p=Path('网页/front/cassava_front/src/components/SettingsWorkspace.tsx'); s=p.read_text(encoding='utf-8')
s=s.replace("import { workspaceStorageKey } from '../utils/workspaceContext';", "import WorkflowSettings from './WorkflowSettings';\nimport { saveUserPreferences } from '../services/preferences';")
s=s.replace("  const [templates, setTemplates] = useState<Array<{ name: string }>>([]);\n",'')
s=s.replace("    { id: 'preferences', label: '工作区偏好', icon: SlidersHorizontal },", "    { id: 'preferences', label: '复检与通用', icon: SlidersHorizontal },\n    { id: 'lists', label: '图片与列表', icon: SlidersHorizontal },\n    { id: 'imports', label: '导入默认', icon: Settings2 },\n    { id: 'prediction-presets', label: '预测预设', icon: SlidersHorizontal },\n    { id: 'export-templates', label: '导出模板', icon: FileText },")
s=s.replace('cacheUserPreferences(preferences);', 'cacheUserPreferences(preferences, currentUser.profile?.preferences_etag);')
s=s.replace("    try { setTemplates(JSON.parse(localStorage.getItem(workspaceStorageKey('export-templates')) || '[]')); } catch { setTemplates([]); }\n",'')
s=s.replace("const user = await authApi.updateProfile({ preferences: values });", "const user = await saveUserPreferences(values);")
s=s.replace('cacheUserPreferences(user.profile?.preferences || values);','cacheUserPreferences(user.profile?.preferences || values, user.profile?.preferences_etag);')
a=s.index('        <section className="settings-section"><h2>导出</h2>'); b=s.index('\n',a)
s=s[:a]+s[b:]
needle='        <div className="settings-savebar"><Button type="primary" htmlType="submit" loading={busy}>保存偏好'
pos=s.index(needle)
s=s[:pos]+'''        <section className="settings-section"><h2>连续复检</h2><div className="settings-fields">
          <Form.Item name="editorResetZoom" label="切图时适应窗口" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="editorDimOutside" label="压暗主体外背景" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="editorShowCassava" label="默认显示主体" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="editorShowRotten" label="默认显示病斑" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="autoAdvanceReview" label="完成复检后自动下一张" valuePropName="checked"><Switch /></Form.Item>
        </div></section>
'''+s[pos:]
s=s.replace("      {['users', 'roles', 'permissions'].includes(section)", "      {['lists', 'imports', 'prediction-presets', 'export-templates'].includes(section) && <WorkflowSettings key={section} section={section} user={currentUser} />}\n      {['users', 'roles', 'permissions'].includes(section)")
p.write_text(s,encoding='utf-8')
# wire list defaults
for name in ['ImageManagement','ResultsCenter','TaskCenter']:
 p=Path('网页/front/cassava_front/src/components')/(name+'.tsx'); s=p.read_text(encoding='utf-8')
 if 'import { getUserPreferences }' not in s: s="import { getUserPreferences } from '../utils/userPreferences';\n"+s
 if name=='ImageManagement':
  s=s.replace("('image-view-mode', 'grid')", "('image-view-mode', getUserPreferences().listView)").replace("('image-sort', 'date')", "('image-sort', getUserPreferences().listSort)").replace("('image-sort-order', 'desc')", "('image-sort-order', getUserPreferences().listOrder)")
  s=s.replace("        if (dateGroupType === 'year')", "        if (dateGroupType === 'none') return '';\n        if (dateGroupType === 'year')")
  # expose no grouping alongside existing year/month/day
  s=s.replace('<option value="year">', '<option value="none">不分组</option><option value="year">')
 if name=='ResultsCenter':
  s=s.replace("('results-page-size', 48)", "('results-page-size', getUserPreferences().listPageSize)")
  s=s.replace("useState<'grid' | 'list'>('grid')", "useViewState<'grid' | 'list'>('results-view', getUserPreferences().listView)")
 if name=='TaskCenter': s=s.replace("('task-page-size', 48)", "('task-page-size', getUserPreferences().listPageSize)")
 p.write_text(s,encoding='utf-8')
p=Path('网页/front/cassava_front/src/hooks/useImageStore.ts'); s=p.read_text(encoding='utf-8'); s="import { getUserPreferences } from '../utils/userPreferences';\n"+s;s=s.replace('isGuest ? 36 : 48', 'isGuest ? 36 : getUserPreferences().listPageSize'); p.write_text(s,encoding='utf-8')
p=Path('网页/front/cassava_front/src/components/ImportWorkspace.tsx'); s=p.read_text(encoding='utf-8'); s="import { getUserPreferences } from '../utils/userPreferences';\n"+s;s=s.replace("useState('new')", "useState<string>(() => getUserPreferences().importMode)").replace('const [preserve, setPreserve] = useState(true)', 'const [preserve, setPreserve] = useState(() => getUserPreferences().preserveHierarchy)');p.write_text(s,encoding='utf-8')
