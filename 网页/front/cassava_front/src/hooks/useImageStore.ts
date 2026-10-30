import { message } from '../utils/feedback';
import { useWorkspace, updateWorkspace, workspaceStorageKey, getWorkspace } from '../utils/workspaceContext';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Image, Folder } from '../types';
import { imagesApi, foldersApi, systemSettingsApi } from '../services/api';

import i18n from '../i18n';

export const useImageStore = (isGuest: boolean = false) => {
  const DEFAULT_IMAGE_PAGE_SIZE = isGuest ? 36 : 48;
  const [images, setImages] = useState<Image[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const workspace = useWorkspace();
  const selectedImages = workspace.selectedIds;
  const setSelectedImages = (value: string[] | ((previous: string[]) => string[])) => updateWorkspace({ selectedIds: typeof value === 'function' ? value(workspace.selectedIds) : value });
  const selectedFolder = workspace.folder;
  const setSelectedFolder = (value: string | null) => updateWorkspace({ folder: value, selectedIds: [] });
  const readPage = () => { try { return JSON.parse(sessionStorage.getItem(workspaceStorageKey('image-page')) || '{}'); } catch { return {}; } };

  const [loading, setLoading] = useState(true);
  const [imagesPage, setImagesPage] = useState(() => readPage().page || 1);
  const [imagesPageSize, setImagesPageSize] = useState(DEFAULT_IMAGE_PAGE_SIZE);
  const [hasMoreImages, setHasMoreImages] = useState(false);
  const [loadingMoreImages, setLoadingMoreImages] = useState(false);
  const [totalImages, setTotalImages] = useState(0);

  const [maxDisplayImages, setMaxDisplayImages] = useState(200);
  const initializedRef = useRef(false);
  const requestSequence = useRef(0);
  const imagesRef = useRef<Image[]>([]);
  const maxDisplayImagesRef = useRef(maxDisplayImages);
  const imageQueryRef = useRef<{ search: string; ordering: string }>({ search: '', ordering: '-created_at' });
  const loadImagesRef = useRef<(options?: { reset?: boolean; max?: number; page_size?: number; page?: number; search?: string; ordering?: string }) => Promise<Image[]>>(async () => []);
  const loadFoldersRef = useRef<(sourceImages?: Image[]) => Promise<void>>(async () => undefined);
  const getPageSize = (maxValue?: number) => Math.min(DEFAULT_IMAGE_PAGE_SIZE, Math.max(1, maxValue ?? maxDisplayImages));

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('folder');
    if (value && (/^\d+$/.test(value) || ['root', 'uncategorized'].includes(value))) setSelectedFolder(value);
  }, []);
  useEffect(() => {
    if (!['/images', '/prediction'].includes(window.location.pathname)) return;
    const url = new URL(window.location.href);
    if (selectedFolder) url.searchParams.set('folder', selectedFolder); else url.searchParams.delete('folder');
    window.history.replaceState(window.history.state, '', url);
  }, [selectedFolder]);
  const getFolderFilter = () => {
    if (selectedFolder === 'uncategorized' || selectedFolder === 'root') {
      return 'uncategorized';
    }

    if (selectedFolder && /^\d+$/.test(selectedFolder)) {
      return selectedFolder;
    }

    return undefined;
  };

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    maxDisplayImagesRef.current = maxDisplayImages;
  }, [maxDisplayImages]);

  useEffect(() => {
    const init = async () => {
      let desiredMax = maxDisplayImagesRef.current;
      try {
        const s = isGuest ? await systemSettingsApi.getPublic() : await systemSettingsApi.get();
        const n = Number(s.maxDisplayImages);
        if (Number.isFinite(n) && n > 0) desiredMax = Math.min(1000, Math.floor(n));
        setMaxDisplayImages(desiredMax);
      } catch (e) {
        void e;
      }
      setMaxDisplayImages(desiredMax);
      await Promise.all([
        loadImagesRef.current({ reset: true, max: desiredMax }),
        loadFoldersRef.current(),
      ]);
      initializedRef.current = true;
    };
    initializedRef.current = false;
    void init();
  }, [isGuest]);

  useEffect(() => {
    if (!initializedRef.current) return;
    if (selectedFolder === 'shared_with_me' || selectedFolder === 'my_shares') return;
    void loadImagesRef.current({ reset: true });
  }, [selectedFolder]);

  useEffect(() => {
    if (isGuest) return;
    const handler = async () => {
      try {
        const s = await systemSettingsApi.get();
        const n = Number(s.maxDisplayImages);
        if (Number.isFinite(n) && n > 0) {
          const desiredMax = Math.min(1000, Math.floor(n));
          setMaxDisplayImages(desiredMax);
          await loadImagesRef.current({ reset: true, max: desiredMax, ...readPage() });
        }
      } catch (e) {
        void e;
      }
    };
    window.addEventListener('systemSettings:updated', handler as any);
    return () => window.removeEventListener('systemSettings:updated', handler as any);
  }, [isGuest]);

  const refresh = async (options?: { images?: boolean; folders?: boolean }) => {
    const refreshImages = options?.images !== false;
    const refreshFolders = options?.folders !== false;
    const tasks: Promise<any>[] = [];
    if (refreshImages) tasks.push(loadImages({ reset: true, page: imagesPage }));
    if (refreshFolders) tasks.push(loadFolders());
    await Promise.all(tasks);
  };

  const loadImages = async (options?: { reset?: boolean; max?: number; page_size?: number; page?: number; append?: boolean; search?: string; ordering?: string }): Promise<Image[]> => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    try {
      if (options?.search !== undefined || options?.ordering !== undefined) {
        imageQueryRef.current = {
          search: options?.search ?? imageQueryRef.current.search,
          ordering: options?.ordering ?? imageQueryRef.current.ordering,
        };
      }
      const localMax = options?.max !== undefined ? options.max : maxDisplayImages;
      const localPageSize = Math.min(
        localMax,
        options?.page_size !== undefined ? options.page_size : getPageSize(localMax)
      );
      const reset = options?.reset !== false;
      const page = options?.page ?? (reset ? 1 : imagesPage);
      const folderFilter = getFolderFilter();
      const res = await imagesApi.getAll({
        page,
        page_size: localPageSize,
        ...(folderFilter ? { folder: folderFilter } : {}),
        ...(imageQueryRef.current.search ? { search: imageQueryRef.current.search } : {}),
        ordering: imageQueryRef.current.ordering,
      });
      if (requestId !== requestSequence.current) return res.items;
      const nextHasMore = res.next !== undefined ? Boolean(res.next) : res.items.length >= localPageSize;
      const merged = options?.append ? [...imagesRef.current, ...res.items] : res.items;
      const limited = merged.slice(0, localMax);
      setImages(limited);
      setImagesPage(page);
      sessionStorage.setItem(workspaceStorageKey('image-page'), JSON.stringify({ page, page_size: localPageSize, ...imageQueryRef.current }));
      setImagesPageSize(localPageSize);
      setHasMoreImages(nextHasMore && limited.length < localMax);
      if (typeof res.count === 'number') setTotalImages(res.count);
      const data = limited;
      return data;
    } catch (error: any) {
      if (requestId !== requestSequence.current) return [];
      if (error?.response?.status === 404 && (options?.page ?? imagesPage) > 1) {
        return await loadImages({ ...options, page: 1 });
      }
      console.error(error);
      if (!isGuest) {
        message.error(i18n.t('images.load_images_failed'));
      } else {
        console.warn('Failed to load guest images', error);
      }
      return [];
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  };

  /** 跳转到指定页（真实分页，不再累积到 200 张上限后截断） */
  const goToImagesPage = async (page: number, pageSize?: number) => {
    const target = Math.max(1, Math.floor(page) || 1);
    setLoadingMoreImages(true);
    try {
      await loadImages({ reset: true, page: target, page_size: pageSize ?? imagesPageSize });
    } finally {
      setLoadingMoreImages(false);
    }
  };

  const setImageSearchQuery = async (search: string, ordering?: string) => {
    // 搜索/排序变化时回到第 1 页，同时保留用户选定的每页条数
    await loadImages({
      reset: true,
      page: 1,
      search,
      ordering: ordering ?? imageQueryRef.current.ordering,
      page_size: imagesPageSize,
    });
  };

  const setImageOrdering = async (ordering: string) => {
    await loadImages({ reset: true, page: 1, ordering, page_size: imagesPageSize });
  };

  const loadMoreImages = async () => {
    if (loadingMoreImages) return;
    if (!hasMoreImages) return;
    const prevLen = images.length;
    if (prevLen >= maxDisplayImages) {
      setHasMoreImages(false);
      return;
    }
    setLoadingMoreImages(true);
    try {
      const page = imagesPage + 1;
      const pageSize = imagesPageSize;
      const folderFilter = getFolderFilter();
      const res = await imagesApi.getAll({
        page,
        page_size: pageSize,
        ...(folderFilter ? { folder: folderFilter } : {}),
        ...(imageQueryRef.current.search ? { search: imageQueryRef.current.search } : {}),
        ordering: imageQueryRef.current.ordering,
      });
      const nextHasMore = res.next !== undefined ? Boolean(res.next) : res.items.length >= pageSize;
      setImages(prev => [...prev, ...res.items].slice(0, maxDisplayImages));
      setImagesPage(page);
      const newLen = Math.min(prevLen + res.items.length, maxDisplayImages);
      setHasMoreImages(nextHasMore && newLen < maxDisplayImages);
    } catch (error) {
      console.error(error);
      message.error(i18n.t('images.load_images_failed'));
    } finally {
      setLoadingMoreImages(false);
    }
  };

  const loadFolders = async (sourceImages?: Image[]) => {
    try {
      let data;
      if (isGuest) {
        const first = await foldersApi.getAll({ page: 1, page_size: 1000 });
        data = first.items;
      } else {
        const first = await foldersApi.getAll({ page: 1, page_size: 1000 });
        data = first.items;
        if (first.next) {
          let page = 2;
          let next: string | null | undefined = first.next;
          while (next) {
            const res = await foldersApi.getAll({ page, page_size: 1000 });
            data = [...data, ...res.items];
            next = res.next;
            page += 1;
          }
        }
      }

      const fallbackImages = sourceImages ?? images;
      if ((!data || data.length === 0) && fallbackImages.length > 0) {
        const inferredMap = new Map<string, Folder>();
        fallbackImages.forEach((image) => {
          const folderId = image.folderId ? String(image.folderId) : null;
          if (!folderId) {
            return;
          }

          const current = inferredMap.get(folderId);
          inferredMap.set(folderId, {
            id: folderId,
            name: current?.name || `Folder ${folderId}`,
            imageCount: (current?.imageCount || 0) + 1,
            parent: undefined,
            createdDate: current?.createdDate || ''
          });
        });
        data = Array.from(inferredMap.values());
      }

      const remembered = getWorkspace();
      const available = new Set((data || []).map((folder: Folder) => String(folder.id)));
      if (remembered.folder && /^\d+$/.test(remembered.folder) && !available.has(remembered.folder)) updateWorkspace({ folder: 'root', lastWritableFolder: null, selectedIds: [] });
      else if (remembered.lastWritableFolder && !available.has(remembered.lastWritableFolder)) updateWorkspace({ lastWritableFolder: null });
      setFolders(data);
    } catch (error) {
      console.error(error);
      if (!isGuest) {
        message.error(i18n.t('images.load_folders_failed'));
      }
    }
  };

  loadImagesRef.current = loadImages;
  loadFoldersRef.current = loadFolders;

  const loadImageDetail = useCallback(async (id: string) => {
    const existing = imagesRef.current.find((img) => img.id === id);
    if (existing?.image_url) {
      return existing;
    }

    const detail = await imagesApi.getById(id);
    setImages((prev) =>
      prev.map((img) => (img.id === detail.id ? { ...img, ...detail } : img))
    );
    return existing ? { ...existing, ...detail } : detail;
  }, []);

  const uploadImages = async (
    files: File[],
    folderId?: string|null,
    checkDuplicate?: boolean,
    options?: { onProgress?: (completed: number, total: number, batch: number, batchTotal: number) => void; batchSize?: number }
  ) => {
    // 检查是否有重复文件
    let duplicateFiles: string[] = [];
    const nonDuplicateFiles: File[] = [];
    
    for (const file of files) {
      // 检查是否已存在同名文件（只与当前已加载的图片比较，后端仍会做一次去重）
      const existingImage = images.find(img => img.name === file.name);
      if (existingImage) {
        duplicateFiles.push(file.name);
      } else {
        nonDuplicateFiles.push(file);
      }
    }

    let successCount = 0;
    let processedCount = 0;
    const batchSize = Math.max(1, options?.batchSize ?? 10);
    const totalBatches = Math.ceil(nonDuplicateFiles.length / batchSize);

    // 分批上传：每批最多 batchSize 张，便于展示进度、降低单次请求失败的影响面
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
      const batchFiles = nonDuplicateFiles.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
      const formData = new FormData();
      batchFiles.forEach(file => {
        formData.append('files', file);
      });
      if (folderId) formData.append('folder_id', folderId);
      if (checkDuplicate !== undefined) formData.append('check_duplicate', checkDuplicate ? '1' : '0');

      try {
        const res = await imagesApi.uploadFiles(formData);
        const uploaded = Array.isArray(res) ? res : res.results || [];
        const lowImages = uploaded.filter((image: Image) => image.resolution?.low_resolution === true);
        if (lowImages.length) message.warning({ content: `已上传 ${lowImages.length} 张低分辨率图片：${lowImages.slice(0, 3).map((image: Image) => image.name).join('、')}${lowImages.length > 3 ? '等' : ''}。可能遗漏细小病斑，建议使用相机原图。`, duration: 8 });

        if (res.duplicates && res.duplicates.length > 0) {
             duplicateFiles = duplicateFiles.concat(res.duplicates);
             if (res.uploaded_count) {
                 successCount += res.uploaded_count;
             }
        } else if (Array.isArray(res)) {
            successCount += res.length;
        } else if (res.uploaded_count) {
            successCount += res.uploaded_count;
        } else {
            successCount += batchFiles.length;
        }
      } catch (err: any) {
        console.error(`上传文件失败:`, err);
        if (err.response && err.response.data && err.response.data.duplicates) {
            duplicateFiles = duplicateFiles.concat(err.response.data.duplicates);
        } else {
          // 单批失败不再中断整批上传，记录后继续下一批
          message.error(
            i18n.t('images.upload_batch_failed', {
              start: batchIndex * batchSize + 1,
              end: batchIndex * batchSize + batchFiles.length,
              defaultValue: '第 {{start}}-{{end}} 张上传失败，已跳过',
            })
          );
        }
      }
      processedCount += batchFiles.length;
      options?.onProgress?.(processedCount, nonDuplicateFiles.length, batchIndex + 1, totalBatches);
    }

    if (successCount > 0) {
      await refresh();
      message.success(i18n.t('images.upload_success', { count: successCount }));
    }
    
    if (successCount > 0) {
      await refresh();
      message.success(i18n.t('images.upload_success', { count: successCount }));
    }
    
    // 如果有重复文件，抛出异常供组件处理
    if (duplicateFiles.length > 0) {
      throw { type: 'duplicate', files: duplicateFiles };
    }
    
    return successCount;
  };

  const uploadFromZip = async (zipFile: File, folderId?: string|null, checkDuplicate?: boolean) => {
    try {
      const formData = new FormData();
      formData.append('file', zipFile);
      if (folderId) formData.append('folder_id', folderId);
      if (checkDuplicate !== undefined) formData.append('check_duplicate', checkDuplicate ? '1' : '0');
      const result = await imagesApi.uploadBatch(formData);
      if (result.resolution_warnings?.length) message.warning({ content: `ZIP内有 ${result.resolution_warnings.length} 张低分辨率图片，已上传并添加标签，建议使用相机原图。`, duration: 8 });
      message.success(i18n.t('images.upload_success', { count: result.count }));
      setTimeout(() => {
        refresh();
      }, 1000);
    } catch (error) {
      message.error(i18n.t('images.upload_zip_failed'));
      console.error(error);
    }
  };

  const deleteImages = async (ids: string[]) => {
    const settled = await Promise.allSettled(ids.map(id => imagesApi.delete(id)));
    const failures = ids.filter((_, index) => settled[index].status === 'rejected');
    await refresh(); setSelectedImages(failures);
    if (failures.length) message.warning(`已移入回收站 ${ids.length - failures.length} 张，${failures.length} 张失败，已保留选中`);
    else message.success('已移入回收站，历史预测与修订保留');
    return failures;
  };

  const updateImage = async (id: string, data: any) => {
    try {
      await imagesApi.update(id, data);
      await refresh();
      message.success(i18n.t('images.update_success'));
    } catch (error) {
      message.error(i18n.t('images.update_failed'));
      console.error(error);
      throw error;
    }
  };

  const moveImages = async (imageIds: string[], folderId: string) => {
    const result = await foldersApi.addImages(folderId, imageIds);
    await refresh();
    const failedIds = (result.failed_ids || []).map(String);
    setSelectedImages(failedIds);
    if (failedIds.length) message.warning(`已移动 ${result.updated} 张，${failedIds.length} 张未移动`);
    else message.success(`已移动 ${result.updated} 张`);
    return result;
  };

  const getFilteredImages = () => {
    if (!Array.isArray(images)) return [];
    if (selectedFolder === null) return images;
    if (selectedFolder === 'uncategorized' || selectedFolder === 'root') return images.filter(img => !img.folderId);
    return images.filter(img => img.folderId === selectedFolder);
  };

  return {
    images,
    folders,
    selectedImages,
    selectedFolder,
    loading,
    hasMoreImages,
    loadingMoreImages,
    totalImages,
    setSelectedImages,
    setSelectedFolder,
    loadImages,
    loadMoreImages,
    goToImagesPage,
    setImageSearchQuery,
    setImageOrdering,
    imagesPage,
    imagesPageSize,
    loadFolders,
    refresh,
    uploadImages,
    uploadFromZip,
    deleteImages,
    updateImage,
    moveImages,
    getFilteredImages,
    loadImageDetail,
  };
};
