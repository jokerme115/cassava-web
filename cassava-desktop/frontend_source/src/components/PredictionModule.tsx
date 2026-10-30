import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Play, Settings, Image as ImageIcon, FolderOpen, Zap, Search, SortAsc, SortDesc } from 'lucide-react';
import { useImageStore } from '../hooks/useImageStore';
import { useTaskStore } from '../hooks/useTaskStore';
import { message, Tree } from 'antd';
import { useTranslation } from 'react-i18next';
import { notificationService } from '../services/notification';
import { imagesApi } from '../services/api';

const PredictionModule: React.FC = () => {
  const { t } = useTranslation();
  const {
    images,
    folders,
    loading: imagesLoading,
    hasMoreImages,
    loadingMoreImages,
    loadMoreImages,
    totalImagesCount,
  } = useImageStore();
  const { createTask } = useTaskStore();
  const ALL_NODE_VALUE = '__all__';
  const UNCATEGORIZED_NODE_VALUE = '__uncategorized__';
  
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const selectionType = 'images';
  const batchSize = 32;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [modelType, setModelType] = useState('yolo_m6_best');
  const [useGpu, setUseGpu] = useState(true); // GPU enabled by default
  const modelOptions = [
    { value: 'yolo_m6_best', label: 'YOLO + M6 Best', description: t('prediction.models.yolo_m6_best') },
    { value: 'yolo_resnet101', label: 'YOLO + DeepLabV3+ ResNet-101', description: t('prediction.models.yolo_resnet101') },
  ];
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
    expectedCount: 3,
    stageBoxIou: 0.5,
    patchSize: [512, 512] as [number, number],
    stride: [256, 256] as [number, number],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectingAllImages, setSelectingAllImages] = useState(false);

  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [taskName, setTaskName] = useState(() => `${t('prediction.task_name')}-${new Date().toLocaleString()}`);
  const [showNameModal, setShowNameModal] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<any>(null);
  const folderTreeRef = useRef<HTMLDivElement | null>(null);

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
          title: `${f.name} (${f.imageCount ?? 0})`,
          children: build(id),
        };
      });
    };
    return [
      {
        key: ALL_NODE_VALUE,
        title: `${t('images.all_images')} (${imagesLoading && images.length === 0 ? '...' : totalImagesCount || images.length})`,
      },
      {
        key: UNCATEGORIZED_NODE_VALUE,
        title: `${t('images.uncategorized')} (${imagesLoading && images.length === 0 ? '...' : images.filter(img => !img.folderId).length})`,
      },
      ...build(null),
    ];
  }, [ALL_NODE_VALUE, UNCATEGORIZED_NODE_VALUE, childrenByParentId, images, imagesLoading, t, totalImagesCount]);

  const selectedFolderTreeKeys = useMemo(() => {
    if (selectedFolder === null) return [ALL_NODE_VALUE];
    if (selectedFolder === 'uncategorized') return [UNCATEGORIZED_NODE_VALUE];
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

  const matchesCurrentImageFilter = useCallback((img: any) => {
    if (selectedFolder === 'uncategorized') {
      if (img.folderId) return false;
    } else if (selectedFolder) {
      const allowed = selectedFolderAndDescendants;
      if (allowed) {
        if (!img.folderId || !allowed.has(String(img.folderId))) return false;
      } else if (img.folderId !== selectedFolder) {
        return false;
      }
    }
    if (searchQuery.trim()) {
      return img.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  }, [searchQuery, selectedFolder, selectedFolderAndDescendants]);

  const filteredImages = useMemo(() => {
    let imgs = images.filter(matchesCurrentImageFilter);
    imgs = [...imgs].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'date') cmp = new Date(a.uploadDate || a.created_time || '').getTime() - new Date(b.uploadDate || b.created_time || '').getTime();
      else if (sortBy === 'size') cmp = (a.size ?? 0) - (b.size ?? 0);
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return imgs;
  }, [images, matchesCurrentImageFilter, sortBy, sortOrder]);

  const allVisibleImagesSelected = filteredImages.length > 0 && filteredImages.every(img => selectedItems.includes(img.id));
  const selectableImageCount = useMemo(() => {
    if (searchQuery.trim()) {
      return allVisibleImagesSelected && selectedItems.length > filteredImages.length
        ? selectedItems.length
        : filteredImages.length;
    }
    if (selectedFolder === null) {
      return totalImagesCount || filteredImages.length;
    }
    if (selectedFolder && selectedFolder !== 'uncategorized') {
      const allowed = selectedFolderAndDescendants ?? new Set([selectedFolder]);
      return folders
        .filter(folder => allowed.has(String(folder.id)))
        .reduce((sum, folder) => sum + (folder.imageCount || 0), 0) || filteredImages.length;
    }
    return filteredImages.length;
  }, [
    allVisibleImagesSelected,
    filteredImages.length,
    folders,
    searchQuery,
    selectedFolder,
    selectedFolderAndDescendants,
    selectedItems.length,
    totalImagesCount,
  ]);
  const allCurrentScopeSelected = allVisibleImagesSelected && selectedItems.length >= selectableImageCount;

  const loadAllFilteredImageIds = async () => {
    const params = selectedFolder === 'uncategorized' ? { folder: 'uncategorized' } : {};
    const res = await imagesApi.getAllPages(params);
    return res.items.filter(matchesCurrentImageFilter).map(img => img.id);
  };

  const handleItemSelect = (itemId: string, isSelected: boolean) => {
    if (isSelected) {
      setSelectedItems([...selectedItems, itemId]);
    } else {
      setSelectedItems(selectedItems.filter(id => id !== itemId));
    }
  };

  const handleSelectAllImages = async () => {
    if (allCurrentScopeSelected) {
      setSelectedItems([]);
      return;
    }

    setSelectingAllImages(true);
    try {
      const allIds = await loadAllFilteredImageIds();
      setSelectedItems(allIds);
    } catch (err) {
      console.error(err);
      message.error(t('images.load_images_failed'));
    } finally {
      setSelectingAllImages(false);
    }
  };

  const handleStartPrediction = async () => {
    if (selectedItems.length === 0) {
      setError(t('prediction.select_items'));
      message.error(t('prediction.select_items'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let imageCount = 0;
      if (selectionType === 'images') {
        imageCount = selectedItems.length;
      } else {
        imageCount = folders.filter(f => selectedItems.includes(f.id)).reduce((acc, folder) => acc + folder.imageCount, 0);
      }
      const payload: any = {
        name: taskName,
        imageCount,
        modelType,
        predictionMode: 'single',
        batchSize,
        confidence: advancedParams.confidenceThreshold,
        selectedItems,
        selectionType,
        parameters: advancedParams,
        single_model_type: modelType,
        use_gpu: useGpu,
      };
      setPendingPayload(payload);
      setShowNameModal(true);
    } catch (_error) {
      setError(t('prediction.create_task_failed'));
      message.error(t('prediction.create_task_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmName = async () => {
    if (!pendingPayload) return;
    const payload = { ...pendingPayload, name: taskName };
    setLoading(true);
    setError(null);
    try {
      await createTask(payload);
      setSelectedItems([]);
      message.success(t('prediction.task_created'));
      // 发送系统通知
      notificationService.notifyTaskComplete(taskName, pendingPayload.imageCount || 0);
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.error || t('prediction.create_task_failed');
      setError(errorMsg);
      message.error(errorMsg);
      notificationService.notifyError(errorMsg);
    } finally {
      setLoading(false);
    }
    setShowNameModal(false);
    setPendingPayload(null);
  };

  const getEstimatedTime = () => {
    const itemCount = selectionType === 'images' 
      ? selectedItems.length 
      : folders.filter(f => selectedItems.includes(f.id)).reduce((acc, folder) => acc + folder.imageCount, 0);
    
    const baseTime = modelType === 'm6_best' ? 1.2 : 2.0;
    return Math.ceil(itemCount * baseTime);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-800 mb-2">{t('navigation.prediction')}</h2>
        <p className="text-gray-600">{t('prediction.description')}</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-4 rounded-xl shadow-lg">
          <div className="flex items-center">
            <ImageIcon className="w-8 h-8 mr-3" />
            <div>
              <p className="text-2xl font-bold">{imagesLoading && images.length === 0 ? '...' : totalImagesCount || images.length}</p>
              <p className="text-green-100">{t('prediction.available_images')}</p>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-4 rounded-xl shadow-lg">
          <div className="flex items-center">
            <FolderOpen className="w-8 h-8 mr-3" />
            <div>
              <p className="text-2xl font-bold">{imagesLoading && folders.length === 0 ? '...' : folders.length}</p>
              <p className="text-blue-100">{t('prediction.folders')}</p>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-r from-purple-500 to-purple-600 text-white p-4 rounded-xl shadow-lg">
          <div className="flex items-center">
            <Brain className="w-8 h-8 mr-3" />
            <div>
              <p className="text-2xl font-bold">{modelOptions.length}</p>
              <p className="text-purple-100">{t('prediction.models_available')}</p>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white p-4 rounded-xl shadow-lg">
          <div className="flex items-center">
            <Zap className="w-8 h-8 mr-3" />
            <div>
              <p className="text-2xl font-bold">{selectedItems.length}</p>
              <p className="text-orange-100">{t('prediction.selected')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* New task name input */}
      <div className="mb-4">
        <label htmlFor="prediction-task-name" className="block text-gray-700 font-medium mb-1">{t('prediction.task_name')}</label>
        <input
          id="prediction-task-name"
          name="prediction-task-name"
          type="text"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent shadow-sm"
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
              <div ref={folderTreeRef} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 h-full">
                <h3 className="font-semibold text-gray-800 mb-3">{t('images.folders')}</h3>
                <div className="border-t border-gray-200 my-2"></div>
                <Tree
                  treeData={folderTreeData}
                  selectedKeys={selectedFolderTreeKeys}
                  defaultExpandAll
                  blockNode
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
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    id="prediction-search-images"
                    name="prediction-search-images"
                    type="text"
                    placeholder={t('images.search')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent w-full text-sm shadow-sm"
                  />
                </div>
                <div className="hidden xs:flex items-center space-x-2">
                  <select
                    id="prediction-sort-by"
                    name="prediction-sort-by"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm shadow-sm"
                  >
                    <option value="date">{t('images.sort.date')}</option>
                    <option value="name">{t('images.sort.name')}</option>
                    <option value="size">{t('images.sort.size')}</option>
                  </select>
                  <button
                    onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                    className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  onClick={handleSelectAllImages}
                  disabled={selectingAllImages}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border text-xs sm:text-sm ${allCurrentScopeSelected ? 'bg-green-600 text-white border-green-600' : 'bg-white text-green-700 border-green-600'} transition-colors disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <span className="hidden xs:inline">{selectingAllImages ? t('common.loading_more') : t('images.select_all', { count: selectableImageCount })}</span>
                  <span className="xs:hidden">{selectingAllImages ? t('common.loading_more') : t('images.select_all', { count: selectableImageCount })}</span>
                </button>
              </div>
              <div className="h-[600px] overflow-y-auto border border-gray-200 rounded-xl bg-white shadow-sm">
                <div className="grid grid-cols-1 xs:grid-cols-2 gap-2 sm:gap-4 p-2 sm:p-4">
                  {filteredImages.map(image => (
                    <label key={image.id} className={`flex items-center p-2 sm:p-3 rounded-lg cursor-pointer transition-all border ${selectedItems.includes(image.id) ? 'bg-green-50 border-green-500 shadow' : 'hover:bg-gray-50 border-gray-200'}`}>
                      <input
                        name={`prediction-image-${image.id}`}
                        type="checkbox"
                        checked={selectedItems.includes(image.id)}
                        onChange={(e) => handleItemSelect(image.id, e.target.checked)}
                        className="mr-2 sm:mr-3 w-4 h-4 text-green-600 rounded border-gray-300"
                      />
                      <img
                        src={image.preview_url || image.image_url || image.url}
                        alt={image.name}
                        className="w-10 h-10 sm:w-12 sm:h-12 object-cover rounded mr-2 sm:mr-3 border"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate text-sm sm:text-base">{image.name}</p>
                        <p className="text-xs sm:text-sm text-gray-500 truncate">{image.format}</p>
                      </div>
                    </label>
                  ))}
                </div>
                {hasMoreImages && (
                  <div className="px-4 pb-4 flex justify-center">
                    <button
                      onClick={() => loadMoreImages()}
                      disabled={loadingMoreImages}
                      className="px-4 py-2 rounded-lg border border-green-600 text-green-700 hover:bg-green-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    >
                      {loadingMoreImages ? t('common.loading_more') : t('common.load_more')}
                    </button>
                  </div>
                )}
                </div>
            </div>
          </div>
        </div>
        {/* Right side: Task Configuration Area */}
        <div className="w-full lg:w-1/3 h-full flex flex-col">
          <div className="flex-1 space-y-6 h-full">
            {/* Model Selection & Config */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 h-full">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('prediction.configuration')}</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="prediction-mode" className="block text-sm font-medium text-gray-700 mb-2">{t('prediction.prediction_mode')}</label>
                <div className="flex bg-gray-100 rounded-lg p-1">
                  <button
                    id="prediction-mode"
                    className={`flex-1 px-2 py-1.5 sm:px-3 sm:py-2 rounded text-xs sm:text-sm transition-colors bg-white shadow-sm text-gray-900`}
                  >{t('prediction.mode.single')}</button>
                </div>
              </div>
              
              <div>
                <label htmlFor="prediction-model-type" className="block text-sm font-medium text-gray-700 mb-2">{t('prediction.model')}</label>
                <select
                  id="prediction-model-type"
                  name="prediction-model-type"
                  value={modelType}
                  onChange={(e) => setModelType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm shadow-sm"
                >
                  {modelOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label} - {option.description}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useGpu}
                    onChange={(e) => setUseGpu(e.target.checked)}
                    className="mr-2 w-4 h-4 text-green-600 rounded border-gray-300"
                  />
                  <span className="text-sm font-medium text-gray-700">{t('settings.gpu.enableGpu')}</span>
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="prediction-confidence-threshold" className="text-xs sm:text-sm font-medium text-gray-700">{t('prediction.confidence_threshold')}</label>
                  <span className="text-xs sm:text-sm text-gray-500">{advancedParams.confidenceThreshold.toFixed(2)}</span>
                </div>
                <input
                  id="prediction-confidence-threshold"
                  name="prediction-confidence-threshold"
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.1"
                  value={advancedParams.confidenceThreshold}
                  onChange={(e) => setAdvancedParams(prev => ({ ...prev, confidenceThreshold: parseFloat(e.target.value) }))}
                  className="w-full h-2 bg-green-200 rounded-lg appearance-none cursor-pointer shadow-sm"
                />
              </div>

              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center text-xs sm:text-sm text-blue-600 hover:text-blue-800"
              >
                <Settings className="w-4 h-4 mr-1" />
                <span className="hidden xs:inline">{showAdvanced ? t('prediction.advanced_settings.hide') : t('prediction.advanced_settings.show')}</span>
                <span className="xs:hidden">{showAdvanced ? t('prediction.advanced_settings.hide_short') : t('prediction.advanced_settings.show_short')}</span>
              </button>

              {showAdvanced && (
                <div className="space-y-4 p-4 bg-gray-50 rounded-xl border">
                  {/* Advanced parameters grouping beautification */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="flex items-center">
                        <input
                          name="prediction-use-post-processing"
                          type="checkbox"
                          checked={advancedParams.usePostProcessing}
                          onChange={(e) => setAdvancedParams(prev => ({ ...prev, usePostProcessing: e.target.checked }))}
                          className="mr-2 w-4 h-4 text-green-600 rounded border-gray-300"
                        />
                        <span className="text-xs sm:text-sm text-gray-700">{t('prediction.post_processing')}</span>
                      </label>
                      <label className="flex items-center mt-2">
                        <input
                          name="prediction-use-tta"
                          type="checkbox"
                          checked={advancedParams.useTTA}
                          onChange={(e) => setAdvancedParams(prev => ({ ...prev, useTTA: e.target.checked }))}
                          className="mr-2 w-4 h-4 text-green-600 rounded border-gray-300"
                        />
                        <span className="text-xs sm:text-sm text-gray-700">{t('prediction.tta')}</span>
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-min-area" className="text-xs sm:text-sm font-medium text-gray-700">{t('prediction.min_area')}</label>
                        <span className="text-xs sm:text-sm text-gray-500">{advancedParams.minArea}</span>
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
                        className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-morph-kernel" className="text-xs sm:text-sm font-medium text-gray-700">{t('prediction.morph_kernel')}</label>
                        <span className="text-xs sm:text-sm text-gray-500">{advancedParams.morphKernelSize}</span>
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
                        className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-morph-iterations" className="text-xs sm:text-sm font-medium text-gray-700">{t('prediction.morph_iterations')}</label>
                        <span className="text-xs sm:text-sm text-gray-500">{advancedParams.morphIterations}</span>
                      </div>
                      <input
                        id="prediction-morph-iterations"
                        name="prediction-morph-iterations"
                        type="range"
                        min="1"
                        max="10"
                        step="1"
                        value={advancedParams.morphIterations}
                        onChange={(e) => setAdvancedParams(prev => ({ ...prev, morphIterations: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-overlay-opacity" className="text-xs sm:text-sm font-medium text-gray-700">{t('prediction.overlay_opacity')}</label>
                        <span className="text-xs sm:text-sm text-gray-500">{advancedParams.overlayOpacity}</span>
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
                        className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div className="sm:col-span-2 pt-2 border-t border-gray-200">
                      <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                        {t('prediction.two_stage_advanced')}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-stage1-confidence" className="text-xs sm:text-sm font-medium text-gray-700">{t('prediction.stage1_confidence')}</label>
                        <span className="text-xs sm:text-sm text-gray-500">{advancedParams.stage1Confidence.toFixed(2)}</span>
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
                        className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-stage2-confidence" className="text-xs sm:text-sm font-medium text-gray-700">{t('prediction.stage2_confidence')}</label>
                        <span className="text-xs sm:text-sm text-gray-500">{advancedParams.stage2Confidence.toFixed(2)}</span>
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
                        className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-roi-padding" className="text-xs sm:text-sm font-medium text-gray-700">{t('prediction.roi_padding')}</label>
                        <span className="text-xs sm:text-sm text-gray-500">{advancedParams.roiPadding.toFixed(2)}</span>
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
                        className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-fallback-roi-padding" className="text-xs sm:text-sm font-medium text-gray-700">{t('prediction.fallback_roi_padding')}</label>
                        <span className="text-xs sm:text-sm text-gray-500">{advancedParams.fallbackRoiPadding.toFixed(2)}</span>
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
                        className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-expected-count" className="text-xs sm:text-sm font-medium text-gray-700">{t('prediction.expected_count')}</label>
                        <span className="text-xs sm:text-sm text-gray-500">{advancedParams.expectedCount}</span>
                      </div>
                      <input
                        id="prediction-expected-count"
                        name="prediction-expected-count"
                        type="range"
                        min="1"
                        max="6"
                        step="1"
                        value={advancedParams.expectedCount}
                        onChange={(e) => setAdvancedParams(prev => ({ ...prev, expectedCount: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="prediction-stage-box-iou" className="text-xs sm:text-sm font-medium text-gray-700">{t('prediction.stage_box_iou')}</label>
                        <span className="text-xs sm:text-sm text-gray-500">{advancedParams.stageBoxIou.toFixed(2)}</span>
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
                        className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    {modelType === 'm6_best' && (
                      <>
                        <div className="sm:col-span-2 pt-2 border-t border-gray-200">
                          <p className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                            {t('prediction.m6_advanced')}
                          </p>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label htmlFor="prediction-patch-size" className="text-xs sm:text-sm font-medium text-gray-700">{t('prediction.patch_size')}</label>
                            <span className="text-xs sm:text-sm text-gray-500">{advancedParams.patchSize[0]}</span>
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
                            className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label htmlFor="prediction-stride" className="text-xs sm:text-sm font-medium text-gray-700">{t('prediction.stride')}</label>
                            <span className="text-xs sm:text-sm text-gray-500">{advancedParams.stride[0]}</span>
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
                            className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Prediction Summary */}
          <div className="bg-gradient-to-br from-green-100 to-green-50 rounded-xl shadow-lg border border-green-200 p-6 flex-1">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('prediction.summary')}</h3>
            
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">{t('prediction.selected_items')}：</span>
                <span className="font-medium">{selectedItems.length} {selectionType === 'images' ? t('prediction.images') : t('folders.title')}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-gray-600">{t('prediction.estimated_images')}：</span>
                <span className="font-medium">
                  {selectionType === 'images' 
                    ? selectedItems.length 
                    : folders.filter(f => selectedItems.includes(f.id)).reduce((acc, folder) => acc + folder.imageCount, 0)
                  } {t('prediction.images')}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-gray-600">{t('prediction.prediction_mode')}：</span>
                <span className="font-medium">{t('prediction.mode.single')}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-gray-600">{t('prediction.selected_model')}：</span>
                  <span className="font-medium">{modelOptions.find(m => m.value === modelType)?.label}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-gray-600">{t('prediction.estimated_time')}：</span>
                <span className="font-medium">{getEstimatedTime()} {t('tasks.seconds')}</span>
              </div>
            </div>

            <button
              onClick={handleStartPrediction}
              disabled={selectedItems.length === 0 || loading}
              className="w-full mt-4 sm:mt-6 flex items-center justify-center px-3 py-2 sm:px-4 sm:py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm sm:text-base"
            >
              {loading ? <span className="animate-spin mr-2"><Play className="w-4 h-4 sm:w-5 sm:h-5" /></span> : <Play className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />}
              {t('prediction.create_task')}
            </button>
            {error && <div className="mt-3 text-red-500 text-sm">{error}</div>}
            </div>
          </div>
        </div>
      </div>
      {/* Task Name Modal */}
      {showNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black bg-opacity-40" onClick={() => setShowNameModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-auto z-10">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">{t('prediction.task_name_prompt')}</h3>
            <input
              id="prediction-task-name-modal"
              name="prediction-task-name-modal"
              type="text"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent shadow-sm mb-4 text-sm sm:text-base"
              value={taskName}
              onChange={e => setTaskName(e.target.value)}
              placeholder={t('prediction.task_name_prompt')}
              maxLength={50}
              autoFocus
            />
            <div className="flex justify-end gap-2 sm:gap-4">
              <button className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 text-sm sm:text-base shadow-sm" onClick={() => setShowNameModal(false)}>{t('prediction.cancel')}</button>
              <button className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 text-sm sm:text-base shadow-sm" onClick={handleConfirmName}>{t('prediction.confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PredictionModule;
