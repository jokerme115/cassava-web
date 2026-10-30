import { message } from '../utils/feedback';
import api from '../services/rest/client';
import { getWorkspace, updateWorkspace } from '../utils/workspaceContext';
import { useNavigate } from 'react-router-dom';
import ImageResolutionLabel from './ImageResolutionLabel';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Play, Image as ImageIcon, FolderOpen, Zap, Search, SortAsc, SortDesc, SlidersHorizontal } from 'lucide-react';
import PageHeader from './PageHeader';
import { useImageStore } from '../hooks/useImageStore';
import { useTaskStore } from '../hooks/useTaskStore';
import { Tree, Pagination } from 'antd';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../utils/apiError';

const PredictionModule: React.FC<{ currentUser?: any }> = ({ currentUser }) => {
  const { t } = useTranslation();
  const {
    images,
    folders,
    loading: imagesLoading,
    totalImages,
    selectedFolder, setSelectedFolder, setImageSearchQuery, goToImagesPage, imagesPage, imagesPageSize,
  } = useImageStore(Boolean(currentUser?.is_guest));
  const { createTask } = useTaskStore();
  const ALL_NODE_VALUE = '__all__';
  const UNCATEGORIZED_NODE_VALUE = '__uncategorized__';
  
  const [selectedItems, setSelectedItems] = useState<string[]>(() => getWorkspace().selectedIds);
  const selectionType = 'images';
  const batchSize = 32;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [predictionMode, setPredictionMode] = useState<'single' | 'ensemble'>('single');
  const [modelType, setModelType] = useState('pbt_c512');
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string; available: boolean; reason?: string; protocol?: string; weightSource?: string; members?: Array<{ file: string; seed: number; sha256: string }> }>>([]);
  useEffect(() => {
    api.get('/models/').then(response => setModelOptions(response.data.map((item: any) => ({ value: item.id, label: item.label, available: item.available, reason: item.reason, protocol: item.protocol, weightSource: item.weight_source, members: item.members })))).catch(() => message.error('模型目录加载失败，请刷新重试'));
  }, []);
  const frozenProtocol = ['pbt_c512', 'pbt_c384', 'hrnet_w48', 'mask2former_swin_t'].includes(modelType) && predictionMode === 'single';
  // Monitor language changes, update model descriptions
  useEffect(() => {
  }, [t]);

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
  const [taskName, setTaskName] = useState(() => `${t('prediction.task_name')}-${new Date().toLocaleString()}`);
  const [showNameModal, setShowNameModal] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<any>(null);
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
      return items.map((f: any) => {
        const id = String(f.id);
        return {
          key: id,
          name: f.name,
          count: f.imageCount ?? 0,
          title: `${f.name} (${f.imageCount ?? 0})`,
          children: build(id),
        };
      });
    };
    return [
      {
        key: ALL_NODE_VALUE,
        name: t('images.all_images'),
        count: imagesLoading && images.length === 0 ? '...' : (totalImages || images.length),
        title: `${t('images.all_images')} (${imagesLoading && images.length === 0 ? '...' : (totalImages || images.length)})`,
      },
      {
        key: UNCATEGORIZED_NODE_VALUE,
        name: t('images.uncategorized'),
        count: imagesLoading && images.length === 0 ? '...' : images.filter(img => !img.folderId).length,
        title: `${t('images.uncategorized')} (${imagesLoading && images.length === 0 ? '...' : images.filter(img => !img.folderId).length})`,
      },
      ...build(null),
    ];
  }, [ALL_NODE_VALUE, UNCATEGORIZED_NODE_VALUE, childrenByParentId, images, imagesLoading, t, totalImages]);

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

  // 一键提交：把选中文件夹及其子文件夹整体交给后端展开，避免前端只拿到已分页的图片
  const handleStartFolderPrediction = () => {
    if (!selectedRealFolder || !selectedFolderAndDescendants) return;
    setPendingPayload(
      buildTaskPayload('folders', Array.from(selectedFolderAndDescendants), selectedRealFolder.imageCount ?? 0)
    );
    setShowNameModal(true);
  };

  // 只选了文件夹、还没勾选单张图片时，摘要按“整个文件夹”计数并允许直接创建任务
  const folderOnlySelection = Boolean(selectedRealFolder) && selectedItems.length === 0;
  const summaryItemCount = folderOnlySelection ? 1 : selectedItems.length;
  const summaryImageCount = folderOnlySelection
    ? (selectedRealFolder?.imageCount ?? 0)
    : selectionType === 'images'
      ? selectedItems.length
      : folders.filter(f => selectedItems.includes(f.id)).reduce((acc, folder) => acc + folder.imageCount, 0);

  const handleStartPrediction = async () => {
    if (folderOnlySelection) {
      handleStartFolderPrediction();
      return;
    }
    if (selectedItems.length === 0) {
      setError(t('prediction.select_items'));
      message.error(t('prediction.select_items'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setPendingPayload(buildTaskPayload('images', selectedItems, selectedItems.length));
      setShowNameModal(true);
    } catch {
      setError(t('prediction.create_task_failed'));
      message.error(t('prediction.create_task_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmName = async () => {
    // 连点保护：用 ref 而不是 state，state 异步更新拦不住同一帧内的多次点击
    if (submittingRef.current || !pendingPayload) return;
    submittingRef.current = true;
    const payload = { ...pendingPayload, name: taskName };
    setLoading(true);
    setError(null);
    try {
      const created = await createTask(payload);
      updateWorkspace({ selectedIds: [] });
      if (created?.id) navigate(`/tasks?task=${created.id}`);
      if (payload.selectionType === 'images') {
        setSelectedItems([]);
      }
      message.success(t('prediction.task_created'));
    } catch (error: any) {
      const errorMsg = getApiErrorMessage(error, t('prediction.create_task_failed'));
      setError(errorMsg);
      message.error(errorMsg);
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
    setShowNameModal(false);
    setPendingPayload(null);
  };

  const getEstimatedTime = () => {
    const itemCount = summaryImageCount;
    
    const baseTime = predictionMode === 'ensemble' ? 1.5 : modelType === 'm6_best' ? 1.2 : 0.3;
    return Math.ceil(itemCount * baseTime);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="card mb-4 rounded-[16px] px-5 py-4">
        <PageHeader title={t('navigation.prediction')} subtitle={t('prediction.subtitle')} />
      </div>

      {/* Quick Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card flex items-center gap-3 rounded-[16px] p-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[rgba(10,132,255,0.08)] text-brand-fill-hover">
            <ImageIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xl font-semibold leading-tight text-ink">{imagesLoading && images.length === 0 ? '...' : (totalImages || images.length)}</p>
            <p className="truncate text-xs text-muted">{t('prediction.available_images')}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 rounded-[16px] p-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[rgba(10,132,255,0.08)] text-brand-fill-hover">
            <FolderOpen className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xl font-semibold leading-tight text-ink">{imagesLoading && folders.length === 0 ? '...' : folders.length}</p>
            <p className="truncate text-xs text-muted">{t('prediction.folders')}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 rounded-[16px] p-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[rgba(10,132,255,0.08)] text-brand-fill-hover">
            <Brain className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xl font-semibold leading-tight text-ink">{modelOptions.filter(item => item.available).length}</p>
            <p className="truncate text-xs text-muted">{t('prediction.models_available')}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 rounded-[16px] p-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[rgba(10,132,255,0.08)] text-brand-fill-hover">
            <Zap className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xl font-semibold leading-tight text-ink">{summaryImageCount}</p>
            <p className="truncate text-xs text-muted">{t('prediction.selected')}</p>
          </div>
        </div>
      </div>

      {/* New task name input */}
      <div className="mb-4">
        <label htmlFor="prediction-task-name" className="mb-1.5 block text-[13px] font-medium text-ink-secondary">{t('prediction.task_name')}</label>
        <input
          id="prediction-task-name"
          name="prediction-task-name"
          type="text"
          className="w-full max-w-[440px] rounded-[12px] border border-hairline-strong bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-accent-line focus:ring-2 focus:ring-[rgba(10,132,255,0.10)]"
          value={taskName}
          onChange={e => setTaskName(e.target.value)}
          placeholder={t('prediction.task_name_prompt')}
          maxLength={50}
        />
      </div>

      {/* Change main content area from grid to flex for left-right layout */}
      <div className="flex flex-col lg:flex-row gap-4 sm:gap-8">
        {/* Left: Folder + Image Selection Area */}
        <div className="w-full lg:w-2/3">
          <div className="flex h-full">
            {/* Folder Sidebar */}
            <div className="hidden sm:block w-48 mr-4 h-full">
              <div ref={folderTreeRef} className="card rounded-lg shadow-sm p-4 h-full">
                <h3 className="font-semibold text-ink mb-3">{t('images.folders')}</h3>
                <div className="border-t border-hairline my-2"></div>
                <Tree
                  className="folder-tree"
                  treeData={folderTreeData}
                  selectedKeys={selectedFolderTreeKeys}
                  defaultExpandAll
                  blockNode
                  titleRender={(node: any) => (
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate">{node.name ?? node.title}</span>
                      <span className="shrink-0 rounded-full bg-black/5 px-1.5 text-xs tabular-nums text-current">{node.count}</span>
                    </span>
                  )}
                  onSelect={(keys) => {
                    const k = keys?.[0] ? String(keys[0]) : null;
                    if (!k) return;
                    if (k === ALL_NODE_VALUE) setSelectedFolder(null);
                    else if (k === UNCATEGORIZED_NODE_VALUE) setSelectedFolder('uncategorized');
                    else setSelectedFolder(k);
                  }}
                />
              </div>
            </div>
            {/* 图片选择主面板 */}
            <div className="flex-1 h-full">
              <div className="flex flex-wrap items-center mb-4 space-x-2 sm:space-x-4 gap-2">
                <div className="relative max-w-md flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted w-4 h-4" />
                  <input
                    id="prediction-search-images"
                    name="prediction-search-images"
                    type="text"
                    placeholder={t('images.search')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2 border border-hairline-strong rounded-lg focus:ring-2 focus:ring-accent-line focus:border-transparent w-full text-sm"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1 rounded-lg border border-hairline bg-surface-muted p-1">
                  <select
                    id="prediction-sort-by"
                    name="prediction-sort-by"
                    aria-label={t('a11y.sort_by')}
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="rounded-lg border border-hairline-strong px-2 py-1.5 text-sm transition-all duration-200 focus:border-transparent focus:ring-2 focus:ring-accent-line"
                  >
                    <option value="date">{t('images.sort.date')}</option>
                    <option value="name">{t('images.sort.name')}</option>
                    <option value="size">{t('images.sort.size')}</option>
                  </select>
                  <button
                    onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                    aria-label={t('a11y.sort_order')}
                    className="rounded-lg border border-hairline-strong p-2 transition-all duration-200 hover:border-accent-line hover:text-accent-text"
                  >
                    {sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  onClick={() => {
                    if (selectedItems.length === filteredImages.length) {
                    setSelectedItems([]);
                    } else {
                      setSelectedItems(filteredImages.map(img => img.id));
                    }
                  }}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border text-xs sm:text-sm ${selectedItems.length === filteredImages.length && filteredImages.length > 0 ? 'bg-brand-fill text-white border-accent-line' : 'bg-white text-accent-text border-accent-line'} transition-colors`}
                >
                  <span className="hidden xs:inline">{t('images.select_all', { count: filteredImages.length })}</span>
                  <span className="xs:hidden">{t('images.select_all', { count: filteredImages.length })}</span>
                </button>
                {selectedRealFolder && (
                  <button
                    type="button"
                    onClick={handleStartFolderPrediction}
                    disabled={loading || !selectedRealFolder.imageCount}
                    className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-brand-fill text-white text-xs sm:text-sm hover:bg-brand-fill-hover disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('prediction.submit_folder', { name: selectedRealFolder.name, count: selectedRealFolder.imageCount ?? 0 })}
                  </button>
                )}
              </div>
              <div className="h-[600px] overflow-y-auto border border-hairline rounded-lg bg-white">
                <div className="grid grid-cols-1 xs:grid-cols-2 gap-2 sm:gap-4 p-2 sm:p-4">
                  {filteredImages.map(image => (
                    <label key={image.id} className={`flex items-center p-2 sm:p-3 rounded-lg cursor-pointer transition-all border ${selectedItems.includes(image.id) ? 'bg-[rgba(10,132,255,0.10)] border-accent-line shadow' : 'hover:bg-white border-hairline'}`}>
                      <input
                        name={`prediction-image-${image.id}`}
                        type="checkbox"
                        checked={selectedItems.includes(image.id)}
                        onChange={(e) => handleItemSelect(image.id, e.target.checked)}
                        className="mr-2 sm:mr-3 w-4 h-4 text-accent-text rounded border-hairline-strong"
                      />
                      <img
                        src={image.preview_url || image.image_url || image.url}
                        alt={image.name}
                        className="w-10 h-10 sm:w-12 sm:h-12 object-cover rounded mr-2 sm:mr-3 border"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-ink truncate text-sm sm:text-base">{image.name}</p>
                        <ImageResolutionLabel width={image.pixel_width} height={image.pixel_height} />
                        <p className="text-xs sm:text-sm text-muted truncate">{image.format}</p>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="p-4"><Pagination current={imagesPage} total={totalImages} pageSize={imagesPageSize} onChange={(page) => void goToImagesPage(page)} showSizeChanger={false} size="small" /></div>
                </div>
            </div>
          </div>
        </div>
        {/* Right side: Task Configuration Area */}
        <div className="w-full lg:w-1/3 h-full flex flex-col">
          <div className="flex-1 space-y-6 h-full">
            {/* Model Selection & Config */}
            <div className="card rounded-lg shadow-lg border p-6 h-full">
            <h3 className="text-lg font-semibold text-ink mb-4">{t('prediction.configuration')}</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="prediction-mode" className="block text-sm font-medium text-ink-secondary mb-2">{t('prediction.prediction_mode')}</label>
                <div className="flex bg-surface-sunken rounded-lg p-1">
                  {(['single', 'ensemble'] as const).map(mode => (
                    <button key={mode} id={mode === 'single' ? 'prediction-mode' : undefined}
                      type="button" aria-pressed={predictionMode === mode}
                      onClick={() => setPredictionMode(mode)}
                      className={`flex-1 px-2 py-1.5 sm:px-3 sm:py-2 rounded text-xs sm:text-sm transition-colors ${predictionMode === mode ? 'bg-white shadow-sm text-ink' : 'text-muted'}`}>
                      {mode === 'single' ? t('prediction.mode.single') : '投票模型'}
                    </button>
                  ))}
                </div>
              </div>
              
              <div>
                <label htmlFor="prediction-model-type" className="block text-sm font-medium text-ink-secondary mb-2">{t('prediction.model')}</label>
                <select
                  id="prediction-model-type"
                  name="prediction-model-type"
                  disabled={predictionMode === 'ensemble'}
                  value={predictionMode === 'ensemble' ? 'ensemble' : modelType}
                  onChange={(e) => setModelType(e.target.value)}
                  className="w-full px-2 py-1.5 sm:px-3 sm:py-2 border border-hairline-strong rounded-lg focus:ring-2 focus:ring-accent-line focus:border-transparent text-sm"
                >
                  {predictionMode === 'ensemble' && <option value="ensemble">有监督模型 + 半监督模型（投票）</option>}
                  {modelOptions.map(option => (
                    <option key={option.value} value={option.value} disabled={!option.available}>
                      {option.label}{!option.available ? ` · ${option.reason}` : ''}
                    </option>
                  ))}
                </select>
                {predictionMode === 'single' && <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">版本与权重</summary><p className="mt-2">来源：{modelOptions.find(item => item.value === modelType)?.weightSource || '—'}</p>{modelOptions.find(item => item.value === modelType)?.members?.map(member => <p key={member.file} className="mt-1 break-all" title={member.sha256}>{member.file} · seed{member.seed} · SHA-256 {member.sha256.slice(0, 12)}</p>)}</details>}
                {predictionMode === 'ensemble' && <div className="mt-3 rounded-lg bg-teal-50 p-3 text-sm text-teal-900">
                  <p className="font-medium">有监督模型 + 半监督模型 · 等权投票</p>
                </div>}
              </div>


              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="prediction-confidence-threshold" className="text-xs sm:text-sm font-medium text-ink-secondary">{t('prediction.confidence_threshold')}</label>
                  <span className="text-xs sm:text-sm text-muted">{advancedParams.confidenceThreshold.toFixed(2)}</span>
                </div>
                <input
                  disabled={frozenProtocol}
                  id="prediction-confidence-threshold"
                  name="prediction-confidence-threshold"
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.1"
                  value={advancedParams.confidenceThreshold}
                  onChange={(e) => setAdvancedParams(prev => ({ ...prev, confidenceThreshold: parseFloat(e.target.value) }))}
                  className="w-full h-2 bg-[rgba(10,132,255,0.25)] rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center text-xs sm:text-sm text-accent-text hover:text-blue-800"
              >
                <SlidersHorizontal className="w-4 h-4 mr-1" />
                <span className="hidden xs:inline">{showAdvanced ? t('prediction.advanced_settings.hide') : t('prediction.advanced_settings.show')}</span>
                <span className="xs:hidden">{showAdvanced ? t('prediction.advanced_settings.hide_short') : t('prediction.advanced_settings.show_short')}</span>
              </button>

              {showAdvanced && (
                <fieldset disabled={frozenProtocol} className="space-y-4 p-4 card-soft rounded-lg border disabled:opacity-60">
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
                        <span className="text-xs sm:text-sm text-ink-secondary">{t('prediction.post_processing')}</span>
                      </label>
                      <label className="flex items-center mt-2">
                        <input
                          name="prediction-use-tta"
                          type="checkbox"
                          checked={advancedParams.useTTA}
                          onChange={(e) => setAdvancedParams(prev => ({ ...prev, useTTA: e.target.checked }))}
                          className="mr-2 w-4 h-4 text-accent-text rounded border-hairline-strong"
                        />
                        <span className="text-xs sm:text-sm text-ink-secondary">{t('prediction.tta')}</span>
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-min-area" className="text-xs sm:text-sm font-medium text-ink-secondary">{t('prediction.min_area')}</label>
                        <span className="text-xs sm:text-sm text-muted">{advancedParams.minArea}</span>
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
                        <label htmlFor="prediction-morph-kernel" className="text-xs sm:text-sm font-medium text-ink-secondary">{t('prediction.morph_kernel')}</label>
                        <span className="text-xs sm:text-sm text-muted">{advancedParams.morphKernelSize}</span>
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
                        <label htmlFor="prediction-morph-iterations" className="text-xs sm:text-sm font-medium text-ink-secondary">{t('prediction.morph_iterations')}</label>
                        <span className="text-xs sm:text-sm text-muted">{advancedParams.morphIterations}</span>
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
                        <label htmlFor="prediction-overlay-opacity" className="text-xs sm:text-sm font-medium text-ink-secondary">{t('prediction.overlay_opacity')}</label>
                        <span className="text-xs sm:text-sm text-muted">{advancedParams.overlayOpacity}</span>
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
                        <label htmlFor="prediction-stage1-confidence" className="text-xs sm:text-sm font-medium text-ink-secondary">{t('prediction.stage1_confidence')}</label>
                        <span className="text-xs sm:text-sm text-muted">{advancedParams.stage1Confidence.toFixed(2)}</span>
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
                        <label htmlFor="prediction-stage2-confidence" className="text-xs sm:text-sm font-medium text-ink-secondary">{t('prediction.stage2_confidence')}</label>
                        <span className="text-xs sm:text-sm text-muted">{advancedParams.stage2Confidence.toFixed(2)}</span>
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
                        <label htmlFor="prediction-roi-padding" className="text-xs sm:text-sm font-medium text-ink-secondary">{t('prediction.roi_padding')}</label>
                        <span className="text-xs sm:text-sm text-muted">{advancedParams.roiPadding.toFixed(2)}</span>
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
                        <label htmlFor="prediction-fallback-roi-padding" className="text-xs sm:text-sm font-medium text-ink-secondary">{t('prediction.fallback_roi_padding')}</label>
                        <span className="text-xs sm:text-sm text-muted">{advancedParams.fallbackRoiPadding.toFixed(2)}</span>
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
                        <label htmlFor="prediction-expected-count" className="text-xs sm:text-sm font-medium text-ink-secondary">{t('prediction.expected_count')}</label>
                        <span className="text-xs sm:text-sm text-muted">{advancedParams.expectedCount || '自动'}</span>
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
                        <label htmlFor="prediction-stage-box-iou" className="text-xs sm:text-sm font-medium text-ink-secondary">{t('prediction.stage_box_iou')}</label>
                        <span className="text-xs sm:text-sm text-muted">{advancedParams.stageBoxIou.toFixed(2)}</span>
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
                            <label htmlFor="prediction-patch-size" className="text-xs sm:text-sm font-medium text-ink-secondary">{t('prediction.patch_size')}</label>
                            <span className="text-xs sm:text-sm text-muted">{advancedParams.patchSize[0]}</span>
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
                            <label htmlFor="prediction-stride" className="text-xs sm:text-sm font-medium text-ink-secondary">{t('prediction.stride')}</label>
                            <span className="text-xs sm:text-sm text-muted">{advancedParams.stride[0]}</span>
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
              )}
            </div>
          </div>

          {/* Prediction Summary */}
          <div className="bg-surface-muted rounded-lg shadow-card border border-hairline p-6 flex-1">
            <h3 className="text-lg font-semibold text-ink mb-4">{t('prediction.summary')}</h3>
            
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-secondary">{t('prediction.selected_items')}：</span>
                <span className="font-medium">
                  {folderOnlySelection
                    ? `${selectedRealFolder?.name}（${t('prediction.folder_whole')}）`
                    : `${summaryItemCount} ${selectionType === 'images' ? t('prediction.images') : t('folders.title')}`}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-ink-secondary">{t('prediction.estimated_images')}：</span>
                <span className="font-medium">{summaryImageCount}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-ink-secondary">{t('prediction.estimated_time')}：</span>
                <span className="font-medium">{getEstimatedTime()} {t('tasks.seconds')}</span>
              </div>
            </div>

            <button
              onClick={handleStartPrediction}
              disabled={(summaryItemCount === 0 && !folderOnlySelection) || loading}
              title={(summaryItemCount === 0 && !folderOnlySelection) ? t('prediction.select_hint') : undefined}
              className="w-full mt-4 sm:mt-6 flex items-center justify-center px-3 py-2 sm:px-4 sm:py-3 bg-brand-fill text-white rounded-lg hover:bg-brand-fill-hover disabled:bg-[#c8ccd2] disabled:cursor-not-allowed transition-colors text-sm sm:text-base"
            >
              {loading ? <span className="animate-spin mr-2"><Play className="w-4 h-4 sm:w-5 sm:h-5" /></span> : <Play className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />}
              {t('prediction.create_task')}
            </button>
            {(summaryItemCount === 0 && !folderOnlySelection) && (
              <p className="mt-2 text-center text-xs text-muted">{t('prediction.select_hint')}</p>
            )}
            {error && <div className="mt-3 text-red-500 text-sm">{error}</div>}
            </div>
          </div>
        </div>
      </div>
      {/* Task Name Modal */}
      {showNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-[rgba(15,23,42,0.28)]" onClick={() => setShowNameModal(false)} />
          <div className="relative card rounded-lg shadow-xl p-6 w-full max-w-md mx-auto z-10">
            <h3 className="text-lg font-semibold mb-4 text-ink">{t('prediction.task_name_prompt')}</h3>
            <input
              id="prediction-task-name-modal"
              name="prediction-task-name-modal"
              type="text"
              className="w-full border rounded px-2 py-1.5 sm:px-3 sm:py-2 focus:outline-none focus:ring-2 focus:ring-accent-line mb-4 text-sm sm:text-base"
              value={taskName}
              onChange={e => setTaskName(e.target.value)}
              placeholder={t('prediction.task_name_prompt')}
              maxLength={50}
              autoFocus
            />
            <div className="flex justify-end gap-2 sm:gap-4">
              <button className="px-3 py-1.5 sm:px-4 sm:py-2 rounded bg-surface-sunken text-ink-secondary hover:bg-gray-200 text-sm sm:text-base" onClick={() => setShowNameModal(false)}>{t('prediction.cancel')}</button>
              <button className="px-3 py-1.5 sm:px-4 sm:py-2 rounded bg-brand-fill text-white hover:bg-brand-fill-hover disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base" onClick={handleConfirmName} disabled={loading}>{t('prediction.confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PredictionModule;
