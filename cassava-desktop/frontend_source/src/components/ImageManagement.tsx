import React, { useState, useMemo, useEffect, useDeferredValue, useCallback } from 'react';
import { Upload, Plus, Trash2, Move, Grid, List, Search, SortAsc, SortDesc, X, ChevronLeft, ChevronRight, Calendar, FolderOpen, FileText, Eye, Edit, MoreVertical, FolderPlus, Users } from 'lucide-react';
import { useImageStore } from '../hooks/useImageStore';
import { Modal, Switch, Input, message, Button, InputNumber, Dropdown, Tree, TreeSelect } from 'antd';
import { foldersApi, imagesApi } from '../services/api';
import { useTranslation } from 'react-i18next';
import { Folder, User, Image } from '../types';

import { EditImageModal } from './EditImageModal';
import { SmartClassificationModal } from './SmartClassificationModal';

interface ImageManagementProps {
  currentUser?: User;
}

const ImageManagement: React.FC<ImageManagementProps> = ({ currentUser }) => {
  const { t } = useTranslation();
  const ROOT_NODE_VALUE = '__root__';
  const {
    images,
    folders,
    selectedImages,
    selectedFolder,
    loading,
    hasMoreImages,
    loadingMoreImages,
    setSelectedImages,
    setSelectedFolder,
    uploadImages,
    deleteImages,
    moveImages,
    getFilteredImages,
    uploadFromZip,
    loadFolders,
    loadImages,
    loadMoreImages,
    updateImage,
    loadImageDetail,
    totalImagesCount,
  } = useImageStore(currentUser?.is_guest);

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'folder' | 'size' | 'capture_time'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [editingImage, setEditingImage] = useState<Image | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Array<{fileName: string, progress: number, status: string}>>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewImage, setPreviewImage] = useState<Image | null>(null);
  const [previewImageLoading, setPreviewImageLoading] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [dateGroupType, setDateGroupType] = useState<'year' | 'month' | 'day'>('year');
  const [showUploadConfigModal, setShowUploadConfigModal] = useState(false);
  const [uploadTargetFolder, setUploadTargetFolder] = useState<string | null>(null);
  const [uploadCheckDuplicate, setUploadCheckDuplicate] = useState(true);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderDescription, setNewFolderDescription] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [duplicateFiles, setDuplicateFiles] = useState<string[]>([]);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateAction, setDuplicateAction] = useState<'skip'|'overwrite'>('skip');
  const [selectedDuplicates, setSelectedDuplicates] = useState<string[]>([]);
  const [, setPendingUploadFiles] = useState<File[]>([]);
  const [showSmartModal, setShowSmartModal] = useState(false);
  const [smartFiles, setSmartFiles] = useState<File[]>([]);
  const [renameEnabled, setRenameEnabled] = useState(false);
  const [renamePrefix, setRenamePrefix] = useState('');
  const [renameStartSeq, setRenameStartSeq] = useState(1);
  const [renameDigits, setRenameDigits] = useState(2);
  const [folderTreeExpandedKeys, setFolderTreeExpandedKeys] = useState<React.Key[]>([]);
  const [folderTreeAutoExpandParent, setFolderTreeAutoExpandParent] = useState(true);
  const [folderTreeSearch, setFolderTreeSearch] = useState('');
  const isGuest = false;
  const isSharedWithMeView = false;
  const isMySharesView = false;
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [showRenameFolderModal, setShowRenameFolderModal] = useState(false);
  const [folderRenameValue, setFolderRenameValue] = useState('');
  const [folderRenameDescription, setFolderRenameDescription] = useState('');
  const [contextFolder, setContextFolder] = useState<Folder | null>(null);
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false);
  const [createFolderParentId, setCreateFolderParentId] = useState<string | null>(null);
  const [quickCreateFolderName, setQuickCreateFolderName] = useState('');
  const [quickCreateParentId, setQuickCreateParentId] = useState<string | null>(null);
  const [quickCreatingFolder, setQuickCreatingFolder] = useState(false);
  const [moveModalNewFolderName, setMoveModalNewFolderName] = useState('');
  const [moveModalNewFolderParentId, setMoveModalNewFolderParentId] = useState<string | null>(null);
  const [moveModalCreatingFolder, setMoveModalCreatingFolder] = useState(false);
  const [selectingAllImages, setSelectingAllImages] = useState(false);

  const handleBatchUpload = useCallback(async (files: File[], folderId?: string|null, checkDuplicate?: boolean) => {
    setShowUploadModal(true);
    const progressList = files.map(file => ({
      fileName: file.name,
      progress: 0,
      status: 'uploading'
    }));
    setUploadProgress(progressList);

    const zipFiles = files.filter(file => file.name.toLowerCase().endsWith('.zip'));
    const imageFiles = files.filter(file => file.type.startsWith('image/'));

    for (const zipFile of zipFiles) {
      const zipIndex = files.indexOf(zipFile);
      setUploadProgress(prev => prev.map((item, index) =>
        index === zipIndex ? { ...item, progress: 0, status: 'uploading' } : item
      ));
      await uploadFromZip(zipFile, folderId, checkDuplicate, (loaded, total) => {
        setUploadProgress(prev => prev.map((item, index) =>
          index === zipIndex ? { ...item, progress: Math.round((loaded / total) * 100) } : item
        ));
      });
      setUploadProgress(prev => prev.map((item, index) =>
        index === zipIndex ? { ...item, progress: 100, status: 'completed' } : item
      ));
    }

    let successCount = 0;
    if (imageFiles.length > 0) {
      try {
        successCount = await uploadImages(imageFiles, folderId, checkDuplicate, undefined, (loaded, total) => {
          setUploadProgress(prev => prev.map(item => {
            if (imageFiles.some(f => f.name === item.fileName)) {
              return { ...item, progress: Math.round((loaded / total) * 100), status: loaded < total ? 'uploading' : 'completed' };
            }
            return item;
          }));
        });
      } catch (err: any) {
        if (err?.type === 'duplicate') {
          setDuplicateFiles(err.files);
          setSelectedDuplicates(err.files);
          setPendingUploadFiles(imageFiles);
          setShowDuplicateModal(true);
        } else {
          const detail = err?.response?.data?.error || err?.response?.data?.message;
          message.error(detail ? String(detail) : t('images.upload_failed'));
        }
      }
    }

    setTimeout(() => {
      setShowUploadModal(false);
      setUploadProgress([]);
    }, 1000);

    return successCount + zipFiles.length;
  }, [t, uploadFromZip, uploadImages]);

  useEffect(() => {
    if (isGuest) return;
    const parent =
      selectedFolder && !['uncategorized', 'shared_with_me', 'my_shares'].includes(selectedFolder)
        ? selectedFolder
        : null;
    setQuickCreateParentId(parent);
  }, [isGuest, selectedFolder]);

  // 处理拖拽上传的文件
  useEffect(() => {
    const handleFilesDropped = (event: CustomEvent<File[]>) => {
      const files = event.detail;
      if (files && files.length > 0) {
        handleBatchUpload(files, uploadTargetFolder, uploadCheckDuplicate);
      }
    };

    window.addEventListener('files:dropped', handleFilesDropped as EventListener);
    return () => {
      window.removeEventListener('files:dropped', handleFilesDropped as EventListener);
    };
  }, [uploadTargetFolder, uploadCheckDuplicate, handleBatchUpload]);

    useEffect(() => {
    if (!showPreviewModal || !previewImage?.id) return;
    if (previewImage.image_url) return;

    let active = true;
    setPreviewImageLoading(true);

    loadImageDetail(previewImage.id)
      .then((detail) => {
        if (!active) return;
        setPreviewImage((prev) => {
          if (!prev || prev.id !== detail.id) return prev;
          return { ...prev, ...detail };
        });
      })
      .catch((error) => {
        console.error('Failed to load image detail for preview', error);
      })
      .finally(() => {
        if (active) {
          setPreviewImageLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [loadImageDetail, previewImage?.id, previewImage?.image_url, showPreviewModal]);

  const permissionLabel = (perm?: string) => {
    if (perm === 'edit') return t('shares.perm_edit');
    if (perm === 'manage') return t('shares.perm_manage');
    return t('shares.perm_view');
  };

  // Get filtered and sorted images
  const filteredAndSortedImages = useMemo(() => {
    let filtered: any[] = (Array.isArray(getFilteredImages()) ? getFilteredImages() : []);

    // Apply search filter
    filtered = filtered.filter(img => 
      img.name.toLowerCase().includes(deferredSearchQuery.toLowerCase())
    );

    // Sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'date': {
          const timeA = a.created_time ? new Date(a.created_time).getTime() : 0;
          const timeB = b.created_time ? new Date(b.created_time).getTime() : 0;
          comparison = timeA - timeB;
          break;
        }
        case 'capture_time': {
            const timeA = a.capture_time ? new Date(a.capture_time).getTime() : 0;
            const timeB = b.capture_time ? new Date(b.capture_time).getTime() : 0;
            comparison = timeA - timeB;
            break;
        }
        case 'folder': {
          const aFolder = folders.find(f => f.id === a.folderId)?.name || t('images.uncategorized');
          const bFolder = folders.find(f => f.id === b.folderId)?.name || t('images.uncategorized');
          comparison = aFolder.localeCompare(bFolder);
          break;
        }
        case 'size':
          comparison = (a.size ?? 0) - (b.size ?? 0);
          break;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [deferredSearchQuery, getFilteredImages, sortBy, sortOrder, folders, t]);

  const visibleImageCount = filteredAndSortedImages.length;
  const totalDisplayCount = deferredSearchQuery.trim()
    ? visibleImageCount
    : (totalImagesCount > 0 ? totalImagesCount : visibleImageCount);
  const allVisibleImagesSelected = visibleImageCount > 0 && filteredAndSortedImages.every(img => selectedImages.includes(img.id));
  const allCurrentScopeSelected = allVisibleImagesSelected && selectedImages.length >= totalDisplayCount;

  const loadAllCurrentImageIds = async () => {
    const params =
      selectedFolder === 'uncategorized'
        ? { folder: 'uncategorized' }
        : selectedFolder && /^\d+$/.test(selectedFolder)
          ? { folder: selectedFolder }
          : {};
    const res = await imagesApi.getAllPages(params);
    return res.items
      .filter(img => {
        if (selectedFolder === 'uncategorized' && img.folderId) return false;
        if (selectedFolder && selectedFolder !== 'uncategorized' && img.folderId !== selectedFolder) return false;
        if (deferredSearchQuery.trim()) {
          return img.name.toLowerCase().includes(deferredSearchQuery.toLowerCase());
        }
        return true;
      })
      .map(img => img.id);
  };

  // Grouped image data
  const groupedImages = useMemo(() => {
    if (sortBy === 'date' || sortBy === 'capture_time') {
      // Date grouping
      const groupKey = (img: any) => {
        let dateStr;
        if (sortBy === 'capture_time') {
            dateStr = img.capture_time;
        } else {
            dateStr = img.uploadDate || img.created_time;
        }
        
        if (!dateStr) return t('images.unknown_date');
        
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return t('images.unknown_date');
        
        if (dateGroupType === 'year') return date.getFullYear().toString();
        if (dateGroupType === 'month') return `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}`;
        if (dateGroupType === 'day') return `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')}`;
        return '';
      };
      const groups: Record<string, any[]> = {};
      filteredAndSortedImages.forEach(img => {
        const key = groupKey(img);
        if (!groups[key]) groups[key] = [];
        groups[key].push(img);
      });
      return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).map(([key, imgs]) => ({ key, images: imgs }));
    } else if (sortBy === 'folder') {
      // Folder grouping
      const groups: Record<string, any[]> = {};
      filteredAndSortedImages.forEach(img => {
        const folder = folders.find(f => f.id === img.folderId)?.name || t('images.uncategorized');
        if (!groups[folder]) groups[folder] = [];
        groups[folder].push(img);
      });
      return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).map(([key, imgs]) => ({ key, images: imgs }));
    } else {
      // No grouping
      return [{ key: '', images: filteredAndSortedImages }];
    }
  }, [filteredAndSortedImages, sortBy, dateGroupType, folders, t]);

  // Generate global image array and mapping
  const flatImages = useMemo(() => filteredAndSortedImages, [filteredAndSortedImages]);
  const imageIndexById = useMemo(() => {
    return new Map(flatImages.map((img: any, idx: number) => [img.id, idx]));
  }, [flatImages]);

  // Generate group jump index (right sidebar)
  const groupJumpIndex = useMemo(() => {
    if (sortBy === 'date' || sortBy === 'folder') {
      return groupedImages.map((group) => ({ key: group.key, index: `group-divider-${group.key}` }));
    } else {
      // Original alphabet index
      const groups: { [key: string]: number } = {};
      filteredAndSortedImages.forEach((img, index) => {
        let key = '';
        if (sortBy === 'name') {
          key = img.name.charAt(0).toUpperCase();
        } else {
          const sizeCategory = (img.size ?? 0) < 1024 * 1024 ? t('images.size_categories.small') : 
                             (img.size ?? 0) < 5 * 1024 * 1024 ? t('images.size_categories.medium') : t('images.size_categories.large');
          key = sizeCategory;
        }
        if (!groups[key]) {
          groups[key] = index;
        }
      });
      return Object.keys(groups).sort().map(key => ({ key, index: groups[key] }));
    }
  }, [groupedImages, filteredAndSortedImages, sortBy, t]);

  // Scroll to specified index or group
  const scrollToIndex = (index: number | string) => {
    if (typeof index === 'string') {
      const element = document.getElementById(index);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      const element = document.getElementById(`image-${index}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
        handleBatchUpload([files[0]], uploadTargetFolder, uploadCheckDuplicate);
      } else {
        setSmartFiles(files);
        setShowSmartModal(true);
      }
    }
  };

  const handleSmartConfirm = async (fileData: Array<{ file: File, folderId?: string }>) => {
    setShowSmartModal(false);
    
    const groups: Record<string, typeof fileData> = {};
    fileData.forEach(item => {
      const fid = item.folderId || uploadTargetFolder || 'root';
      if (!groups[fid]) groups[fid] = [];
      groups[fid].push(item);
    });

    for (const [fid, items] of Object.entries(groups)) {
      const folderId = fid === 'root' ? undefined : fid;
      const files = items.map(i => i.file);
      
      try {
        await handleBatchUpload(files, folderId, uploadCheckDuplicate);
      } catch (e) {
        console.error("Smart upload error", e);
      }
    }
    loadImages();
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setShowUploadConfigModal(false); // Close config modal
    const files = Array.from(event.dataTransfer.files);
    
    if (files.length > 0) {
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
        handleBatchUpload([files[0]], uploadTargetFolder, uploadCheckDuplicate);
      } else {
        setSmartFiles(files);
        setShowSmartModal(true);
      }
    }
  };

  const handleImageSelect = (imageId: string, isSelected: boolean) => {
    if (isSelected) {
      setSelectedImages([...selectedImages, imageId]);
    } else {
      setSelectedImages(selectedImages.filter(id => id !== imageId));
    }
  };

  const handleSelectAll = async () => {
    if (allCurrentScopeSelected) {
      setSelectedImages([]);
      return;
    }

    setSelectingAllImages(true);
    try {
      setSelectedImages(await loadAllCurrentImageIds());
    } catch (err) {
      console.error(err);
      message.error(t('images.load_images_failed'));
    } finally {
      setSelectingAllImages(false);
    }
  };

  const handleBatchDelete = () => {
    if (selectedImages.length > 0 && window.confirm(t('images.confirm_delete', { count: selectedImages.length }))) {
      deleteImages(selectedImages);
      setSelectedImages([]);
    }
  };

  const handleBatchMove = async (targetFolderId: string) => {
    if (selectedImages.length > 0) {
      await moveImages(selectedImages, targetFolderId);
      setSelectedImages([]);
      setShowMoveModal(false);
      // Auto refresh after move
      loadImages?.();
    }
  };

  const handleImagePreview = (image: any, index: number) => {
    setPreviewImage(image);
    setPreviewIndex(index);
    setShowPreviewModal(true);
  };

  const handlePrevImage = () => {
    const newIndex = previewIndex > 0 ? previewIndex - 1 : flatImages.length - 1;
    setPreviewIndex(newIndex);
    setPreviewImage(flatImages[newIndex]);
  };

  const handleNextImage = () => {
    const newIndex = previewIndex < flatImages.length - 1 ? previewIndex + 1 : 0;
    setPreviewIndex(newIndex);
    setPreviewImage(flatImages[newIndex]);
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 MB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  const getSortIcon = () => {
    return sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />;
  };

  // Create new folder
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const res = await foldersApi.create({
        name: newFolderName,
        description: newFolderDescription,
        parent: createFolderParentId,
      });
      await loadFolders?.(); // If global loadFolders is available, otherwise ignore
      
      // If we created a subfolder, we stay in current folder, but we want to see the new folder.
      // If we created a root folder (and we were at root), we might want to enter it or just see it.
      // Current logic sets uploadTarget to it.
      setUploadTargetFolder(res.id);
      
      setNewFolderName('');
      setNewFolderDescription('');
      setShowCreateFolderModal(false);
      setCreateFolderParentId(null); // Reset parent ID
      message.success(t('images.folder_created'));
    } catch {
      message.error(t('images.create_folder_failed'));
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleQuickCreateFolder = async () => {
    if (isGuest) return;
    if (!quickCreateFolderName.trim()) return;
    setQuickCreatingFolder(true);
    try {
      await foldersApi.create({ name: quickCreateFolderName.trim(), parent: quickCreateParentId });
      await loadFolders?.();
      setQuickCreateFolderName('');
      message.success(t('images.folder_created'));
    } catch {
      message.error(t('images.create_folder_failed'));
    } finally {
      setQuickCreatingFolder(false);
    }
  };

  const handleRenameFolder = async () => {
    if (!contextFolder || !folderRenameValue.trim()) return;
    try {
      await foldersApi.update(contextFolder.id, { name: folderRenameValue, description: folderRenameDescription });
      await loadFolders?.();
      setShowRenameFolderModal(false);
      setFolderRenameValue('');
      setFolderRenameDescription('');
      setContextFolder(null);
      message.success(t('images.folder_renamed'));
    } catch {
      message.error(t('images.rename_failed'));
    }
  };

  const handleDeleteFolder = async (deleteImagesInFolder: boolean) => {
    if (!contextFolder) return;
    try {
      await foldersApi.deleteWithStrategy(contextFolder.id, { strategy: deleteImagesInFolder ? 'delete' : 'keep' });
      await loadFolders?.();
      await loadImages?.({ reset: true });
      
      // If we deleted the currently selected folder, go to root
      if (selectedFolder === contextFolder.id) {
        setSelectedFolder(null);
      }
      
      setShowDeleteFolderModal(false);
      setContextFolder(null);
      message.success(t('images.folder_deleted'));
    } catch (e) {
      console.error(e);
      message.error(t('images.delete_failed'));
    }
  };


  // Upload images with duplicate check support
  const handleDuplicateAction = async () => {
    setShowDuplicateModal(false);
    if (duplicateAction === 'overwrite') {
      // Use the stored pending files (not the cleared input) for overwrite
      const filesToOverwrite = pendingUploadFiles.filter(f => selectedDuplicates.includes(f.name));
      if (filesToOverwrite.length > 0) {
        await uploadImages(filesToOverwrite, uploadTargetFolder, false, true);
      }
    }
    // Skip if action is skip
    setDuplicateFiles([]);
    setSelectedDuplicates([]);
    setPendingUploadFiles([]);
  };

  // Create folder logic (for move modal)
  const handleCreateFolderForMove = async () => {
    if (!moveModalNewFolderName.trim()) return;
    setMoveModalCreatingFolder(true);
    try {
      const res = await foldersApi.create({ name: moveModalNewFolderName.trim(), parent: moveModalNewFolderParentId });
      await loadFolders?.();
      setMoveModalNewFolderName('');
      // Move to new folder immediately after creation
      await handleBatchMove(res.id);
      setShowMoveModal(false);
      message.success(t('images.folder_moved'));
      // Auto refresh after create and move
      loadImages?.();
    } catch {
      message.error(t('images.create_folder_failed'));
    } finally {
      setMoveModalCreatingFolder(false);
    }
  };

  const getBreadcrumbs = () => {
    if (!selectedFolder || ['uncategorized', 'shared_with_me', 'my_shares'].includes(selectedFolder)) return [];
    
    const crumbs = [];
    let currentId: string | undefined = selectedFolder;
    while (currentId) {
      const folder = folders.find(f => f.id === currentId);
      if (folder) {
        crumbs.unshift(folder);
        currentId = folder.parent;
      } else {
        break;
      }
    }
    return crumbs;
  };

  const getCurrentSubfolders = () => {
    // If selectedFolder is null (Root/All Images), show root folders (those with no parent)
    if (selectedFolder === null) {
      return folders.filter(f => !f.parent);
    }
    if (['uncategorized', 'shared_with_me', 'my_shares'].includes(selectedFolder)) return [];
    return folders.filter(f => f.parent === selectedFolder);
  };

  const getFolderMenuItems = (folder: Folder) => ({
    items: [
      {
        key: 'rename',
        label: (
            <div className="flex items-center gap-2" onClick={(e) => {
                e.stopPropagation(); // Prevent folder selection
                setContextFolder(folder);
                setFolderRenameValue(folder.name);
                setFolderRenameDescription(folder.description || '');
                setShowRenameFolderModal(true);
            }}>
                <Edit className="w-4 h-4" />
                <span>{t('images.rename_folder')}</span>
            </div>
        )
      },
      {
        key: 'subfolder',
        label: (
            <div className="flex items-center gap-2" onClick={(e) => {
                e.stopPropagation();
                setContextFolder(folder);
                setCreateFolderParentId(folder.id);
                setNewFolderName('');
                setNewFolderDescription('');
                setShowCreateFolderModal(true);
            }}>
                <FolderPlus className="w-4 h-4" />
                <span>{t('images.new_subfolder')}</span>
            </div>
        )
      },
      {
        type: 'divider' as const,
      },
      {
        key: 'delete',
        danger: true,
        label: (
            <div className="flex items-center gap-2" onClick={(e) => {
                e.stopPropagation();
                setContextFolder(folder);
                setShowDeleteFolderModal(true);
            }}>
                <Trash2 className="w-4 h-4" />
                <span>{t('images.delete_folder')}</span>
            </div>
        )
      }
    ]
  });

  const folderById = useMemo(() => {
    const map = new Map<string, Folder>();
    for (const f of folders) map.set(String(f.id), f);
    return map;
  }, [folders]);

  const parentById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const f of folders) map.set(String(f.id), f.parent === null || f.parent === undefined ? null : String(f.parent));
    return map;
  }, [folders]);

  const childrenByParentId = useMemo(() => {
    const map = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const key = f.parent === null || f.parent === undefined ? null : String(f.parent);
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
      map.set(k, arr);
    }
    return map;
  }, [folders]);

  const visibleFolderIds = useMemo(() => {
    const q = folderTreeSearch.trim().toLowerCase();
    if (!q) return null;
    const visible = new Set<string>();
    for (const f of folders) {
      if (!f.name?.toLowerCase().includes(q)) continue;
      const id = String(f.id);
      visible.add(id);
      let p = parentById.get(id) ?? null;
      while (p) {
        visible.add(p);
        p = parentById.get(p) ?? null;
      }
    }
    return visible;
  }, [folders, folderTreeSearch, parentById]);

  useEffect(() => {
    const q = folderTreeSearch.trim().toLowerCase();
    if (!q) {
      setFolderTreeAutoExpandParent(false);
      return;
    }
    const expand = new Set<React.Key>();
    for (const f of folders) {
      if (!f.name?.toLowerCase().includes(q)) continue;
      const id = String(f.id);
      let p = parentById.get(id) ?? null;
      while (p) {
        expand.add(p);
        p = parentById.get(p) ?? null;
      }
    }
    setFolderTreeExpandedKeys(Array.from(expand));
    setFolderTreeAutoExpandParent(true);
  }, [folderTreeSearch, folders, parentById]);

  const folderTreeData = useMemo(() => {
    const build = (parentId: string | null): any[] => {
      const items = childrenByParentId.get(parentId) ?? [];
      return items
        .filter(f => !visibleFolderIds || visibleFolderIds.has(String(f.id)))
        .map(f => {
          const id = String(f.id);
          const pid = f.parent === null || f.parent === undefined ? null : String(f.parent);
          return {
          key: id,
          title: f.name,
          parentId: pid,
          folderId: id,
          children: build(id),
          };
        });
    };
    return build(null);
  }, [childrenByParentId, visibleFolderIds]);

  const folderTreeSelectData = useMemo(() => {
    const build = (parentId: string | null): any[] => {
      const items = childrenByParentId.get(parentId) ?? [];
      return items.map(f => {
        const id = String(f.id);
        return {
          title: f.name,
          value: id,
          key: id,
          children: build(id),
        };
      });
    };
    return [
      {
        title: t('images.root_directory'),
        value: ROOT_NODE_VALUE,
        key: ROOT_NODE_VALUE,
        children: build(null),
      },
    ];
  }, [ROOT_NODE_VALUE, childrenByParentId, t]);

  const handleFolderTreeDrop = async (info: any) => {
    if (isGuest) return;
    const dragId = String(info.dragNode.key);
    const targetId = String(info.node.key);
    const dropToGap = Boolean(info.dropToGap);
    const targetParentId = (info.node as any).parentId ?? null;
    const newParentId = dropToGap ? targetParentId : targetId;

    if (!dragId) return;
    if (newParentId === dragId) return;

    let cur = newParentId;
    while (cur) {
      if (cur === dragId) {
        message.error(t('images.cannot_move_to_child'));
        return;
      }
      cur = parentById.get(cur) ?? null;
    }

    try {
      await foldersApi.update(dragId, { parent: newParentId ? String(newParentId) : null } as any);
      await loadFolders?.();
      message.success(t('images.folder_moved'));
    } catch (e: any) {
      const detail =
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message;
      message.error(detail ? String(detail) : t('images.move_folder_failed'));
    }
  };

  const getDraggedImageIds = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types ?? []);
    if (!types.includes('application/x-image-id')) return null;
    const imageId = e.dataTransfer.getData('application/x-image-id');
    if (!imageId) return null;
    let idsToMove = [imageId];
    const multiSelectJson = e.dataTransfer.getData('application/json');
    if (multiSelectJson) {
      try {
        const selected = JSON.parse(multiSelectJson);
        if (Array.isArray(selected) && selected.includes(imageId)) idsToMove = selected;
      } catch (_err) {
        idsToMove = [imageId];
      }
    }
    return idsToMove;
  };

  const renderFolderTreeTitle = (node: any) => {
    const folderId = String(node.folderId ?? node.key);
    const folder = folderById.get(folderId);
    if (!folder) return null;
    const isSelected = selectedFolder === folderId;
    return (
      <div
        className="flex items-center justify-between w-full group min-w-0"
        onDragOver={(e) => {
          if (isGuest) return;
          const ids = getDraggedImageIds(e);
          if (!ids?.length) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          if (isGuest) return;
          const ids = getDraggedImageIds(e);
          if (!ids?.length) return;
          e.preventDefault();
          e.stopPropagation();
          moveImages(ids, folderId);
        }}
      >
        <div className="flex items-center min-w-0">
          <FolderOpen className={`w-4 h-4 mr-2 flex-shrink-0 ${isSelected ? 'text-blue-600' : 'text-blue-500'}`} />
          <span className={`truncate text-sm ${isSelected ? 'font-semibold text-blue-700' : 'font-medium text-gray-700'}`}>
            {folder.name}
          </span>
        </div>
        <div className="flex items-center flex-shrink-0">
          <span className={`text-xs px-1.5 py-0.5 rounded-full ml-2 ${isSelected ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
            {folder.imageCount}
          </span>
          {!isGuest && (
            <div className="flex items-center ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                className="p-1 rounded hover:bg-gray-100"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCreateFolderParentId(folder.id);
                  setNewFolderName('');
                  setNewFolderDescription('');
                  setShowCreateFolderModal(true);
                }}
              >
                <FolderPlus className="w-3.5 h-3.5 text-gray-500" />
              </button>
              <button
                className="p-1 rounded hover:bg-gray-100"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextFolder(folder);
                  setFolderRenameValue(folder.name);
                  setFolderRenameDescription(folder.description || '');
                  setShowRenameFolderModal(true);
                }}
              >
                <Edit className="w-3.5 h-3.5 text-gray-500" />
              </button>
              <button
                className="p-1 rounded hover:bg-gray-100"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextFolder(folder);
                  setShowDeleteFolderModal(true);
                }}
              >
                <Trash2 className="w-3.5 h-3.5 text-gray-500" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex">
      {/* Left Sidebar - Folders */}
      <div className="hidden sm:block w-64 bg-gradient-to-b from-green-50 to-white border-r border-gray-200 flex flex-col shadow-sm">
        <div className="p-4 border-b border-gray-100 bg-white">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-green-600" />
            {t('images.folders')}
          </h3>
          {!isGuest && (
          <button 
            onClick={() => {
              setNewFolderName('');
              setNewFolderDescription('');
              const parent =
                selectedFolder && !['uncategorized', 'shared_with_me', 'my_shares'].includes(selectedFolder)
                  ? selectedFolder
                  : null;
              setCreateFolderParentId(parent);
              setShowCreateFolderModal(true);
            }}
            className="w-full flex items-center justify-center px-3 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 transition-all shadow-sm hover:shadow-md transform hover:-translate-y-0.5">
            <Plus className="w-4 h-4 mr-2" />
            {t('images.create_folder')}
          </button>
          )}
          {!isGuest && (
            <div className="mt-3 space-y-2">
              <TreeSelect
                className="w-full"
                value={(quickCreateParentId ?? null) === null ? ROOT_NODE_VALUE : quickCreateParentId}
                onChange={(v) => setQuickCreateParentId(v === ROOT_NODE_VALUE || v == null ? null : String(v))}
                treeData={folderTreeSelectData}
                treeDefaultExpandAll
                showSearch
                placeholder={t('images.choose_folder')}
                size="small"
              />
              <div className="flex gap-2">
                <Input
                  value={quickCreateFolderName}
                  onChange={(e) => setQuickCreateFolderName(e.target.value)}
                  onPressEnter={handleQuickCreateFolder}
                  placeholder={t('images.enter_folder_name')}
                  size="small"
                />
                <Button
                  type="primary"
                  size="small"
                  loading={quickCreatingFolder}
                  onClick={handleQuickCreateFolder}
                >
                  {t('common.create')}
                </Button>
              </div>
            </div>
          )}
        </div>
        
        <div className="flex-1 p-2 overflow-y-auto">
          <button
            onClick={() => setSelectedFolder(null)}
            className={`w-full text-left px-3 py-2 rounded-lg mb-1 transition-all duration-200 ${
              selectedFolder === null ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-sm' : 'hover:bg-gray-50 hover:shadow-sm'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{t('images.all_images')}</span>
              <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">{totalImagesCount}</span>
            </div>
          </button>
          <button
            onClick={() => setSelectedFolder('uncategorized')}
            className={`w-full text-left px-3 py-2 rounded-lg mb-1 transition-all duration-200 ${
              selectedFolder === 'uncategorized' ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-sm' : 'hover:bg-gray-50 hover:shadow-sm'
            }`}
            onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            onDrop={(e) => {
                // Special handling for dropping on 'Uncategorized' (remove from folder)
                e.preventDefault();
                e.stopPropagation();
                const imageId = e.dataTransfer.getData('application/x-image-id');
                if (imageId) {
                    let idsToMove = [imageId];
                    const multiSelectJson = e.dataTransfer.getData('application/json');
                    if (multiSelectJson) {
                      try {
                         const selected = JSON.parse(multiSelectJson);
                         if (Array.isArray(selected) && selected.includes(imageId)) {
                            idsToMove = selected;
                         }
                      } catch(_err) {
                        // Ignore JSON parse error
                    }
                  }
                    // Move to 'uncategorized' logic: update image with folder=null
                    Promise.all(idsToMove.map(id => updateImage(id, { folder: null })))
                        .then(() => {
                            message.success(t('images.moved_to_uncategorized'));
                            loadImages();
                        })
                        .catch(() => message.error(t('images.move_failed')));
                }
            }}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{t('images.uncategorized')}</span>
              <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">{images.filter(img => !img.folderId).length}</span>
            </div>
          </button>

          <div className="border-t border-gray-200 my-2"></div>

          <div className="px-2 pb-2">
            <Input
              value={folderTreeSearch}
              onChange={(e) => setFolderTreeSearch(e.target.value)}
              allowClear
              size="small"
              placeholder={t('images.search')}
            />
          </div>

          <div className="px-1">
              <Tree
                treeData={folderTreeData}
                titleRender={renderFolderTreeTitle}
                draggable={true}
                blockNode
                expandedKeys={folderTreeExpandedKeys}
                autoExpandParent={folderTreeAutoExpandParent}
                onExpand={(keys) => {
                  setFolderTreeExpandedKeys(keys as React.Key[]);
                  setFolderTreeAutoExpandParent(false);
                }}
                selectedKeys={
                  selectedFolder && !['uncategorized', 'shared_with_me', 'my_shares'].includes(selectedFolder) ? [selectedFolder] : []
                }
                onSelect={(keys) => {
                  const key = keys?.[0];
                  if (key) setSelectedFolder(String(key));
                }}
                onDrop={handleFolderTreeDrop}
              />
            </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col w-full">
        {/* Header */}
        <div className="bg-gradient-to-r from-white to-green-50 border-b border-gray-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center flex-wrap gap-2">
              <h2 
                className="text-2xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent cursor-pointer hover:underline"
                onClick={() => setSelectedFolder(null)}
              >
                {t('navigation.images')}
              </h2>
              {getBreadcrumbs().map((folder, index) => (
                <React.Fragment key={folder.id}>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                  <span 
                    className={`text-lg font-medium cursor-pointer hover:text-green-600 ${
                      index === getBreadcrumbs().length - 1 ? 'text-gray-800' : 'text-gray-500'
                    }`}
                    onClick={() => setSelectedFolder(folder.id)}
                  >
                    {folder.name}
                  </span>
                </React.Fragment>
              ))}
            </div>
            <div className="flex items-center space-x-3">
              <div className="flex bg-white rounded-lg p-1 shadow-sm border border-gray-200">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-lg transition-all duration-200 ${viewMode === 'grid' ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md' : 'hover:bg-gray-50'}`}
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-lg transition-all duration-200 ${viewMode === 'list' ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md' : 'hover:bg-gray-50'}`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Search and Actions */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3 flex-1 w-full sm:w-auto">
              <div className="relative flex-1 max-w-md w-full">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder={t('images.search')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm shadow-sm hover:shadow-md transition-all duration-200"
                />
              </div>
              
              {/* Sort Controls */}
              <div className="hidden sm:flex items-center space-x-2 bg-white p-2 rounded-lg shadow-sm border border-gray-200">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm transition-all duration-200"
                >
                  <option value="date">{t('images.sort.date')}</option>
                  <option value="capture_time">{t('images.capture_time')}</option>
                  <option value="name">{t('images.sort.name')}</option>
                  <option value="folder">{t('images.sort.folder')}</option>
                  <option value="size">{t('images.sort.size')}</option>
                </select>
                { (sortBy === 'date' || sortBy === 'capture_time') && (
                  <select
                    value={dateGroupType}
                    onChange={e => setDateGroupType(e.target.value as any)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm transition-all duration-200"
                  >
                    <option value="year">{t('images.group.year')}</option>
                    <option value="month">{t('images.group.month')}</option>
                    <option value="day">{t('images.group.day')}</option>
                  </select>
                )}
                <button
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="p-2 border border-gray-300 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-all duration-200"
                >
                  {getSortIcon()}
                </button>
              </div>
            </div>
            
            <div className="flex items-center space-x-2 flex-wrap">
              {selectedImages.length > 0 && (
                <span className="hidden sm:block text-sm font-medium text-gray-700 bg-white px-3 py-2 rounded-lg shadow-sm border border-gray-200">{t('images.selected_items', { count: selectedImages.length })}</span>
              )}
              {selectedImages.length > 0 && (
                <>
                  <button
                    onClick={() => setShowMoveModal(true)}
                    className="flex items-center px-3 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-sm hover:shadow-md transform hover:-translate-y-0.5 text-sm"
                  >
                    <Move className="w-4 h-4 mr-2" />
                    <span>{t('images.move')}</span>
                  </button>
                  <button
                    onClick={handleBatchDelete}
                    className="flex items-center px-3 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg hover:from-red-600 hover:to-red-700 transition-all duration-200 shadow-sm hover:shadow-md transform hover:-translate-y-0.5 text-sm"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    <span>{t('images.delete')}</span>
                  </button>
                </>
              )}
              {/* Upload image/folder entry */}
              <button
                className="flex items-center px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md transform hover:-translate-y-0.5 text-sm"
                onClick={e => {
                  e.preventDefault();
                  setShowUploadConfigModal(true);
                }}
              >
                <Upload className="w-4 h-4 mr-2" />
                <span>{t('images.upload')}</span>
              </button>
              {/* Import local images (direct reference, no copy) */}
              <button
                className="flex items-center px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md transform hover:-translate-y-0.5 text-sm"
                onClick={async e => {
                  e.preventDefault();
                  if (!window.electronAPI?.selectLocalImages) {
                    message.warning('当前环境不支持选择本地图片');
                    return;
                  }
                  const paths = await window.electronAPI.selectLocalImages();
                  if (!paths || paths.length === 0) return;
                  // 显式目标文件夹：当前浏览的文件夹（非特殊视图）
                  const isSpecialView = selectedFolder === null || [ROOT_NODE_VALUE, 'uncategorized', 'shared_with_me', 'my_shares'].includes(String(selectedFolder));
                  const importTargetFolder = isSpecialView ? undefined : String(selectedFolder);
                  try {
                    const res = await imagesApi.importLocalImages(paths, importTargetFolder);
                    if (res.imported_count > 0) {
                      message.success(t('images.import_local_success', { count: res.imported_count }));
                      await refresh();
                    }
                    if (res.skipped && res.skipped.length > 0) {
                      message.info(`${res.skipped.length} 个文件已引用过，跳过`);
                    }
                    if (res.failed && res.failed.length > 0) {
                      message.warning(`${res.failed.length} 个文件导入失败`);
                    }
                  } catch (err: any) {
                    message.error(err?.response?.data?.error || err?.message || '导入失败');
                  }
                }}
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                <span>{t('images.import_local')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Content with Alphabet Index */}
        <div className="flex-1 flex overflow-hidden">
          {/* Main Content Area */}
          <div className="flex-1 p-4 overflow-y-auto">

            {/* Selection Controls */}
            {filteredAndSortedImages.length > 0 && (
              <div className="flex items-center justify-between mb-4 p-3 bg-white rounded-lg shadow-sm border border-gray-200">
                <label className="flex items-center cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={allCurrentScopeSelected}
                    onChange={handleSelectAll}
                    disabled={selectingAllImages}
                    className="mr-3 w-5 h-5 text-green-600 rounded-lg border-gray-300 focus:ring-2 focus:ring-green-500 transition-all duration-200 group-hover:scale-110"
                  />
                  <span className="text-sm font-medium text-gray-700 group-hover:text-green-600 transition-colors">
                    {selectingAllImages ? t('common.loading_more') : t('images.select_all', { count: totalDisplayCount })}
                  </span>
                </label>
                <div className="text-sm text-gray-500">
                  {t('images.total_items', { count: totalDisplayCount })}
                </div>
              </div>
            )}

            {/* Subfolders Grid */}
            {getCurrentSubfolders().length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wider">{t('images.folders')}</h3>
                <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                  {getCurrentSubfolders().map(folder => (
                    <Dropdown key={folder.id} menu={getFolderMenuItems(folder)} trigger={['contextMenu']}>
                        <div 
                        onClick={() => setSelectedFolder(folder.id)}
                        onDragOver={(e) => {
                          if (isGuest) return;
                          const ids = getDraggedImageIds(e);
                          if (!ids?.length) return;
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onDrop={(e) => {
                          if (isGuest) return;
                          const ids = getDraggedImageIds(e);
                          if (!ids?.length) return;
                          e.preventDefault();
                          e.stopPropagation();
                          moveImages(ids, folder.id);
                        }}
                        className="group p-4 bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md cursor-pointer transition-all duration-200 flex flex-col items-center justify-center text-center aspect-square relative"
                        >
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Dropdown menu={getFolderMenuItems(folder)} trigger={['click']}>
                                <div className="p-1 hover:bg-gray-100 rounded-full" onClick={e => e.stopPropagation()}>
                                    <MoreVertical className="w-4 h-4 text-gray-500" />
                                </div>
                            </Dropdown>
                        </div>
                        <FolderOpen className="w-12 h-12 text-blue-200 group-hover:text-blue-500 transition-colors mb-2" />
                        <span className="font-medium text-gray-700 group-hover:text-blue-600 truncate w-full px-2">{folder.name}</span>
                        <span className="text-xs text-gray-400 mt-1">{folder.imageCount} items</span>
                        </div>
                    </Dropdown>
                  ))}
                </div>
                <div className="border-b border-gray-200 my-6"></div>
              </div>
            )}

            {/* Images Grid/List */}
            {loading ? (
              <div className="flex flex-col items-center justify-center h-64 bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-t-4 border-green-600 mb-4"></div>
                <p className="text-gray-600">{t('images.loading')}</p>
              </div>
            ) : filteredAndSortedImages.length === 0 && getCurrentSubfolders().length === 0 ? (
              <div className="text-center py-16 bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <Search className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">{t('images.no_images_found')}</h3>
                <p className="text-gray-500">{searchQuery ? t('images.no_match') : t('images.no_images')}</p>
              </div>
            ) : (
              <div className={viewMode === 'grid' 
                ? 'grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-5'
                : 'space-y-3'
              }>
                {groupedImages.map(group => (
                  <React.Fragment key={group.key}>
                    {group.key && (
                      <div id={`group-divider-${group.key}`} className="col-span-full flex items-center my-4">
                        <div className="flex-1 border-t-2 border-dashed border-gray-300"></div>
                        <span className="mx-4 text-gray-600 text-sm font-semibold bg-white px-4 py-1 rounded-full shadow-sm">{group.key}</span>
                        <div className="flex-1 border-t-2 border-dashed border-gray-300"></div>
                      </div>
                    )}
                    {group.images.map((image) => {
                      const globalIndex = imageIndexById.get(image.id) ?? -1;
                      return (
                        <div
                          key={image.id}
                          id={`image-${globalIndex}`}
                          className={
                            viewMode === 'grid'
                              ? `group relative bg-white rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-200 overflow-hidden transform hover:-translate-y-1 ${
                                selectedImages.includes(image.id) ? 'ring-3 ring-green-500 border-green-500 shadow-2xl' : ''
                              }`
                              : `flex items-center p-4 bg-white rounded-xl border border-gray-200 hover:shadow-md transition-all duration-300 ${
                                selectedImages.includes(image.id) ? 'bg-gradient-to-r from-green-50 to-blue-50 border-green-500' : ''
                              }`
                          }
                        >
                          {viewMode === 'grid' ? (
                            <>
                              <div className="aspect-square relative overflow-hidden rounded-lg">
                                <img
                                  src={image.preview_url || image.image_url || image.url}
                                  alt={image.name}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-cover cursor-pointer transition-transform duration-500 group-hover:scale-110"
                                  onClick={() => handleImagePreview(image, globalIndex)}
                                  draggable={!isGuest}
                                  onDragStart={(e) => {
                                    if (isGuest) return;
                                    e.dataTransfer.setData('application/x-image-id', image.id);
                                    // Also set IDs if multiple are selected
                                    if (selectedImages.includes(image.id) && selectedImages.length > 1) {
                                      e.dataTransfer.setData('application/json', JSON.stringify(selectedImages));
                                    }
                                  }}
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center">
                                  <button
                                    onClick={() => handleImagePreview(image, globalIndex)}
                                    className="p-3 bg-white rounded-full shadow-lg transform scale-0 group-hover:scale-100 transition-transform duration-300 hover:bg-blue-50"
                                  >
                                    <Eye className="w-5 h-5 text-blue-600" />
                                  </button>
                                </div>
                                {image.is_guest_accessible && (
                                  <div className="absolute top-2 right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full shadow-md">
                                    {t('common.public')}
                                  </div>
                                )}
                                {image.storage_mode === 'external' && (
                                  <div className="absolute top-2 left-2 bg-orange-500 text-white text-xs px-2 py-1 rounded-full shadow-md" title={image.source_path || ''}>
                                    {t('images.external') || '引用'}
                                  </div>
                                )}
                              </div>
                              <div className="p-3">
                                <p className="text-sm font-semibold text-gray-900 truncate" title={image.name}>
                                  {image.name}
                                </p>
                                <div className="flex flex-col mt-2 space-y-1">
                                  <p className="text-xs text-gray-500 flex items-center" title={t('images.upload_time')}>
                                    <Upload className="w-3 h-3 mr-1" />
                                    {image.created_time ? new Date(image.created_time).toLocaleString() : ''}
                                  </p>
                                  {image.capture_time && (
                                    <p className="text-xs text-gray-500 flex items-center" title={t('images.capture_time')}>
                                      <Calendar className="w-3 h-3 mr-1" />
                                      {new Date(image.capture_time).toLocaleString()}
                                    </p>
                                  )}
                                  <p className="text-xs text-gray-500">
                                    {t('images.size')}: {formatFileSize(image.size)}
                                  </p>
                                </div>
                                {image.hasPPD && (
                                  <div className="flex items-center mt-2">
                                    <div className={`w-3 h-3 rounded-full mr-2 ${
                                      image.ppdValue !== undefined ? (image.ppdValue >= 7 ? 'bg-green-500' : 
                                      image.ppdValue >= 4 ? 'bg-yellow-500' : 'bg-red-500') : 'bg-gray-300'
                                    }`}></div>
                                    <span className="text-xs font-medium text-gray-700">
                                      {t('results.ppd_value')}: {image.ppdValue !== undefined ? image.ppdValue.toFixed(2) : '--'}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                <input
                                  type="checkbox"
                                  checked={selectedImages.includes(image.id)}
                                  onChange={(e) => handleImageSelect(image.id, e.target.checked)}
                                  className="w-5 h-5 text-green-600 rounded-lg border-gray-300 bg-white shadow-md focus:ring-2 focus:ring-green-500 transition-all duration-200 hover:scale-110"
                                />
                              </div>
                              <div className="absolute top-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setEditingImage(image); }}
                                    className="p-1.5 bg-white rounded-lg shadow-md hover:bg-green-50 text-green-600 transition-colors"
                                    title={t('images.edit')}
                                >
                                    <Edit className="w-4 h-4" />
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <input
                                type="checkbox"
                                checked={selectedImages.includes(image.id)}
                                onChange={(e) => handleImageSelect(image.id, e.target.checked)}
                                className="mr-4 w-5 h-5 text-green-600 rounded-lg border-gray-300 focus:ring-2 focus:ring-green-500 transition-all duration-200 hover:scale-110"
                              />
                              <div className="relative w-16 h-16 flex-shrink-0">
                                <img
                                  src={image.preview_url || image.image_url || image.url}
                                  alt={image.name}
                                  loading="lazy"
                                  className="w-full h-full object-cover rounded-lg cursor-pointer transition-transform duration-300 hover:scale-110"
                                  onClick={() => handleImagePreview(image, globalIndex)}
                                  draggable={!isGuest}
                                  onDragStart={(e) => {
                                    if (isGuest) return;
                                    e.dataTransfer.setData('application/x-image-id', image.id);
                                    if (selectedImages.includes(image.id) && selectedImages.length > 1) {
                                      e.dataTransfer.setData('application/json', JSON.stringify(selectedImages));
                                    }
                                  }}
                                />
                              </div>
                              <div className="flex-1 ml-4">
                                <div className="flex items-center justify-between">
                                  <p className="font-semibold text-gray-900 truncate">{image.name}</p>
                                  <div className="flex space-x-1">
                                    <button
                                        onClick={() => { setEditingImage(image); }}
                                        className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all duration-200"
                                        title={t('images.edit')}
                                    >
                                        <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleImagePreview(image, globalIndex)}
                                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-200"
                                    >
                                        <Eye className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-1 text-sm text-gray-500">
                                  <span className="flex items-center" title={t('images.upload_time')}>
                                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                                    {image.created_time ? new Date(image.created_time).toLocaleString() : ''}
                                  </span>
                                  {image.capture_time && (
                                    <span className="flex items-center" title={t('images.capture_time')}>
                                      <Calendar className="w-3.5 h-3.5 mr-1.5" />
                                      {new Date(image.capture_time).toLocaleString()}
                                    </span>
                                  )}
                                  <span className="flex items-center">
                                    <FileText className="w-3.5 h-3.5 mr-1.5" />
                                    {t('images.size')}: {formatFileSize(image.size)}
                                  </span>
                                  {image.hasPPD && (
                                    <span className={`flex items-center font-medium ${
                                      image.ppdValue !== undefined ? (image.ppdValue >= 7 ? 'text-green-600' : 
                                      image.ppdValue >= 4 ? 'text-yellow-600' : 'text-red-600') : 'text-gray-400'
                                    }`}>
                                      <div className={`w-2.5 h-2.5 rounded-full mr-1.5 ${
                                        image.ppdValue !== undefined ? (image.ppdValue >= 7 ? 'bg-green-500' : 
                                        image.ppdValue >= 4 ? 'bg-yellow-500' : 'bg-red-500') : 'bg-gray-300'
                                      }`}></div>
                                      {t('results.ppd_value')}: {image.ppdValue !== undefined ? image.ppdValue.toFixed(2) : '--'}
                                    </span>
                                  )}
                                </div>
                                {image.lastPrediction && (
                                  <p className="text-xs text-gray-400 mt-1">
                                    {t('images.recent_prediction')}: {image.lastPrediction}
                                  </p>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
                {!isSharedWithMeView && !isMySharesView && hasMoreImages && (
                  <div className={viewMode === 'grid' ? 'col-span-full flex justify-center mt-6' : 'flex justify-center mt-6'}>
                    <Button
                      onClick={() => loadMoreImages?.()}
                      loading={loadingMoreImages}
                      className="px-6"
                    >
                      {loadingMoreImages ? t('common.loading_more') : t('common.load_more')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Alphabet Index Sidebar */}
          {filteredAndSortedImages.length > 0 && (
            <div className="w-12 bg-gradient-to-b from-white to-green-50 border-l border-gray-200 flex flex-col items-center py-4 space-y-1 shadow-sm">
              {groupJumpIndex.map(({ key, index }) => (
                <button
                  key={key}
                  onClick={() => scrollToIndex(index)}
                  className="w-8 h-8 flex items-center justify-center text-xs font-semibold text-gray-600 hover:bg-gradient-to-r from-blue-500 to-blue-600 hover:text-white rounded-full transition-all duration-200 shadow-sm hover:shadow-md"
                  title={t('images.jump_to', { key })}
                >
                  {key}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Image Preview Modal */}
      {showPreviewModal && previewImage && (
        <div className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="relative max-w-7xl max-h-full w-full h-full flex items-center justify-center">
            {/* Close Button */}
            <button
              onClick={() => setShowPreviewModal(false)}
              className="absolute top-6 right-6 p-3 bg-black/50 text-white rounded-full hover:bg-black/70 transition-all duration-300 z-10 backdrop-blur-md hover:shadow-lg hover:scale-110"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Previous Button */}
            <button
              onClick={handlePrevImage}
              className="absolute left-6 top-1/2 transform -translate-y-1/2 p-3 bg-black/50 text-white rounded-full hover:bg-black/70 transition-all duration-300 z-10 backdrop-blur-md hover:shadow-lg hover:scale-110"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            {/* Next Button */}
            <button
              onClick={handleNextImage}
              className="absolute right-6 top-1/2 transform -translate-y-1/2 p-3 bg-black/50 text-white rounded-full hover:bg-black/70 transition-all duration-300 z-10 backdrop-blur-md hover:shadow-lg hover:scale-110"
            >
              <ChevronRight className="w-6 h-6" />
            </button>

            {/* Image */}
            <div className="flex flex-col items-center max-w-full max-h-full">
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 shadow-2xl">
                {previewImage.image_url || previewImage.preview_url || previewImage.url ? (
                  <div className="relative">
                    <img
                      src={previewImage.image_url || previewImage.preview_url || previewImage.url}
                      alt={previewImage.name}
                      className="max-w-full max-h-[80vh] object-contain rounded-lg"
                    />
                    {previewImageLoading && !previewImage.image_url && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/25 rounded-lg text-white/90">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-t-4 border-white/80 mb-4"></div>
                        <p>{t('images.loading')}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-[60vw] max-w-4xl h-[60vh] max-h-[80vh] flex flex-col items-center justify-center text-white/80">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-t-4 border-white/80 mb-4"></div>
                    <p>{t('images.loading')}</p>
                  </div>
                )}
              </div>
              
              {/* Image Info */}
              <div className="mt-6 bg-white/10 backdrop-blur-md text-white p-6 rounded-xl max-w-md shadow-xl border border-white/20">
                <h3 className="font-semibold text-xl mb-4 text-center">{previewImage.name}</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex flex-col">
                    <span className="text-gray-300 text-xs uppercase tracking-wider">{t('images.size')}</span>
                    <span className="font-medium">{formatFileSize(previewImage.size)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-gray-300 text-xs uppercase tracking-wider">{t('prediction.model')}</span>
                    <span className="font-medium">{previewImage.format || '--'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-gray-300 text-xs uppercase tracking-wider">{t('images.upload_time')}</span>
                    <span className="font-medium">{new Date(previewImage.uploadDate || previewImage.created_time || '').toLocaleString()}</span>
                  </div>
                  {previewImage.capture_time && (
                    <div className="flex flex-col">
                      <span className="text-gray-300 text-xs uppercase tracking-wider">{t('images.capture_time')}</span>
                      <span className="font-medium">{new Date(previewImage.capture_time).toLocaleString()}</span>
                    </div>
                  )}
                  {previewImage.hasPPD && (
                    <div className="flex flex-col">
                      <span className="text-gray-300 text-xs uppercase tracking-wider">{t('results.ppd_value')}</span>
                      <span className={`font-medium ${
                        (previewImage.ppdValue ?? 0) >= 7 ? 'text-green-400' : 
                        (previewImage.ppdValue ?? 0) >= 4 ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                        {previewImage.ppdValue !== undefined ? previewImage.ppdValue.toFixed(2) : '--'}
                      </span>
                    </div>
                  )}
                </div>
                {previewImage.lastPrediction && (
                  <div className="mt-4 pt-4 border-t border-white/20">
                    <div className="flex flex-col">
                      <span className="text-gray-300 text-xs uppercase tracking-wider">{t('images.recent_prediction')}</span>
                      <span className="font-medium">{previewImage.lastPrediction}</span>
                    </div>
                  </div>
                )}
                <div className="mt-4 pt-4 border-t border-white/20 text-center text-gray-300">
                  {previewIndex + 1} / {flatImages.length}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      
      {/* Rename Folder Modal */}
      <Modal
        title={t('images.rename_folder')}
        open={showRenameFolderModal}
        onCancel={() => setShowRenameFolderModal(false)}
        onOk={handleRenameFolder}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <div className="space-y-3">
          <Input 
              value={folderRenameValue} 
              onChange={e => setFolderRenameValue(e.target.value)} 
              placeholder={t('images.enter_folder_name')}
              autoFocus
              onPressEnter={handleRenameFolder}
          />
          <Input.TextArea
            placeholder={t('folders.description_placeholder')}
            value={folderRenameDescription}
            onChange={(e) => setFolderRenameDescription(e.target.value)}
            rows={3}
          />
        </div>
      </Modal>

      {/* Delete Folder Modal */}
      <Modal
        title={t('images.delete_folder')}
        open={showDeleteFolderModal}
        onCancel={() => setShowDeleteFolderModal(false)}
        footer={null}
        width={500}
      >
        <div className="p-4">
            <div className="flex items-center gap-3 mb-4 text-red-600 bg-red-50 p-3 rounded-lg">
                <Trash2 className="w-6 h-6" />
                <span className="font-medium">{t('images.confirm_delete_folder')}</span>
            </div>
            
            <p className="mb-4 text-gray-600">
                <span className="font-semibold">{contextFolder?.name}</span> 
                {(contextFolder?.imageCount || 0) > 0 
                    ? ` ${t('images.contains_images', { count: contextFolder?.imageCount || 0 })}`
                    : ` ${t('images.is_empty')}`
                }
            </p>

            <div className="flex flex-col gap-3">
                {(contextFolder?.imageCount || 0) > 0 && (
                    <Button 
                        onClick={() => handleDeleteFolder(false)}
                        className="w-full text-left flex items-center justify-between"
                    >
                        <span>{t('images.delete_folder_keep_images')}</span>
                    </Button>
                )}
                
                <Button 
                    danger 
                    type="primary"
                    onClick={() => handleDeleteFolder(true)}
                    className="w-full text-left flex items-center justify-center"
                >
                     {(contextFolder?.imageCount || 0) > 0 
                        ? t('images.delete_folder_and_images')
                        : t('images.delete_folder')
                     }
                </Button>
            </div>
        </div>
      </Modal>

      {/* Move Modal */}
      {showMoveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl border border-gray-100">
            <h3 className="text-xl font-semibold mb-4 text-gray-900">{t('images.move_to_folder')}</h3>
            <div className="space-y-3 max-h-72 overflow-y-auto">
              <Tree
                treeData={folderTreeData}
                blockNode
                defaultExpandAll
                height={260}
                onSelect={(keys) => {
                  const key = keys?.[0];
                  if (key) handleBatchMove(String(key));
                }}
              />
              {/* Create Folder Area */}
              <div className="flex items-center mt-5 p-3 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                <div className="flex-1 mr-3 space-y-2">
                  <TreeSelect
                    className="w-full"
                    value={(moveModalNewFolderParentId ?? null) === null ? ROOT_NODE_VALUE : moveModalNewFolderParentId}
                    onChange={(v) => setMoveModalNewFolderParentId(v === ROOT_NODE_VALUE || v == null ? null : String(v))}
                    treeData={folderTreeSelectData}
                    treeDefaultExpandAll
                    showSearch
                    placeholder={t('images.choose_folder')}
                    size="small"
                  />
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-300"
                    placeholder={t('images.new_folder_name')}
                    value={moveModalNewFolderName}
                    onChange={e => setMoveModalNewFolderName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreateFolderForMove(); }}
                    disabled={moveModalCreatingFolder}
                  />
                </div>
                <button
                  className="px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 transition-all duration-300 shadow-sm hover:shadow-md disabled:bg-green-400 disabled:cursor-not-allowed"
                  onClick={handleCreateFolderForMove}
                  disabled={moveModalCreatingFolder || !moveModalNewFolderName.trim()}
                >{t('images.create')}</button>
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowMoveModal(false)}
                className="px-5 py-2.5 text-gray-700 hover:text-gray-900 bg-gray-100 rounded-lg hover:bg-gray-200 transition-all duration-300"
              >
                {t('images.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Progress Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl border border-gray-100">
            <h3 className="text-xl font-semibold mb-4 text-gray-900">{t('images.upload_progress')}</h3>
            <div className="space-y-4 max-h-72 overflow-y-auto">
              {uploadProgress.map((item, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate flex-1 mr-3 font-medium text-gray-900">{item.fileName}</span>
                    <span className={`font-semibold ${
                      item.status === 'completed' ? 'text-green-600' : 
                      item.status === 'error' ? 'text-red-600' : 'text-blue-600'
                    }`}>
                      {item.status === 'completed' ? t('images.completed') : 
                       item.status === 'error' ? t('images.failed') : `${item.progress}%`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ease-in-out ${
                        item.status === 'completed' ? 'bg-gradient-to-r from-green-400 to-green-600' :
                        item.status === 'error' ? 'bg-gradient-to-r from-red-400 to-red-600' : 'bg-gradient-to-r from-blue-400 to-blue-600'
                      }`}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create Folder Modal - Separate from Upload */}
      <Modal
        title={t('images.create_folder')}
        open={showCreateFolderModal}
        onCancel={() => setShowCreateFolderModal(false)}
        onOk={handleCreateFolder}
        confirmLoading={creatingFolder}
        okText={t('common.create')}
        cancelText={t('common.cancel')}
      >
        <div className="space-y-3">
          <TreeSelect
            className="w-full"
            value={(createFolderParentId ?? null) === null ? ROOT_NODE_VALUE : createFolderParentId}
            onChange={(v) => setCreateFolderParentId(v === ROOT_NODE_VALUE || v == null ? null : String(v))}
            treeData={folderTreeSelectData}
            treeDefaultExpandAll
            showSearch
            placeholder={t('images.choose_folder')}
          />
          <Input
            placeholder={t('images.folder_name_placeholder')}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onPressEnter={handleCreateFolder}
            autoFocus
          />
          <Input.TextArea
            placeholder={t('folders.description_placeholder')}
            value={newFolderDescription}
            onChange={(e) => setNewFolderDescription(e.target.value)}
            rows={3}
          />
        </div>
      </Modal>

      {/* Upload Config Modal */}
      <Modal
        title={t('images.upload_settings')}
        open={showUploadConfigModal}
        onCancel={() => setShowUploadConfigModal(false)}
        footer={null}
      >
        <div className="space-y-6">
          {/* Target Folder Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('images.upload_to_folder')}</label>
            <TreeSelect
              className="w-full"
              value={(uploadTargetFolder ?? null) === null ? ROOT_NODE_VALUE : uploadTargetFolder}
              onChange={(v) => setUploadTargetFolder(v === ROOT_NODE_VALUE || v == null ? null : String(v))}
              treeData={folderTreeSelectData}
              treeDefaultExpandAll
              showSearch
              placeholder={t('images.select_folder')}
            />
          </div>

          {/* Duplicate Check */}
          <div className="flex items-center justify-between">
            <span className="text-gray-700">{t('images.check_duplicate')}</span>
            <Switch checked={uploadCheckDuplicate} onChange={setUploadCheckDuplicate} />
          </div>

          {/* Rename Settings */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-4">
              <span className="font-medium text-gray-800">{t('images.auto_rename')}</span>
              <Switch checked={renameEnabled} onChange={setRenameEnabled} />
            </div>
            
            {renameEnabled && (
              <div className="space-y-4 bg-gray-50 p-4 rounded-lg">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('images.prefix')}</label>
                  <Input 
                    value={renamePrefix} 
                    onChange={e => setRenamePrefix(e.target.value)} 
                    placeholder={t('images.rename_prefix_placeholder')}
                    size="small"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('images.start_seq')}</label>
                    <InputNumber 
                      min={1} 
                      value={renameStartSeq} 
                      onChange={v => setRenameStartSeq(v || 1)} 
                      size="small"
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('images.digits')}</label>
                    <InputNumber 
                      min={1} 
                      max={10} 
                      value={renameDigits} 
                      onChange={v => setRenameDigits(v || 1)} 
                      size="small"
                      className="w-full"
                    />
                  </div>
                </div>
                <div className="text-xs text-gray-400">
                  {t('images.preview')}: {renamePrefix}{String(renameStartSeq).padStart(renameDigits, '0')}.jpg
                </div>
              </div>
            )}
          </div>

          {/* Upload Area */}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-green-500 hover:bg-green-50 transition-all cursor-pointer group"
               onClick={() => document.getElementById('real-upload-input')?.click()}
               onDragOver={(e) => { e.preventDefault(); }}
               onDrop={handleDrop}
          >
            <input
              type="file"
              id="real-upload-input"
              multiple
              accept="image/*,.zip"
              className="hidden"
              onChange={handleFileUpload}
            />
            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
              <Upload className="w-8 h-8" />
            </div>
            <p className="text-lg font-medium text-gray-800 mb-1">{t('images.click_or_drag_upload')}</p>
            <p className="text-sm text-gray-500">{t('images.support_types')}</p>
          </div>
        </div>
      </Modal>

      {/* Duplicate File Handling Modal */}
      <Modal
        title={t('images.duplicate_handling')}
        open={showDuplicateModal}
        onCancel={() => setShowDuplicateModal(false)}
        onOk={handleDuplicateAction}
        okText={duplicateAction === 'overwrite' ? t('images.overwrite_selected') : t('images.skip_selected')}
        className="rounded-xl shadow-2xl"
      >
        <div className="mb-4 text-gray-700">{t('images.following_files_exist')}</div>
        <div className="mb-4 flex space-x-3">
          <button 
            className={`px-4 py-2 rounded-lg transition-all duration-300 ${duplicateAction==='overwrite'?'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-md':'bg-gray-100 text-gray-700 hover:bg-gray-200'}`} 
            onClick={()=>setDuplicateAction('overwrite')}
          >{t('images.overwrite_all')}</button>
          <button 
            className={`px-4 py-2 rounded-lg transition-all duration-300 ${duplicateAction==='skip'?'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md':'bg-gray-100 text-gray-700 hover:bg-gray-200'}`} 
            onClick={()=>setDuplicateAction('skip')}
          >{t('images.skip_all')}</button>
        </div>
        <div className="max-h-60 overflow-y-auto bg-gray-50 rounded-lg p-3 border border-gray-200">
          {duplicateFiles.map(name => (
            <div key={name} className="flex items-center mb-2 p-2 hover:bg-white rounded-lg transition-all duration-200">
              <input 
                type="checkbox" 
                checked={selectedDuplicates.includes(name)} 
                onChange={e=>{
                  setSelectedDuplicates(e.target.checked ? [...selectedDuplicates,name] : selectedDuplicates.filter(n=>n!==name));
                }} 
                className="w-4 h-4 text-green-600 rounded focus:ring-2 focus:ring-green-500"
              />
              <span className="ml-3 text-gray-800 font-medium">{name}</span>
            </div>
          ))}
        </div>
      </Modal>

      {/* Edit Image Modal */}
      {editingImage && (
        <EditImageModal
          image={editingImage}
          onClose={() => setEditingImage(null)}
          onSave={async (id, data) => {
            await updateImage(id, data);
            setEditingImage(null);
          }}
        />
      )}

      <SmartClassificationModal
        visible={showSmartModal}
        files={smartFiles}
        folders={folders}
        onCancel={() => setShowSmartModal(false)}
        onConfirm={handleSmartConfirm}
      />

      {/* 隐藏的真实上传input */}
      <input
        id="real-upload-input"
        type="file"
        multiple
        accept="image/*,.zip"
        style={{ display: 'none' }}
        onChange={e => {
          setShowUploadConfigModal(false);
          let files = Array.from(e.target.files || []);
          if (files.length > 0) {
            // Apply rename logic
            if (renameEnabled) {
              files = files.map((file, index) => {
                if (file.type.startsWith('image/')) {
                  const extension = file.name.split('.').pop();
                  const seq = (renameStartSeq + index).toString().padStart(renameDigits, '0');
                  const newName = `${renamePrefix}${seq}.${extension}`;
                  return new File([file], newName, { type: file.type });
                }
                return file;
              });
            }

            // Check for ZIP
            const hasZip = files.some(f => f.name.toLowerCase().endsWith('.zip'));
            if (hasZip) {
                // If mixed or single zip, use batch upload directly (skip smart classification for now for simplicity if mixed, or separate)
                // Assuming standard use case: single zip or multiple images
                handleBatchUpload(files, uploadTargetFolder, uploadCheckDuplicate);
            } else {
                setSmartFiles(files);
                setShowSmartModal(true);
            }
          }
          // Reset input value to allow selecting same files again
          e.target.value = '';
        }}
      />
      <input
        id="real-folder-upload-input"
        type="file"
        // @ts-expect-error webkitdirectory is a non-standard attribute
        webkitdirectory=""
        directory=""
        style={{ display: 'none' }}
        onChange={e => {
          setShowUploadConfigModal(false);
          let files = Array.from(e.target.files || []);
          if (files.length > 0) {
             // Apply rename logic for images
             if (renameEnabled) {
               // Sort files to ensure deterministic ordering (e.g. by name) before renaming
               // Folder upload usually gives files in some order, but good to be explicit
               files.sort((a, b) => a.name.localeCompare(b.name));
               
               let imageIndex = 0;
               files = files.map((file) => {
                 if (file.type.startsWith('image/')) {
                   const extension = file.name.split('.').pop();
                   const seq = (renameStartSeq + imageIndex).toString().padStart(renameDigits, '0');
                   const newName = `${renamePrefix}${seq}.${extension}`;
                   imageIndex++;
                   return new File([file], newName, { type: file.type });
                 }
                 return file;
               });
             }

             // For folder upload, usually we skip smart classification modal as folder structure implies organization?
             // But user might want smart tags.
             // Let's use Smart Modal for consistency if it's just images
             // Filter images
             const imageFiles = files.filter(f => f.type.startsWith('image/'));
             if (imageFiles.length > 0) {
                 setSmartFiles(imageFiles);
                 setShowSmartModal(true);
             } else {
                 message.info(t('images.no_images_in_folder'));
             }
          }
          // Reset input value
          e.target.value = '';
        }}
      />
    </div>
  );
};

export default ImageManagement;
