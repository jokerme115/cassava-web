import { useState, useEffect, useRef, useCallback } from 'react';
import { Image, Folder } from '../types';
import { imagesApi, foldersApi, systemSettingsApi } from '../services/api';
import { message } from 'antd';
import i18n from '../i18n';

export const useImageStore = (isGuest: boolean = false) => {
  const DEFAULT_IMAGE_PAGE_SIZE = isGuest ? 36 : 48;
  const [images, setImages] = useState<Image[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [imagesPage, setImagesPage] = useState(1);
  const [hasMoreImages, setHasMoreImages] = useState(false);
  const [loadingMoreImages, setLoadingMoreImages] = useState(false);

  const [maxDisplayImages, setMaxDisplayImages] = useState(200);
  const initializedRef = useRef(false);
  const imagesRef = useRef<Image[]>([]);
  const maxDisplayImagesRef = useRef(maxDisplayImages);
  const loadImagesRef = useRef<(options?: { reset?: boolean; max?: number; page_size?: number }) => Promise<Image[]>>(async () => []);
  const loadFoldersRef = useRef<(sourceImages?: Image[]) => Promise<void>>(async () => undefined);
  const getPageSize = (maxValue?: number) => Math.min(DEFAULT_IMAGE_PAGE_SIZE, Math.max(1, maxValue ?? maxDisplayImages));

  const getFolderFilter = () => {
    if (selectedFolder === 'uncategorized') {
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
      if (!isGuest) {
        try {
          const s = await systemSettingsApi.get();
          const n = Number(s.maxDisplayImages);
          if (Number.isFinite(n) && n > 0) desiredMax = Math.min(1000, Math.floor(n));
          setMaxDisplayImages(desiredMax);
        } catch (e) {
          void e;
        }
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
          await loadImagesRef.current({ reset: true, max: desiredMax });
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
    if (refreshImages) tasks.push(loadImages({ reset: true }));
    if (refreshFolders) tasks.push(loadFolders());
    await Promise.all(tasks);
  };

  const loadImages = async (options?: { reset?: boolean; max?: number; page_size?: number }) => {
    setLoading(true);
    try {
      const localMax = options?.max !== undefined ? options.max : maxDisplayImages;
      const localPageSize = Math.min(
        localMax,
        options?.page_size !== undefined ? options.page_size : getPageSize(localMax)
      );
      const reset = options?.reset !== false;
      const page = reset ? 1 : imagesPage;
      const folderFilter = getFolderFilter();
      const res = await imagesApi.getAll({
        page,
        page_size: localPageSize,
        ...(folderFilter ? { folder: folderFilter } : {}),
      });
      const nextHasMore = res.next !== undefined ? Boolean(res.next) : res.items.length >= localPageSize;
      const limited = res.items.slice(0, localMax);
      setImages(limited);
      setImagesPage(page);
      setHasMoreImages(nextHasMore && limited.length < localMax);
      const data = limited;
      return data;
    } catch (error) {
      console.error(error);
      if (!isGuest) {
        message.error(i18n.t('images.load_images_failed'));
      } else {
        console.warn('Failed to load guest images', error);
      }
      return [];
    } finally {
      setLoading(false);
    }
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
      const nextPage = imagesPage + 1;
      const pageSize = getPageSize();
      const folderFilter = getFolderFilter();
      const res = await imagesApi.getAll({
        page: nextPage,
        page_size: pageSize,
        ...(folderFilter ? { folder: folderFilter } : {}),
      });
      const nextHasMore = res.next !== undefined ? Boolean(res.next) : res.items.length >= pageSize;
      setImages(prev => [...prev, ...res.items].slice(0, maxDisplayImages));
      setImagesPage(nextPage);
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

  const uploadImages = async (files: File[], folderId?: string|null, checkDuplicate?: boolean) => {
    // 检查是否有重复文件
    let duplicateFiles: string[] = [];
    const nonDuplicateFiles: File[] = [];
    
    for (const file of files) {
      // 检查是否已存在同名文件
      const existingImage = images.find(img => img.name === file.name);
      if (existingImage) {
        duplicateFiles.push(file.name);
      } else {
        nonDuplicateFiles.push(file);
      }
    }

    let successCount = 0;
    // 先处理非重复文件
    if (nonDuplicateFiles.length > 0) {
      const formData = new FormData();
      nonDuplicateFiles.forEach(file => {
        formData.append('files', file);
      });
      if (folderId) formData.append('folder_id', folderId);
      if (checkDuplicate !== undefined) formData.append('check_duplicate', checkDuplicate ? '1' : '0');
      
      try {
        const res = await imagesApi.uploadFiles(formData);
        
        // Handle response
        // If duplicates found and partial upload or just info returned
        if (res.duplicates && res.duplicates.length > 0) {
             duplicateFiles = res.duplicates;
             if (res.uploaded_count) {
                 successCount += res.uploaded_count;
             }
        } else if (Array.isArray(res)) {
            // Standard success response (array of created images)
            successCount += res.length;
        } else if (res.uploaded_count) {
            // New format success response
            successCount += res.uploaded_count;
        } else {
            // Fallback
            successCount += nonDuplicateFiles.length;
        }
      } catch (err: any) {
        console.error(`上传文件失败:`, err);
        // If error response contains duplicate info (e.g. 400 Bad Request with details)
        if (err.response && err.response.data && err.response.data.duplicates) {
            duplicateFiles = err.response.data.duplicates;
        } else {
            throw err;
        }
      }
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
    try {
      await Promise.all(ids.map(id => imagesApi.delete(id)));
      message.success(i18n.t('images.delete_success'));
      await refresh();
      setSelectedImages([]);
    } catch (error) {
      message.error(i18n.t('images.delete_failed'));
      console.error(error);
    }
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
    try {
      // 这里假设后端有move接口，如无可用foldersApi.addImages
      await foldersApi.addImages(folderId, imageIds);
      await refresh();
      message.success(i18n.t('images.move_success', { count: imageIds.length }));
    } catch (error) {
      message.error(i18n.t('images.move_failed'));
      console.error(error);
    }
  };

  const getFilteredImages = () => {
    if (!Array.isArray(images)) return [];
    if (selectedFolder === null) return images;
    if (selectedFolder === 'uncategorized') return images.filter(img => !img.folderId);
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
    setSelectedImages,
    setSelectedFolder,
    loadImages,
    loadMoreImages,
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
