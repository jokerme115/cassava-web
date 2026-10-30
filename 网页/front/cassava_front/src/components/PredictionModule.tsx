import WorkspacePagination from './WorkspacePagination';
import { message } from '../utils/feedback';
import api from '../services/rest/client';
import { getWorkspace, updateWorkspace } from '../utils/workspaceContext';
import { useNavigate } from 'react-router-dom';
import ImageResolutionLabel from './ImageResolutionLabel';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Image as ImageIcon, FolderOpen, Search, SortAsc, SortDesc, SlidersHorizontal } from 'lucide-react';
import { useImageStore } from '../hooks/useImageStore';
import { useTaskStore } from '../hooks/useTaskStore';
import { Tree, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../utils/apiError';

const PredictionModule: React.FC<{ currentUser?: any }> = ({ currentUser }) => {
  const { t } = useTranslation();
  const {
    images,
    folders,
    loading: imagesLoading,
    totalImages,
    selectedFolder, setSelectedFolder, setImageSearchQuery, setImageOrdering, goToImagesPage, imagesPage, imagesPageSize,
  } = useImageStore(Boolean(currentUser?.is_guest));
  const { createTask } = useTaskStore();
  const ALL_NODE_VALUE = '__all__';
  const UNCATEGORIZED_NODE_VALUE = '__uncategorized__';
  
  const [selectedItems, setSelectedItems] = useState<string[]>(() => getWorkspace().selectedIds);
  const batchSize = 32;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [predictionMode, setPredictionMode] = useState<'single' | 'ensemble'>('single');
  const [modelType, setModelType] = useState('pbt_c512');
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string; available: boolean; reason?: string; protocol?: string; weightSource?: string; members?: Array<{ file: string; seed: number; sha256: string }> }>>([]);
  useEffect(() => {
    api.get('/models/').then(response => setModelOptions(response.data.map((item: any) => ({ value: item.id, label: item.label, available: item.available, reason: item.reason, protocol: item.protocol, weightSource: item.weight_source, members: item.members })))).catch(() => message.error('模型目录加载失败，请刷新重试'));
  }, []);
  const frozenProtocol = ['pbt_c512', 'pbt_c384', 'hrnet_w48', 'mask2former_swin_t'].includes(modelType) && predictionMode === 'single';

  const [advancedParams, setAdvancedParams] = useState({
    confidenceThreshold: 0.5,
    usePostProcessing: true,
    useTTA: false,
    minArea: 100,
    morphKernelSize: 5,
    morphIterations: 1,
    overlayOpacity: 0.3,
    stage1Confidence: 0.25,
    stage2Confidence: 0.25,
    roiPadding: 0.1,
    fallbackRoiPadding: 0.7,
    expectedCount: 0,
    stageBoxIou: 0.5,
    patchSize: [512, 512] as [number, number],
    stride: [256, 256] as [number, number],
  });
  useEffect(() => {
    if (frozenProtocol) setAdvancedParams(previous => ({ ...previous, confidenceThreshold: .5, stage1Confidence: .5, stage2Confidence: .5, usePostProcessing: false, useTTA: false, minArea: 0 }));
  }, [frozenProtocol, modelType]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  useEffect(() => { void setImageSearchQuery(searchQuery); }, [searchQuery, selectedFolder]);
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  useEffect(() => { void setImageOrdering(`${sortOrder === 'desc' ? '-' : ''}${sortBy === 'date' ? 'created_at' : sortBy}`); }, [sortBy, sortOrder]);
  const [folderQuery, setFolderQuery] = useState('');
  const [expandedFolderKeys, setExpandedFolderKeys] = useState<React.Key[]>([]);
  const [taskName, setTaskName] = useState(() => `${t('prediction.task_name')}-${new Date().toLocaleString()}`);
  const folderTreeRef = useRef<HTMLDivElement | null>(null);
  // 同步的提交锁：state 更新是异步的，连点时三次点击会读到同一个 loading=false
  const submittingRef = useRef(false);

  const childrenByParentId = useMemo(() => {
    const map = new Map<string | null, any[]>();
    for (const f of folders) {
      const pid =
        f.parent === null || f.parent === undefined || f.parent === ''
          ? null
          : String(f.parent);
      const arr = map.get(pid) ?? [];
      arr.push(f);
      map.set(pid, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }
    return map;
  }, [folders]);

  const folderTreeData = useMemo(() => {
    const build = (parentId: string | null): any[] => {
      const items = childrenByParentId.get(parentId) ?? [];
      return items.flatMap((f: any) => {
        const id = String(f.id);
        const children = build(id);
        if (folderQuery.trim() && !String(f.name).toLowerCase().includes(folderQuery.trim().toLowerCase()) && !children.length) return [];
        return [{
          key: id,
          name: f.name,
          count: f.imageCount ?? 0,
          title: `${f.name} (${f.imageCount ?? 0})`,
          children,
        }];
      });
    };
    return [
      {
        key: ALL_NODE_VALUE,
        name: t('images.all_images'),
        count: selectedFolder === null ? totalImages : undefined,
        title: `${t('images.all_images')} (${imagesLoading && images.length === 0 ? '...' : (totalImages || images.length)})`,
      },
      {
        key: UNCATEGORIZED_NODE_VALUE,
        name: t('images.uncategorized'),
        count: selectedFolder === 'uncategorized' || selectedFolder === 'root' ? totalImages : undefined,
        title: `${t('images.uncategorized')} (${imagesLoading && images.length === 0 ? '...' : images.filter(img => !img.folderId).length})`,
      },
      ...build(null),
    ];
  }, [ALL_NODE_VALUE, UNCATEGORIZED_NODE_VALUE, childrenByParentId, folderQuery, images, imagesLoading, selectedFolder, t, totalImages]);

  const selectedFolderTreeKeys = useMemo(() => {
    if (selectedFolder === null) return [ALL_NODE_VALUE];
    if (selectedFolder === 'uncategorized' || selectedFolder === 'root') return [UNCATEGORIZED_NODE_VALUE];
    return [selectedFolder];
  }, [ALL_NODE_VALUE, UNCATEGORIZED_NODE_VALUE, selectedFolder]);

  useEffect(() => {
    const treeRoot = folderTreeRef.current;
    if (!treeRoot) return;

    const syncHiddenTreeInput = () => {
      const hiddenInput = treeRoot.querySelector<HTMLInputElement>('input[aria-label="for screen reader"]');
      if (!hiddenInput) return;
      if (!hiddenInput.id) {
        hiddenInput.id = 'prediction-folder-tree-a11y';
      }
      if (!hiddenInput.name) {
        hiddenInput.name = 'prediction-folder-tree-a11y';
      }
    };

    syncHiddenTreeInput();

    let attempts = 0;
    const timer = window.setInterval(() => {
      syncHiddenTreeInput();
      attempts += 1;
      if (attempts >= 6) {
        window.clearInterval(timer);
      }
    }, 300);

    return () => window.clearInterval(timer);
  }, [selectedFolderTreeKeys, folderTreeData]);

  const selectedFolderAndDescendants = useMemo(() => {
    if (!selectedFolder || selectedFolder === 'uncategorized') return null;
    const seen = new Set<string>();
    const queue: string[] = [selectedFolder];
    while (queue.length) {
      const current = queue.shift() as string;
      if (seen.has(current)) continue;
      seen.add(current);
      const children = childrenByParentId.get(current) ?? [];
      for (const child of children) {
        const id = String(child.id);
        if (!seen.has(id)) queue.push(id);
      }
    }
    return seen;
  }, [childrenByParentId, selectedFolder]);

  const filteredImages = useMemo(() => {
    let imgs = images;
    if (selectedFolder === 'uncategorized' || selectedFolder === 'root') {
      imgs = imgs.filter(img => !img.folderId);
    } else if (selectedFolder) {
      const allowed = selectedFolderAndDescendants;
      if (allowed) {
        imgs = imgs.filter(img => !!img.folderId && allowed.has(String(img.folderId)));
      } else {
        imgs = imgs.filter(img => img.folderId === selectedFolder);
      }
    }
    if (searchQuery.trim()) {
      imgs = imgs.filter(img => img.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    imgs = [...imgs].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'date') cmp = new Date(a.uploadDate || a.created_time || '').getTime() - new Date(b.uploadDate || b.created_time || '').getTime();
      else if (sortBy === 'size') cmp = (a.size ?? 0) - (b.size ?? 0);
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return imgs;
  }, [images, selectedFolder, selectedFolderAndDescendants, searchQuery, sortBy, sortOrder]);

  const handleItemSelect = (itemId: string, isSelected: boolean) => {
    if (isSelected) {
      setSelectedItems([...selectedItems, itemId]);
    } else {
      setSelectedItems(selectedItems.filter(id => id !== itemId));
    }
  };

  const buildTaskPayload = (selectionType: 'images' | 'folders', items: string[], imageCount: number) => ({
    name: taskName,
    imageCount,
    modelType: predictionMode === 'ensemble' ? 'ensemble' : modelType,
    predictionMode,
    batchSize,
    confidence: advancedParams.confidenceThreshold,
    selectedItems: items,
    selectionType,
    parameters: { ...advancedParams, predictionMode, use_ensemble: predictionMode === 'ensemble' },
    single_model_type: predictionMode === 'ensemble' ? 'ensemble' : modelType
  });

  // 当前在文件夹树中选中的真实文件夹（“全部图片”“未分类”不支持一键提交）
  const selectedRealFolder = selectedFolder && selectedFolder !== 'uncategorized'
    ? folders.find(f => String(f.id) === selectedFolder) ?? null
    : null;

  const folderOnlySelection = Boolean(selectedRealFolder) && selectedItems.length === 0;
  const folderImageCount = selectedRealFolder?.imageCount ?? 0;
  const summaryImageCount = folderOnlySelection ? folderImageCount : selectedItems.length;
  const submitTask = async (payload: any) => {
    if (submittingRef.current) return;
    if (!taskName.trim()) { setError('请输入任务名称'); return; }
    submittingRef.current = true; setLoading(true); setError(null);
    try {
      const created = await createTask({ ...payload, name: taskName.trim() });
      updateWorkspace({ selectedIds: [] }); setSelectedItems([]);
      message.success(t('prediction.task_created'));
      if (created?.id) navigate(`/tasks?task=${created.id}`);
    } catch (caught: any) {
      const detail = getApiErrorMessage(caught, t('prediction.create_task_failed'));
      setError(detail); message.error(detail);
    } finally { submittingRef.current = false; setLoading(false); }
  };
  const handleStartFolderPrediction = () => {
    if (selectedRealFolder && selectedFolderAndDescendants) void submitTask(buildTaskPayload('folders', Array.from(selectedFolderAndDescendants), folderImageCount));
  };
  const handleStartPrediction = () => {
    if (folderOnlySelection) { handleStartFolderPrediction(); return; }
    if (!selectedItems.length) return;
    void submitTask(buildTaskPayload('images', selectedItems, selectedItems.length));
  };
  const chooseFolder = (key: string) => {
    setSelectedFolder(key === ALL_NODE_VALUE ? null : key === UNCATEGORIZED_NODE_VALUE ? 'uncategorized' : key);
  };
  const pageSelected = filteredImages.length > 0 && filteredImages.every(image => selectedItems.includes(image.id));

  return (
    <div className="prediction-workbench h-full min-h-0 p-3 sm:p-4">
      <div className="prediction-columns grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="选择图片" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-white">
          <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
            <h2 className="section-title mr-auto inline-flex items-center gap-2"><ImageIcon className="h-4 w-4 text-brand-fill" />选择图片</h2>
            {selectedRealFolder && <span className="max-w-[40%] truncate text-xs text-muted" title={selectedRealFolder.name}>{selectedRealFolder.name}</span>}
            <span className="text-xs tabular-nums text-muted">{selectedItems.length ? `已选 ${selectedItems.length} 张` : `${totalImages} 张`}</span>
            {selectedItems.length > 0 && <button onClick={() => setSelectedItems([])} className="text-xs text-accent-text">清空选择</button>}
          </header>
          <div className="flex min-h-0 flex-1">
            <aside ref={folderTreeRef} className="hidden w-[170px] shrink-0 overflow-y-auto border-r border-hairline p-2 sm:block">
              <p className="mb-2 flex items-center gap-2 px-2 py-2 text-xs font-medium text-muted"><FolderOpen className="h-3.5 w-3.5" />文件夹</p>
              <input type="search" aria-label="搜索文件夹" placeholder="搜索文件夹" value={folderQuery} onChange={e => setFolderQuery(e.target.value)} className="mb-2 h-8 w-full rounded-md border border-hairline px-2 text-xs outline-none focus:border-accent-line" />
              <Tree className="folder-tree prediction-folder-tree" treeData={folderTreeData} selectedKeys={selectedFolderTreeKeys} expandedKeys={folderQuery.trim() ? folders.map(folder => folder.id) : expandedFolderKeys} onExpand={keys => setExpandedFolderKeys(keys)} blockNode
                titleRender={(node: any) => <span className="flex min-w-0 items-center justify-between gap-2"><span className="truncate">{node.name ?? node.title}</span>{node.count !== undefined && <span className="text-xs tabular-nums opacity-60">{node.count}</span>}</span>}
                onSelect={keys => { if (keys[0]) chooseFolder(String(keys[0])); }} />
            </aside>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline p-3">
                <div className="relative min-w-[120px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input id="prediction-search-images" name="prediction-search-images" type="search" placeholder={t('images.search')} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="h-9 w-full rounded-lg border border-hairline bg-surface-muted pl-9 pr-3 text-sm outline-none focus:border-accent-line" /></div>
                <select aria-label={t('a11y.sort_by')} value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="h-9 max-w-[140px] rounded-lg bg-transparent px-2 text-xs text-ink-secondary"><option value="date">{t('images.sort.date')}</option><option value="name">{t('images.sort.name')}</option><option value="size">{t('images.sort.size')}</option></select>
                <button onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')} aria-label={t('a11y.sort_order')} className="rounded-lg p-2 text-muted hover:bg-surface-muted">{sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />}</button>
                <button onClick={() => setSelectedItems(pageSelected ? selectedItems.filter(id => !filteredImages.some(image => image.id === id)) : [...new Set([...selectedItems, ...filteredImages.map(image => image.id)])])} aria-pressed={pageSelected} className="h-9 rounded-lg border border-hairline px-3 text-xs text-accent-text">{pageSelected ? '取消本页' : `全选本页 (${filteredImages.length})`}</button>
                <select aria-label="选择文件夹" className="h-9 w-full rounded-lg border border-hairline bg-white px-2 text-sm sm:hidden" value={selectedFolderTreeKeys[0]} onChange={e => chooseFolder(e.target.value)}><option value={ALL_NODE_VALUE}>{t('images.all_images')}</option><option value={UNCATEGORIZED_NODE_VALUE}>{t('images.uncategorized')}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
              </div>
              <div className="prediction-image-scroll min-h-0 flex-1 overflow-y-auto p-3">
                {imagesLoading ? <div className="flex h-40 items-center justify-center text-sm text-muted">加载中…</div> : !filteredImages.length ? <div className="flex h-40 items-center justify-center text-sm text-muted">没有匹配的图片</div> : <div className="grid grid-cols-1 gap-2 min-[1200px]:grid-cols-2 2xl:grid-cols-3">
                  {filteredImages.map(image => <label key={image.id} className={`flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${selectedItems.includes(image.id) ? 'border-accent-line bg-surface-muted' : 'border-hairline hover:bg-surface-muted'}`}>
                    <input name={`prediction-image-${image.id}`} aria-label={`选择 ${image.name}`} type="checkbox" checked={selectedItems.includes(image.id)} onChange={e => handleItemSelect(image.id, e.target.checked)} className="h-4 w-4 shrink-0 accent-[#245b45]" />
                    <img src={image.preview_url || image.image_url || image.url} alt={image.name} loading="lazy" className="h-16 w-16 shrink-0 rounded-lg bg-surface-muted object-cover" />
                    <div className="min-w-0"><p className="truncate text-sm font-medium text-ink" title={image.name}>{image.name}</p><ImageResolutionLabel width={image.pixel_width} height={image.pixel_height} /></div>
                  </label>)}
                </div>}
              </div>
              <WorkspacePagination page={imagesPage} pageSize={imagesPageSize} total={totalImages} onChange={(page, size) => void goToImagesPage(page, size)} />
            </div>
          </div>
        </section>

        <aside aria-label="任务配置" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-white">
          <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-5 py-3"><SlidersHorizontal className="h-4 w-4 text-brand-fill" /><h2 className="section-title">{t('prediction.configuration')}</h2></header>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <div><label htmlFor="prediction-task-name" className="mb-2 block text-xs font-medium text-ink-secondary">{t('prediction.task_name')}</label><input id="prediction-task-name" name="prediction-task-name" value={taskName} onChange={e => setTaskName(e.target.value)} maxLength={50} className="h-10 w-full rounded-lg border border-hairline px-3 text-sm outline-none focus:border-accent-line" /></div>
            <div><label htmlFor="prediction-mode" className="mb-2 block text-xs font-medium text-ink-secondary">{t('prediction.prediction_mode')}</label><div className="flex rounded-lg bg-surface-muted p-1">{(['single','ensemble'] as const).map(mode => <button key={mode} id={mode === 'single' ? 'prediction-mode' : undefined} aria-pressed={predictionMode === mode} onClick={() => setPredictionMode(mode)} className={`flex-1 rounded-md py-2 text-xs ${predictionMode === mode ? 'bg-white font-medium text-ink shadow-sm' : 'text-muted'}`}>{mode === 'single' ? t('prediction.mode.single') : '投票模型'}</button>)}</div></div>
            <div><label htmlFor="prediction-model-type" className="mb-2 block text-xs font-medium text-ink-secondary">{t('prediction.model')}</label><select id="prediction-model-type" name="prediction-model-type" disabled={predictionMode === 'ensemble'} value={predictionMode === 'ensemble' ? 'ensemble' : modelType} onChange={e => setModelType(e.target.value)} className="h-10 w-full rounded-lg border border-hairline bg-white px-2 text-xs disabled:bg-surface-muted">{predictionMode === 'ensemble' && <option value="ensemble">DeepLab-R101 + M6 投票</option>}{modelOptions.filter(option => option.value !== 'ensemble').map(option => <option key={option.value} value={option.value} disabled={!option.available}>{option.label}{!option.available ? ` · ${option.reason}` : ''}</option>)}</select>
              {predictionMode === 'single' && <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">版本与权重</summary><p className="mt-2">{modelOptions.find(item => item.value === modelType)?.weightSource}</p>{modelOptions.find(item => item.value === modelType)?.members?.map(member => <p key={member.file} className="mt-1 break-all" title={member.sha256}>{member.file} · {member.sha256.slice(0,12)}</p>)}</details>}
            </div>
            {!frozenProtocol && <div><div className="mb-2 flex justify-between text-xs"><label htmlFor="prediction-confidence-threshold">{t('prediction.confidence_threshold')}</label><span className="tabular-nums text-muted">{advancedParams.confidenceThreshold.toFixed(2)}</span></div><input id="prediction-confidence-threshold" type="range" disabled={frozenProtocol} min="0.1" max="1" step="0.1" value={advancedParams.confidenceThreshold} onChange={e => setAdvancedParams(previous => ({...previous, confidenceThreshold:Number(e.target.value)}))} className="w-full accent-[#245b45]" /></div>}
            <button onClick={() => setShowAdvanced(true)} className="flex items-center gap-2 text-sm text-accent-text"><SlidersHorizontal className="h-4 w-4" />更多参数</button>
              <Modal title="更多参数" open={showAdvanced} onCancel={() => setShowAdvanced(false)} footer={null} width={640} styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}>
                {frozenProtocol && <div className="flex items-center justify-between border-b border-hairline pb-3 text-sm"><span>推理协议</span><span className="font-medium">冻结版本</span></div>}
                <fieldset hidden={frozenProtocol} className="space-y-4">
                  {/* Model parameters */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="flex items-center">
                        <input
                          name="prediction-use-post-processing"
                          type="checkbox"
                          checked={advancedParams.usePostProcessing}
                          onChange={(e) => setAdvancedParams(prev => ({ ...prev, usePostProcessing: e.target.checked }))}
                          className="mr-2 w-4 h-4 text-accent-text rounded border-hairline-strong"
                        />
                        <span className="text-xs  text-ink-secondary">{t('prediction.post_processing')}</span>
                      </label>
                      <label className="flex items-center mt-2">
                        <input
                          name="prediction-use-tta"
                          type="checkbox"
                          checked={advancedParams.useTTA}
                          onChange={(e) => setAdvancedParams(prev => ({ ...prev, useTTA: e.target.checked }))}
                          className="mr-2 w-4 h-4 text-accent-text rounded border-hairline-strong"
                        />
                        <span className="text-xs  text-ink-secondary">{t('prediction.tta')}</span>
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-min-area" className="text-xs  font-medium text-ink-secondary">{t('prediction.min_area')}</label>
                        <span className="text-xs  text-muted">{advancedParams.minArea}</span>
                      </div>
                      <input
                        id="prediction-min-area"
                        name="prediction-min-area"
                        type="range"
                        min="10"
                        max="1000"
                        step="10"
                        value={advancedParams.minArea}
                        onChange={(e) => setAdvancedParams(prev => ({ ...prev, minArea: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-surface-sunken rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-morph-kernel" className="text-xs  font-medium text-ink-secondary">{t('prediction.morph_kernel')}</label>
                        <span className="text-xs  text-muted">{advancedParams.morphKernelSize}</span>
                      </div>
                      <input
                        id="prediction-morph-kernel"
                        name="prediction-morph-kernel"
                        type="range"
                        min="1"
                        max="15"
                        step="2"
                        value={advancedParams.morphKernelSize}
                        onChange={(e) => setAdvancedParams(prev => ({ ...prev, morphKernelSize: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-surface-sunken rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-morph-iterations" className="text-xs  font-medium text-ink-secondary">{t('prediction.morph_iterations')}</label>
                        <span className="text-xs  text-muted">{advancedParams.morphIterations}</span>
                      </div>
                      <input
                        id="prediction-morph-iterations"
                        name="prediction-morph-iterations"
                        type="range"
                        min="0"
                        max="10"
                        step="1"
                        value={advancedParams.morphIterations}
                        onChange={(e) => setAdvancedParams(prev => ({ ...prev, morphIterations: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-surface-sunken rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-overlay-opacity" className="text-xs  font-medium text-ink-secondary">{t('prediction.overlay_opacity')}</label>
                        <span className="text-xs  text-muted">{advancedParams.overlayOpacity}</span>
                      </div>
                      <input
                        id="prediction-overlay-opacity"
                        name="prediction-overlay-opacity"
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.05"
                        value={advancedParams.overlayOpacity}
                        onChange={(e) => setAdvancedParams(prev => ({ ...prev, overlayOpacity: parseFloat(e.target.value) }))}
                        className="w-full h-2 bg-surface-sunken rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div className="sm:col-span-2 pt-2 border-t border-hairline">
                      <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                        {t('prediction.two_stage_advanced')}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-stage1-confidence" className="text-xs  font-medium text-ink-secondary">{t('prediction.stage1_confidence')}</label>
                        <span className="text-xs  text-muted">{advancedParams.stage1Confidence.toFixed(2)}</span>
                      </div>
                      <input
                        id="prediction-stage1-confidence"
                        name="prediction-stage1-confidence"
                        type="range"
                        min="0.05"
                        max="1"
                        step="0.01"
                        value={advancedParams.stage1Confidence}
                        onChange={(e) => setAdvancedParams(prev => ({ ...prev, stage1Confidence: parseFloat(e.target.value) }))}
                        className="w-full h-2 bg-surface-sunken rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-stage2-confidence" className="text-xs  font-medium text-ink-secondary">{t('prediction.stage2_confidence')}</label>
                        <span className="text-xs  text-muted">{advancedParams.stage2Confidence.toFixed(2)}</span>
                      </div>
                      <input
                        id="prediction-stage2-confidence"
                        name="prediction-stage2-confidence"
                        type="range"
                        min="0.05"
                        max="1"
                        step="0.01"
                        value={advancedParams.stage2Confidence}
                        onChange={(e) => setAdvancedParams(prev => ({ ...prev, stage2Confidence: parseFloat(e.target.value) }))}
                        className="w-full h-2 bg-surface-sunken rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-roi-padding" className="text-xs  font-medium text-ink-secondary">{t('prediction.roi_padding')}</label>
                        <span className="text-xs  text-muted">{advancedParams.roiPadding.toFixed(2)}</span>
                      </div>
                      <input
                        id="prediction-roi-padding"
                        name="prediction-roi-padding"
                        type="range"
                        min="0"
                        max="0.4"
                        step="0.02"
                        value={advancedParams.roiPadding}
                        onChange={(e) => setAdvancedParams(prev => ({ ...prev, roiPadding: parseFloat(e.target.value) }))}
                        className="w-full h-2 bg-surface-sunken rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-fallback-roi-padding" className="text-xs  font-medium text-ink-secondary">{t('prediction.fallback_roi_padding')}</label>
                        <span className="text-xs  text-muted">{advancedParams.fallbackRoiPadding.toFixed(2)}</span>
                      </div>
                      <input
                        id="prediction-fallback-roi-padding"
                        name="prediction-fallback-roi-padding"
                        type="range"
                        min="0.1"
                        max="1"
                        step="0.05"
                        value={advancedParams.fallbackRoiPadding}
                        onChange={(e) => setAdvancedParams(prev => ({ ...prev, fallbackRoiPadding: parseFloat(e.target.value) }))}
                        className="w-full h-2 bg-surface-sunken rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-expected-count" className="text-xs  font-medium text-ink-secondary">{t('prediction.expected_count')}</label>
                        <span className="text-xs  text-muted">{advancedParams.expectedCount || '自动'}</span>
                      </div>
                      <input
                        id="prediction-expected-count"
                        name="prediction-expected-count"
                        type="range"
                        min="0"
                        max="6"
                        step="1"
                        value={advancedParams.expectedCount}
                        onChange={(e) => setAdvancedParams(prev => ({ ...prev, expectedCount: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-surface-sunken rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-stage-box-iou" className="text-xs  font-medium text-ink-secondary">{t('prediction.stage_box_iou')}</label>
                        <span className="text-xs  text-muted">{advancedParams.stageBoxIou.toFixed(2)}</span>
                      </div>
                      <input
                        id="prediction-stage-box-iou"
                        name="prediction-stage-box-iou"
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.05"
                        value={advancedParams.stageBoxIou}
                        onChange={(e) => setAdvancedParams(prev => ({ ...prev, stageBoxIou: parseFloat(e.target.value) }))}
                        className="w-full h-2 bg-surface-sunken rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    {(modelType === 'm6_best' || predictionMode === 'ensemble') && (
                      <>
                        <div className="sm:col-span-2 pt-2 border-t border-hairline">
                          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                            {t('prediction.m6_advanced')}
                          </p>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label htmlFor="prediction-patch-size" className="text-xs  font-medium text-ink-secondary">{t('prediction.patch_size')}</label>
                            <span className="text-xs  text-muted">{advancedParams.patchSize[0]}</span>
                          </div>
                          <input
                            id="prediction-patch-size"
                            name="prediction-patch-size"
                            type="range"
                            min="256"
                            max="1024"
                            step="64"
                            value={advancedParams.patchSize[0]}
                            onChange={(e) => {
                              const value = parseInt(e.target.value);
                              setAdvancedParams(prev => ({ ...prev, patchSize: [value, value] as [number, number] }));
                            }}
                            className="w-full h-2 bg-surface-sunken rounded-lg appearance-none cursor-pointer"
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label htmlFor="prediction-stride" className="text-xs  font-medium text-ink-secondary">{t('prediction.stride')}</label>
                            <span className="text-xs  text-muted">{advancedParams.stride[0]}</span>
                          </div>
                          <input
                            id="prediction-stride"
                            name="prediction-stride"
                            type="range"
                            min="128"
                            max="512"
                            step="32"
                            value={advancedParams.stride[0]}
                            onChange={(e) => {
                              const value = parseInt(e.target.value);
                              setAdvancedParams(prev => ({ ...prev, stride: [value, value] as [number, number] }));
                            }}
                            className="w-full h-2 bg-surface-sunken rounded-lg appearance-none cursor-pointer"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </fieldset>
              </Modal>
          </div>
          <footer className="shrink-0 border-t border-hairline bg-surface-muted p-4">
            <div className="mb-3 flex items-center justify-between gap-2 text-xs"><span className="min-w-0 truncate text-muted">{folderOnlySelection ? `整夹 · ${selectedRealFolder?.name}` : '已选择'}</span><strong className="shrink-0 tabular-nums">{summaryImageCount} 张</strong></div>
            {error && <p role="alert" className="mb-3 text-xs text-danger-text">{error}</p>}
            <button onClick={handleStartPrediction} disabled={!summaryImageCount || loading} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-fill text-sm font-medium text-white transition hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:opacity-40"><Play className="h-4 w-4" />{loading ? '正在创建…' : t('prediction.create_task')}</button>
            {selectedRealFolder && selectedItems.length > 0 && <button onClick={handleStartFolderPrediction} disabled={loading || !folderImageCount} className="mt-2 w-full py-1 text-xs text-accent-text">{t('prediction.submit_folder', {name:selectedRealFolder.name,count:folderImageCount})}</button>}
          </footer>
        </aside>
      </div>
    </div>
  );
};

export default PredictionModule;
