import WorkspacePagination from './WorkspacePagination';
import api from '../services/rest/client';
import BulkCaptureTime from './BulkCaptureTime';
import { message, modal } from '../utils/feedback';
import { useViewState } from '../utils/useViewState';
import RecycleBin from './RecycleBin';
import ImportWorkspace from './ImportWorkspace';
import { workspaceStorageKey } from '../utils/workspaceContext';
import { useNavigate } from 'react-router-dom';
import ImageResolutionLabel from './ImageResolutionLabel';
import React, { useState, useMemo, useEffect, useRef, useDeferredValue } from 'react';
import { Upload, Plus, Trash2, Move, Grid, List, Search, SortAsc, SortDesc, X, ChevronLeft, ChevronRight, Calendar, FolderOpen, FileText, Eye, Share2, Users, Edit, MoreVertical, FolderPlus, Menu } from 'lucide-react';
import { useImageStore } from '../hooks/useImageStore';
import { ppdToneClass } from '../utils/ppdTone';
import { formatPpd } from '../utils/measurement';
import { Modal, Switch, Input, Button, InputNumber, Dropdown, Tree, TreeSelect, Drawer } from 'antd';
import { foldersApi, sharesApi, guestResourcesApi } from '../services/api';
import { useTranslation } from 'react-i18next';
import { Folder, User, Image, ResourceShare } from '../types';

import ShareModal from './ShareModal';
import { EditImageModal } from './EditImageModal';
import { SmartClassificationModal } from './SmartClassificationModal';

interface ImageManagementProps {
  currentUser?: User;
}

const ImageManagement: React.FC<ImageManagementProps> = ({ currentUser }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const imageScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = imageScrollRef.current;
    const timer = window.setTimeout(() => { if (node) node.scrollTop = Number(sessionStorage.getItem(workspaceStorageKey('image-scroll')) || 0); }, 200);
    const save = () => { if (node) sessionStorage.setItem(workspaceStorageKey('image-scroll'), String(node.scrollTop)); };
    node?.addEventListener('scroll', save);
    return () => { window.clearTimeout(timer); node?.removeEventListener('scroll', save); };
  }, []);

  const ROOT_NODE_VALUE = '__root__';
  const {
    folders,
    selectedImages,
    selectedFolder,
    loading,
    setSelectedImages,
    setSelectedFolder,
    uploadImages,
    deleteImages,
    moveImages,
    getFilteredImages,
    uploadFromZip,
    loadFolders,
    loadImages,
    goToImagesPage,
    setImageSearchQuery,
    setImageOrdering,
    imagesPage,
    imagesPageSize,
    totalImages,
    updateImage,
    loadImageDetail,
  } = useImageStore(currentUser?.is_guest);

  const [viewMode, setViewMode] = useViewState<'grid' | 'list'>('image-view-mode', 'grid');
  const [searchQuery, setSearchQuery] = useViewState('image-search', '');
  const [sortBy, setSortBy] = useViewState<'name' | 'date' | 'folder' | 'size' | 'capture_time'>('image-sort', 'date');
  const [sortOrder, setSortOrder] = useViewState<'asc' | 'desc'>('image-sort-order', 'desc');
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [editingImage, setEditingImage] = useState<Image | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Array<{fileName: string, progress: number, status: string}>>([]);
  const [uploadBatchHint, setUploadBatchHint] = useState('');
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
  const [folderTreeExpandedKeys, setFolderTreeExpandedKeys] = useViewState<React.Key[]>('folder-expanded', []);
  const [folderTreeAutoExpandParent, setFolderTreeAutoExpandParent] = useState(true);
  const [folderTreeSearch, setFolderTreeSearch] = useState('');
  const isGuest = currentUser?.is_guest;
  const isSharedWithMeView = selectedFolder === 'shared_with_me';
  const isMySharesView = selectedFolder === 'my_shares';
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const lastImageQueryRef = useRef<{ search: string; ordering: string }>({ search: '', ordering: '-created_at' });

  // 搜索/排序改由后端执行（真实分页），避免只对当前页做过滤造成“搜不到”的错觉
  useEffect(() => {
    if (isSharedWithMeView || isMySharesView) return;
    const orderField =
      sortBy === 'capture_time' ? 'capture_time'
        : sortBy === 'name' ? 'name'
          : sortBy === 'size' ? 'size'
            : 'created_at';
    const ordering = `${sortOrder === 'asc' ? '' : '-'}${orderField}`;
    const search = deferredSearchQuery.trim();
    if (lastImageQueryRef.current.search === search && lastImageQueryRef.current.ordering === ordering) {
      return;
    }
    lastImageQueryRef.current = { search, ordering };
    void setImageSearchQuery(search, ordering);
  }, [deferredSearchQuery, sortBy, sortOrder, isSharedWithMeView, isMySharesView, setImageSearchQuery, setImageOrdering]);

  const [folderDrawerOpen, setFolderDrawerOpen] = useState(false);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [showRenameFolderModal, setShowRenameFolderModal] = useState(false);
  const [inlineFolderId, setInlineFolderId] = useState<string | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState('');
  const [folderRenameDescription, setFolderRenameDescription] = useState('');
  const [contextFolder, setContextFolder] = useState<Folder | null>(null);
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false);
  const [createFolderParentId, setCreateFolderParentId] = useState<string | null>(null);
  const [moveModalNewFolderName, setMoveModalNewFolderName] = useState('');
  const [moveModalNewFolderParentId, setMoveModalNewFolderParentId] = useState<string | null>(null);
  const [moveModalCreatingFolder, setMoveModalCreatingFolder] = useState(false);

  const handleToggleGuestAccess = async (enabled: boolean) => {
    if (selectedImages.length === 0) return;
    
    let successCount = 0;
    const hide = message.loading(t('common.processing'), 0);
    
    try {
        for (const id of selectedImages) {
            try {
                // Check if user is guest before attempting
                if (isGuest) {
                    throw new Error(t('errors.permission_denied'));
                }
                await guestResourcesApi.toggle({
                    resource_type: 'image',
                    resource_id: id,
                    enabled: enabled
                });
                successCount++;
            } catch (e) {
                console.error("Failed to toggle guest access", e);
                // Guest specific error
                if (isGuest) {
                     message.error(t('errors.guest_action_denied'));
                     break; // Stop processing further
                }
            }
        }
        
        if (successCount > 0) {
            message.success(t('images.guest_access_updated'));
            loadImages();
            setSelectedImages([]);
        }
    } finally {
        hide();
    }
  };

  const [showShareModal, setShowShareModal] = useState(false);
  const [sharedWithMeFolders, setSharedWithMeFolders] = useState<Folder[]>([]);
  const [sharedWithMeImages, setSharedWithMeImages] = useState<any[]>([]);
  const [sharedWithMeSelectedFolderId, setSharedWithMeSelectedFolderId] = useState<string | null>(null);
  const [sharedWithMeFolderImages, setSharedWithMeFolderImages] = useState<any[]>([]);
  const [myShares, setMyShares] = useState<ResourceShare[]>([]);
  const [loadingMyShares, setLoadingMyShares] = useState(false);
  const [mySharesSelectedRecipient, setMySharesSelectedRecipient] = useState<string | null>(null);
  const [shareResourceType, setShareResourceType] = useState<'image' | 'folder'>('image');
  const [shareResourceIds, setShareResourceIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isGuest && isSharedWithMeView) {
      sharesApi.sharedWithMe()
        .then((shares) => {
          const folderAggById = new Map<string, { folder: any; sharedBySet: Set<string>; shareTimes: number }>();
          for (const s of shares as any[]) {
            if (s.resource_type !== 'folder' || !s.resource_details) continue;
            const id = String(s.resource_details?.id ?? s.resource_id ?? '');
            if (!id) continue;
            const prev = folderAggById.get(id);
            const baseFolder = prev?.folder ?? {
              ...s.resource_details,
              id,
              imageCount: s.resource_details?.imageCount ?? s.resource_details?.image_count ?? 0,
              createdDate: s.resource_details?.createdDate ?? s.resource_details?.created_at,
              parent:
                s.resource_details?.parent === null || s.resource_details?.parent === undefined
                  ? undefined
                  : String(s.resource_details?.parent),
            };
            const sharedBySet = prev?.sharedBySet ?? new Set<string>();
            const sharedByUsername = String(s.shared_by_username ?? '').trim();
            if (sharedByUsername) sharedBySet.add(sharedByUsername);
            folderAggById.set(id, {
              folder: {
                ...baseFolder,
                permission: s.permission,
                share_id: s.id,
              },
              sharedBySet,
              shareTimes: (prev?.shareTimes ?? 0) + 1,
            });
          }
          const folders = Array.from(folderAggById.values()).map(({ folder, sharedBySet, shareTimes }) => {
            const sharedByUsernames = Array.from(sharedBySet.values());
            const sharedByDisplay =
              sharedByUsernames.length <= 2
                ? sharedByUsernames.join(', ')
                : `${sharedByUsernames[0]}, ${sharedByUsernames[1]} +${sharedByUsernames.length - 2}`;
            return {
              ...folder,
              shared_by: sharedByDisplay,
              shared_by_usernames: sharedByUsernames,
              share_times: shareTimes,
            };
          });

          const images = shares
            .filter(s => s.resource_type === 'image' && s.resource_details)
            .map((s: any) => ({
              ...s.resource_details,
              id: String(s.resource_details?.id ?? s.resource_id ?? ''),
              folderId: s.resource_details?.folderId ?? s.resource_details?.folder ?? s.resource_details?.folder_id,
              created_time: s.resource_details?.created_time ?? s.resource_details?.created_at,
              uploadDate: s.resource_details?.uploadDate ?? s.resource_details?.created_at,
              shared_by: s.shared_by_username,
              permission: s.permission,
              share_id: s.id,
            }));

          setSharedWithMeFolders(folders as any);
          setSharedWithMeImages(images);
          setSharedWithMeSelectedFolderId(null);
          setSharedWithMeFolderImages([]);
        })
        .catch((err) => {
          console.error("Failed to load shared resources", err);
          message.error(t('shares.load_failed'));
        });
    }
  }, [isGuest, isSharedWithMeView, t]);

  useEffect(() => {
    if (!isGuest && isSharedWithMeView && sharedWithMeSelectedFolderId) {
      foldersApi.getImages(sharedWithMeSelectedFolderId)
        .then((imgs) => {
          setSharedWithMeFolderImages(imgs as any);
        })
        .catch((err) => {
          console.error("Failed to load shared folder images", err);
          message.error(t('shares.load_failed'));
        });
    }
  }, [isGuest, isSharedWithMeView, sharedWithMeSelectedFolderId, t]);

  useEffect(() => {
    if (isGuest || !isMySharesView) return;
    setLoadingMyShares(true);
    sharesApi.myShares()
      .then((shares) => {
        const normalized = (shares as any[]).map((s) => {
          const resourceId = String(s.resource_id ?? '');
          const details = s.resource_details ?? undefined;
          if (s.resource_type === 'image' && details) {
            return {
              ...s,
              id: String(s.id),
              resource_id: resourceId,
              resource_details: {
                ...details,
                id: String(details?.id ?? resourceId),
                folderId: details?.folderId ?? details?.folder ?? details?.folder_id,
                created_time: details?.created_time ?? details?.created_at,
                uploadDate: details?.uploadDate ?? details?.created_at,
                image_url: details?.image_url ?? details?.url,
                preview_url: details?.preview_url,
              },
            } as ResourceShare;
          }
          if (s.resource_type === 'folder' && details) {
            return {
              ...s,
              id: String(s.id),
              resource_id: resourceId,
              resource_details: {
                ...details,
                id: String(details?.id ?? resourceId),
                imageCount: details?.imageCount ?? details?.image_count ?? details?.num_images ?? 0,
                createdDate: details?.createdDate ?? details?.created_at,
                parent: details?.parent === null || details?.parent === undefined ? undefined : String(details?.parent),
              },
            } as ResourceShare;
          }
          return { ...s, id: String(s.id), resource_id: resourceId } as ResourceShare;
        });
        setMyShares(normalized);
        setMySharesSelectedRecipient((prev) => {
          if (!prev) return null;
          return normalized.some(s => s.shared_with_username === prev) ? prev : null;
        });
      })
      .catch((err) => {
        console.error("Failed to load my shares", err);
        message.error(t('shares.load_failed'));
      })
      .finally(() => setLoadingMyShares(false));
  }, [isGuest, isMySharesView, t]);

  useEffect(() => {
    if (!isMySharesView) setMySharesSelectedRecipient(null);
  }, [isMySharesView]);

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

  const mySharesByRecipient = useMemo(() => {
    const map = new Map<string, ResourceShare[]>();
    for (const s of myShares) {
      const u = s.shared_with_username || '';
      if (!u) continue;
      const arr = map.get(u) ?? [];
      arr.push(s);
      map.set(u, arr);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
      map.set(k, arr);
    }
    return map;
  }, [myShares]);

  const mySharesRecipients = useMemo(() => {
    return Array.from(mySharesByRecipient.entries())
      .map(([username, items]) => ({ username, count: items.length }))
      .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username));
  }, [mySharesByRecipient]);

  const mySharesFilteredItems = useMemo(() => {
    const items = mySharesSelectedRecipient ? (mySharesByRecipient.get(mySharesSelectedRecipient) ?? []) : myShares;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s: any) => {
      const u = String(s.shared_with_username ?? '').toLowerCase();
      const name = String((s.resource_details as any)?.name ?? '').toLowerCase();
      return u.includes(q) || name.includes(q);
    });
  }, [myShares, mySharesByRecipient, mySharesSelectedRecipient, searchQuery]);

  const mySharesDisplayGroups = useMemo(() => {
    const map = new Map<string, ResourceShare[]>();
    for (const s of mySharesFilteredItems) {
      const u = s.shared_with_username || '';
      if (!u) continue;
      const arr = map.get(u) ?? [];
      arr.push(s);
      map.set(u, arr);
    }
    return Array.from(map.entries())
      .map(([username, items]) => ({
        username,
        items: items.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))),
      }))
      .sort((a, b) => b.items.length - a.items.length || a.username.localeCompare(b.username));
  }, [mySharesFilteredItems]);

  const handleRevokeShare = async (shareId: string) => {
    if (!shareId) return;
    modal.confirm({
      title: t('common.confirm'),
      content: t('shares.revoke'),
      onOk: async () => {
        try {
          await sharesApi.revoke(shareId);
          setMyShares((prev) => prev.filter(s => String(s.id) !== String(shareId)));
          message.success(t('shares.revoke_success'));
        } catch {
          message.error(t('shares.revoke_failed'));
        }
      },
    });
  };


  // Get filtered and sorted images
  const filteredAndSortedImages = useMemo(() => {
    let filtered: any[] = [];
    
    if (isSharedWithMeView) {
      filtered = sharedWithMeSelectedFolderId ? sharedWithMeFolderImages : sharedWithMeImages;
    } else if (isMySharesView) {
      filtered = [];
    } else {
      filtered = (Array.isArray(getFilteredImages()) ? getFilteredImages() : []);
    }

    // Apply search filter（共享视图仍走本地过滤；主列表已由后端搜索，避免二次过滤漏掉按文件夹/备注命中的结果）
    if (isSharedWithMeView || isMySharesView) {
      filtered = filtered.filter(img =>
        img.name.toLowerCase().includes(deferredSearchQuery.toLowerCase())
      );
    }

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
  }, [deferredSearchQuery, getFilteredImages, sortBy, sortOrder, folders, isMySharesView, isSharedWithMeView, sharedWithMeSelectedFolderId, sharedWithMeFolderImages, sharedWithMeImages, t]);

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

  const handleBatchUpload = async (files: File[], folderId?: string|null, checkDuplicate?: boolean) => {
    setShowUploadModal(true);
    setUploadBatchHint('');
    const progressList = files.map(file => ({
      fileName: file.name,
      progress: 0,
      status: 'uploading'
    }));
    setUploadProgress(progressList);

    // Separate ZIP files and image files
    const zipFiles = files.filter(file => file.name.toLowerCase().endsWith('.zip'));
    const imageFiles = files.filter(file => file.type.startsWith('image/'));

    // Process ZIP files
    for (const zipFile of zipFiles) {
      const zipIndex = files.indexOf(zipFile);
      for (let progress = 0; progress <= 100; progress += 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
        setUploadProgress(prev => prev.map((item, index) => 
          index === zipIndex ? { ...item, progress } : item
        ));
      }
      setUploadProgress(prev => prev.map((item, index) => 
        index === zipIndex ? { ...item, status: 'completed' } : item
      ));
      await uploadFromZip(zipFile, folderId, checkDuplicate);
    }

    // 处理图片文件
    let successCount = 0;
    if (imageFiles.length > 0) {
      const baseIndex = files.indexOf(imageFiles[0]);
      const batchSize = 10;
      const totalImages = imageFiles.length;
      try {
        successCount = await uploadImages(imageFiles, folderId, checkDuplicate, {
          batchSize,
          onProgress: (completed, total, batch, batchTotal) => {
            const percent = Math.floor((completed / Math.max(1, total)) * 100);
            setUploadProgress(prev => {
              const next = [...prev];
              imageFiles.forEach((_file, idx) => {
                const globalIndex = baseIndex + idx;
                if (!next[globalIndex]) return;
                const done = idx < completed;
                next[globalIndex] = {
                  ...next[globalIndex],
                  progress: done ? 100 : percent,
                  status: done ? 'completed' : 'uploading',
                };
              });
              return next;
            });
            setUploadBatchHint(
              t('images.upload_batch_progress', {
                batch,
                batches: batchTotal,
                done: completed,
                total: totalImages,
                defaultValue: '第 {{batch}}/{{batches}} 批 · 已上传 {{done}}/{{total}} 张',
              })
            );
          },
        });
      } catch (err: any) {
        if (err?.type === 'duplicate') {
          setDuplicateFiles(err.files);
          setSelectedDuplicates(err.files);
          setPendingUploadFiles(imageFiles); // Store files for retry
          setShowDuplicateModal(true);
        } else {
          const failed = err?.response?.data?.failed;
          const failedDetail = Array.isArray(failed) && failed.length > 0
            ? failed.map((item: any) => `${item.name}: ${item.error}`).join('; ')
            : '';
          const detail = failedDetail || err?.response?.data?.error || err?.response?.data?.message;
          message.error(detail ? String(detail) : t('images.upload_failed'));
          setUploadProgress(prev => prev.map(item => item.status === 'uploading' ? { ...item, status: 'error' } : item));
        }
      }
    }

    setTimeout(() => {
      setShowUploadModal(false);
      setUploadProgress([]);
      setUploadBatchHint('');
    }, 1000);
    
    return successCount + zipFiles.length; // Approximate
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

  const handleSelectAll = () => {
    const visible = filteredAndSortedImages.map(image => image.id);
    if (visible.every(id => selectedImages.includes(id))) setSelectedImages(selectedImages.filter(id => !visible.includes(id)));
    else setSelectedImages([...new Set([...selectedImages, ...visible])]);
  };
  const selectAllMatching = async () => {
    try {
      const folder = selectedFolder === 'root' || selectedFolder === 'uncategorized' ? 'uncategorized' : selectedFolder && /^\d+$/.test(selectedFolder) ? selectedFolder : undefined;
      const { data } = await api.get('/images/selection/', { params: { folder, search: searchQuery } });
      setSelectedImages(data.image_ids.map(String)); message.success(`已选择全部符合条件的 ${data.count} 张图片`);
    } catch (error) { message.error('选择失败，请重试'); }
  };

  const handleBatchDelete = () => {
    if (!selectedImages.length) return;
    modal.confirm({
      title: t('images.delete_title', { defaultValue: '删除图片' }),
      content: `将 ${selectedImages.length} 张图片移入回收站，历史预测和人工修订保留，可随时恢复。`,
      okText: t('common.confirm', { defaultValue: '确认' }),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel', { defaultValue: '取消' }),
      centered: true,
      onOk: () => {
        void deleteImages(selectedImages);
      },
    });
  };

  const handleBatchMove = async (targetFolderId: string) => {
    if (selectedImages.length > 0) {
      await moveImages(selectedImages, targetFolderId);
      setShowMoveModal(false);
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
      setSelectedFolder(String(res.id));
      
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

  const handleRenameFolder = async () => {
    if (!contextFolder || !folderRenameValue.trim()) return;
    try {
      await foldersApi.update(contextFolder.id, { name: folderRenameValue, description: folderRenameDescription });
      await loadFolders?.();
      setShowRenameFolderModal(false); setInlineFolderId(null);
      setFolderRenameValue('');
      setFolderRenameDescription('');
      setContextFolder(null);
      message.success(t('images.folder_renamed'));
    } catch {
      message.error(t('images.rename_failed'));
    }
  };

  const handleDeleteFolder = async () => {
    if (!contextFolder) return;
    try {
      await foldersApi.deleteWithStrategy(contextFolder.id, { strategy: 'delete' });
      await loadFolders?.();
      await loadImages?.({ reset: true });
      
      // If we deleted the currently selected folder, go to root
      if (selectedFolder === contextFolder.id) {
        setSelectedFolder(contextFolder.parent || 'root');
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
      // Re-upload only selected duplicate files with force=1
      const filesToOverwrite = Array.from((document.getElementById('real-upload-input') as HTMLInputElement)?.files || []).filter(f => selectedDuplicates.includes(f.name));
      if (filesToOverwrite.length > 0) {
        // Pass only files, folderId, checkDuplicate; force parameter is controlled by checkDuplicate
        await uploadImages(filesToOverwrite, uploadTargetFolder, false);
      }
    }
    // Skip if action is skip
    setDuplicateFiles([]);
    setSelectedDuplicates([]);
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
    if (!selectedFolder || ['root', 'uncategorized', 'shared_with_me', 'my_shares'].includes(selectedFolder)) return [];
    
    const crumbs = [];
    let currentId: string | undefined = selectedFolder;
    while (currentId) {
      const folder = folders.find(f => f.id === currentId);
      if (folder) {
        crumbs.unshift(folder);
        currentId = folder.parent ?? undefined;
      } else {
        break;
      }
    }
    return crumbs;
  };

  const getCurrentSubfolders = () => {
    // If selectedFolder is null (Root/All Images), show root folders (those with no parent)
    if (selectedFolder === null) return [];
    if (selectedFolder === 'root') {
      return folders.filter(f => !f.parent);
    }
    if (['root', 'uncategorized', 'shared_with_me', 'my_shares'].includes(selectedFolder)) return [];
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

  const sharedWithMeFoldersNormalized = useMemo(() => {
    const ids = new Set(sharedWithMeFolders.map(f => String((f as any).id)));
    return sharedWithMeFolders.map((f: any) => {
      const parentRaw = f.parent === null || f.parent === undefined ? null : String(f.parent);
      const parent = parentRaw && ids.has(parentRaw) ? parentRaw : null;
      return {
        ...f,
        id: String(f.id),
        parent: parent === null ? undefined : parent,
      } as Folder;
    });
  }, [sharedWithMeFolders]);

  const sharedFolderById = useMemo(() => {
    const map = new Map<string, Folder>();
    for (const f of sharedWithMeFoldersNormalized) map.set(String(f.id), f);
    return map;
  }, [sharedWithMeFoldersNormalized]);

  const sharedParentById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const f of sharedWithMeFoldersNormalized) {
      map.set(String(f.id), f.parent === null || f.parent === undefined ? null : String(f.parent));
    }
    return map;
  }, [sharedWithMeFoldersNormalized]);

  const sharedChildrenByParentId = useMemo(() => {
    const map = new Map<string | null, Folder[]>();
    for (const f of sharedWithMeFoldersNormalized) {
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
  }, [sharedWithMeFoldersNormalized]);

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

  const visibleSharedFolderIds = useMemo(() => {
    const q = folderTreeSearch.trim().toLowerCase();
    if (!q) return null;
    const visible = new Set<string>();
    for (const f of sharedWithMeFoldersNormalized) {
      if (!f.name?.toLowerCase().includes(q)) continue;
      const id = String(f.id);
      visible.add(id);
      let p = sharedParentById.get(id) ?? null;
      while (p) {
        visible.add(p);
        p = sharedParentById.get(p) ?? null;
      }
    }
    return visible;
  }, [folderTreeSearch, sharedParentById, sharedWithMeFoldersNormalized]);

  useEffect(() => {
    const q = folderTreeSearch.trim().toLowerCase();
    if (!q) {
      setFolderTreeAutoExpandParent(false);
      return;
    }
    const expand = new Set<React.Key>();
    const targetFolders = isSharedWithMeView ? sharedWithMeFoldersNormalized : folders;
    const targetParentById = isSharedWithMeView ? sharedParentById : parentById;
    for (const f of targetFolders) {
      if (!f.name?.toLowerCase().includes(q)) continue;
      const id = String(f.id);
      let p = targetParentById.get(id) ?? null;
      while (p) {
        expand.add(p);
        p = targetParentById.get(p) ?? null;
      }
    }
    setFolderTreeExpandedKeys(Array.from(expand));
    setFolderTreeAutoExpandParent(true);
  }, [folderTreeSearch, folders, isSharedWithMeView, parentById, sharedParentById, sharedWithMeFoldersNormalized]);

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

  const sharedFolderTreeData = useMemo(() => {
    const build = (parentId: string | null): any[] => {
      const items = sharedChildrenByParentId.get(parentId) ?? [];
      return items
        .filter(f => !visibleSharedFolderIds || visibleSharedFolderIds.has(String(f.id)))
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
  }, [sharedChildrenByParentId, visibleSharedFolderIds]);

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
      } catch {
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
        className="relative flex items-center justify-between w-full group min-w-0"
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
          <FolderOpen className={`w-4 h-4 mr-2 flex-shrink-0 ${isSelected ? 'text-accent-text' : 'text-accent-text'}`} />
          <span className={`truncate text-sm ${isSelected ? 'font-semibold text-blue-700' : 'font-medium text-ink-secondary'}`}>
            {inlineFolderId === folder.id ? <Input autoFocus size="small" aria-label="文件夹新名称" value={folderRenameValue} onChange={event => setFolderRenameValue(event.target.value)} onClick={event => event.stopPropagation()} onPressEnter={() => void handleRenameFolder()} onBlur={() => void handleRenameFolder()} onKeyDown={event => { if (event.key === 'Escape') setInlineFolderId(null); event.stopPropagation(); }} /> : folder.name}
          </span>
        </div>
        <div className="flex items-center flex-shrink-0">
          <span className={`text-xs px-1.5 py-0.5 rounded-full ml-2 ${isSelected ? 'bg-[rgba(10,132,255,0.08)] text-blue-700' : 'bg-surface-sunken text-ink-secondary'}`}>
            {folder.imageCount}
          </span>
          {!isGuest && (
            <div className="absolute right-0 top-0 hidden h-full items-center rounded-md bg-white px-1 shadow-sm group-hover:flex group-focus-within:flex">
              <button
                className="p-1 rounded hover:bg-white"
                aria-label={t('a11y.create_subfolder', { name: folder.name })}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCreateFolderParentId(folder.id);
                  setNewFolderName('');
                  setNewFolderDescription('');
                  setShowCreateFolderModal(true);
                }}
              >
                <FolderPlus className="w-3.5 h-3.5 text-muted" />
              </button>
              <button
                className="p-1 rounded hover:bg-white"
                aria-label={t('a11y.rename_folder', { name: folder.name })}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextFolder(folder);
                  setFolderRenameValue(folder.name);
                  setFolderRenameDescription(folder.description || '');
                  setInlineFolderId(folder.id);
                }}
              >
                <Edit className="w-3.5 h-3.5 text-muted" />
              </button>
              <button
                className="p-1 rounded hover:bg-white"
                aria-label={t('a11y.delete_folder', { name: folder.name })}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextFolder(folder);
                  setShowDeleteFolderModal(true);
                }}
              >
                <Trash2 className="w-3.5 h-3.5 text-muted" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSharedFolderTreeTitle = (node: any) => {
    const folderId = String(node.folderId ?? node.key);
    const folder = sharedFolderById.get(folderId);
    if (!folder) return null;
    const isSelected = sharedWithMeSelectedFolderId === folderId;
    const sharedBy = String((folder as any).shared_by ?? '').trim();
    const shareTimes = Number((folder as any).share_times ?? 0);
    const metaParts = [
      ...(sharedBy ? [t('shares.shared_by', { username: sharedBy })] : []),
      ...(shareTimes > 0 ? [t('shares.shared_times', { count: shareTimes })] : []),
    ];
    return (
      <div className="flex items-center justify-between w-full min-w-0">
        <div className="flex items-center min-w-0">
          <FolderOpen className={`w-4 h-4 mr-2 flex-shrink-0 ${isSelected ? 'text-accent-text' : 'text-accent-text'}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`truncate text-sm ${isSelected ? 'font-semibold text-blue-700' : 'font-medium text-ink-secondary'}`}>
                {folder.name}
              </span>
              {(folder as any).permission && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-[rgba(10,132,255,0.08)] text-blue-700' : 'bg-surface-sunken text-ink-secondary'}`}>
                  {permissionLabel((folder as any).permission)}
                </span>
              )}
            </div>
            {metaParts.length > 0 && (
              <div className="truncate text-xs text-muted">
                {metaParts.join(' · ')}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center flex-shrink-0">
          <span className={`text-xs px-1.5 py-0.5 rounded-full ml-2 ${isSelected ? 'bg-[rgba(10,132,255,0.08)] text-blue-700' : 'bg-surface-sunken text-ink-secondary'}`}>
            {folder.imageCount}
          </span>
        </div>
      </div>
    );
  };

  const folderSidebar = (
    <div className="flex h-full w-full flex-col bg-white">
        <div className="p-4 border-b border-hairline bg-white">
          {!isGuest && (
          <button 
            onClick={() => {
              setNewFolderName('');
              setNewFolderDescription('');
              const parent =
                selectedFolder && !['root', 'uncategorized', 'shared_with_me', 'my_shares'].includes(selectedFolder)
                  ? selectedFolder
                  : null;
              setCreateFolderParentId(parent);
              setShowCreateFolderModal(true);
            }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-brand-fill text-white text-sm font-medium transition-all duration-200 hover:bg-brand-fill-hover active:scale-[0.98]">
            <Plus className="w-4 h-4 mr-2" />
            {t('images.create_folder')}
          </button>
          )}
        </div>
        
        <div className="flex-1 min-w-0 p-2 overflow-y-auto overflow-x-hidden">
          <button
            onClick={() => setSelectedFolder(null)}
            className={`w-full text-left px-3 py-2 rounded-lg mb-1 transition-all duration-200 ${
              selectedFolder === null ? 'bg-brand-fill text-white shadow-sm' : 'hover:bg-surface-sunken'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{t('images.all_images')}</span>
              {selectedFolder === null && <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-current">{totalImages}</span>}
            </div>
          </button>
          <button
            onClick={() => setSelectedFolder('uncategorized')}
            className={`w-full text-left px-3 py-2 rounded-lg mb-1 transition-all duration-200 ${
              selectedFolder === 'uncategorized' ? 'bg-brand-fill text-white shadow-sm' : 'hover:bg-surface-sunken'
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
                      } catch {
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
              {['root', 'uncategorized'].includes(selectedFolder || '') && <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-current">{totalImages}</span>}
            </div>
          </button>
          
          {!isGuest && (
          <button
            onClick={() => setSelectedFolder('shared_with_me')}
            className={`w-full text-left px-3 py-2 rounded-lg mb-1 transition-all duration-200 ${
              selectedFolder === 'shared_with_me' ? 'bg-brand-fill text-white shadow-sm' : 'hover:bg-surface-sunken'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium flex items-center gap-2">
                 <Users className="w-4 h-4" />
                 {t('shares.shared_with_me')}
              </span>
            </div>
          </button>
          )}

          {!isGuest && (
          <button
            onClick={() => setSelectedFolder('my_shares')}
            className={`w-full text-left px-3 py-2 rounded-lg mb-1 transition-all duration-200 ${
              selectedFolder === 'my_shares' ? 'bg-brand-fill text-white shadow-sm' : 'hover:bg-surface-sunken'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium flex items-center gap-2">
                 <Share2 className="w-4 h-4" />
                 {t('shares.my_shares')}
              </span>
              {myShares.length > 0 && (
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-current">{myShares.length}</span>
              )}
            </div>
          </button>
          )}
          
          <div className="border-t border-hairline my-2"></div>

          <div className="px-2 pb-2">
            <Input
              value={folderTreeSearch}
              onChange={(e) => setFolderTreeSearch(e.target.value)}
              allowClear
              size="small"
              placeholder={isMySharesView ? t('shares.search_recipient') : t('images.search_folder')}
              aria-label={isMySharesView ? t('shares.search_recipient') : t('images.search_folder')}
            />
          </div>

          <div className="px-1">
            {isMySharesView ? (
              <div className="space-y-1">
                <button
                  onClick={() => setMySharesSelectedRecipient(null)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-all duration-200 ${
                    mySharesSelectedRecipient === null ? 'bg-[rgba(10,132,255,0.08)] text-blue-700' : 'hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t('common.all')}</span>
                    <span className="text-xs text-muted">{myShares.length}</span>
                  </div>
                </button>
                {mySharesRecipients
                  .filter(({ username }) => {
                    const q = folderTreeSearch.trim().toLowerCase();
                    if (!q) return true;
                    return username.toLowerCase().includes(q);
                  })
                  .map(({ username, count }) => (
                    <button
                      key={username}
                      onClick={() => setMySharesSelectedRecipient(username)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-all duration-200 ${
                        mySharesSelectedRecipient === username ? 'bg-[rgba(10,132,255,0.08)] text-blue-700' : 'hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate">{username}</span>
                        <span className="text-xs text-muted">{count}</span>
                      </div>
                    </button>
                  ))}
              </div>
            ) : (
              <Tree
                className="folder-tree image-folder-tree"
                treeData={isSharedWithMeView ? sharedFolderTreeData : folderTreeData}
                titleRender={isSharedWithMeView ? renderSharedFolderTreeTitle : renderFolderTreeTitle}
                draggable={!isGuest && !isSharedWithMeView ? { icon: false } : false}
                blockNode
                expandedKeys={folderTreeExpandedKeys}
                autoExpandParent={folderTreeAutoExpandParent}
                onExpand={(keys) => {
                  setFolderTreeExpandedKeys(keys as React.Key[]);
                  setFolderTreeAutoExpandParent(false);
                }}
                selectedKeys={
                  isSharedWithMeView
                    ? (sharedWithMeSelectedFolderId ? [sharedWithMeSelectedFolderId] : [])
                    : (selectedFolder && !['root', 'uncategorized', 'shared_with_me', 'my_shares'].includes(selectedFolder) ? [selectedFolder] : [])
                }
                onSelect={(keys) => {
                  const key = keys?.[0];
                  if (isSharedWithMeView) {
                    setSharedWithMeSelectedFolderId(key ? String(key) : null);
                  } else {
                    if (key) setSelectedFolder(String(key));
                  }
                }}
                onDrop={isSharedWithMeView ? undefined : handleFolderTreeDrop}
              />
            )}
          </div>
        </div>
    </div>
  );

  return (
    <div className="h-full flex">
      <div className="hidden w-64 shrink-0 border-r border-hairline bg-white sm:flex">{folderSidebar}</div>

      {/* Main Content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="image-workspace-toolbar shrink-0 border-b border-hairline bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-2 empty:hidden">
            <div className="flex min-w-0 items-center gap-2">

              {getBreadcrumbs().map((folder, index) => (
                <React.Fragment key={folder.id}>
                  <ChevronRight className="w-5 h-5 text-muted" />
                  <span 
                    className={`text-lg font-medium cursor-pointer hover:text-accent-text ${
                      index === getBreadcrumbs().length - 1 ? 'text-ink' : 'text-muted'
                    }`}
                    onClick={() => setSelectedFolder(folder.id)}
                  >
                    {folder.name}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Search and Actions */}
          <div className="image-main-toolbar flex flex-wrap items-center justify-end gap-3">
            <div className="image-search-tools flex min-w-0 flex-1 items-center gap-3">
              <button
                onClick={() => setFolderDrawerOpen(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline-strong text-ink-secondary transition-colors hover:bg-surface-sunken sm:hidden"
                aria-label={t('a11y.toggle_folders')}
                aria-expanded={folderDrawerOpen}
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="relative min-w-[140px] max-w-sm flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted w-5 h-5" />
                <input
                  type="text"
                  placeholder={t('images.search')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-hairline-strong rounded-lg focus:ring-2 focus:ring-accent-line focus:border-transparent text-sm shadow-sm hover:shadow-md transition-all duration-200"
                />
              </div>
              
              {/* Toolbar: sort / group / view */}
              <div className="image-view-tools ml-auto flex shrink-0 items-center gap-1">
                <div className="hidden items-center gap-1 sm:flex">
                <select
                  value={sortBy}
                  aria-label={t('a11y.sort_by')}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="h-9 rounded-md border-0 bg-transparent px-2 text-xs text-ink-secondary outline-none hover:bg-surface-muted focus:ring-2 focus:ring-accent-line"
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
                    aria-label={t('a11y.group_by')}
                    onChange={e => setDateGroupType(e.target.value as any)}
                    className="h-9 rounded-md border-0 bg-transparent px-2 text-xs text-ink-secondary outline-none hover:bg-surface-muted focus:ring-2 focus:ring-accent-line"
                  >
                    <option value="year">{t('images.group.year')}</option>
                    <option value="month">{t('images.group.month')}</option>
                    <option value="day">{t('images.group.day')}</option>
                  </select>
                )}
                <button
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  aria-label={t('a11y.sort_order')}
                  className="rounded-md p-2 text-muted transition-colors hover:bg-surface-muted hover:text-accent-text"
                >
                  {getSortIcon()}
                </button>
                </div>
                <span className="mx-1 hidden h-5 w-px bg-hairline-strong sm:block" />
                <div className="flex items-center gap-0.5 rounded-lg bg-surface-muted p-0.5">
                  <button
                    onClick={() => setViewMode('grid')}
                    aria-label={t('a11y.grid_view')}
                    aria-pressed={viewMode === 'grid'}
                    className={`rounded-lg p-2 transition-all duration-200 ${viewMode === 'grid' ? 'bg-brand-fill text-white shadow-sm' : 'text-ink-secondary hover:bg-white'}`}
                  >
                    <Grid className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    aria-label={t('a11y.list_view')}
                    aria-pressed={viewMode === 'list'}
                    className={`rounded-lg p-2 transition-all duration-200 ${viewMode === 'list' ? 'bg-brand-fill text-white shadow-sm' : 'text-ink-secondary hover:bg-white'}`}
                  >
                    <List className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
            
            <div className="image-primary-actions ml-auto flex flex-wrap items-center justify-end gap-2">
              {selectedFolder && !['root', 'uncategorized', 'shared_with_me', 'my_shares'].includes(selectedFolder) && !isGuest && (
                <button
                  onClick={() => {
                      setShareResourceType('folder');
                      setShareResourceIds([selectedFolder]);
                      setShowShareModal(true);
                  }}
                  className="flex items-center px-3 py-2 bg-white text-ink-secondary rounded-lg transition-all duration-200 shadow-sm hover:shadow-md transform hover:-translate-y-0.5 text-sm"
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  <span>{t('shares.share_folder')}</span>
                </button>
              )}
              {selectedImages.length > 0 && !isGuest && (
                <>
                  <span className="hidden sm:block text-sm font-medium text-ink-secondary card px-3 py-2 rounded-lg shadow-sm border">{t('images.selected_items', { count: selectedImages.length })}</span>
                  <button
                    onClick={() => {
                        setShareResourceType('image');
                        setShareResourceIds(selectedImages);
                        setShowShareModal(true);
                    }}
                    className="flex items-center px-3 py-2 bg-white text-ink-secondary rounded-lg transition-all duration-200 shadow-sm hover:shadow-md transform hover:-translate-y-0.5 text-sm"
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    <span>{t('shares.share')}</span>
                  </button>
                  <button
                    onClick={() => handleToggleGuestAccess(true)}
                    className="flex items-center px-3 py-2 bg-white text-ink-secondary rounded-lg transition-all duration-200 shadow-sm hover:shadow-md transform hover:-translate-y-0.5 text-sm"
                  >
                    <Users className="w-4 h-4 mr-2" />
                    <span>{t('images.add_to_public')}</span>
                  </button>
                  <button
                    onClick={() => handleToggleGuestAccess(false)}
                    className="flex items-center px-3 py-2 bg-white text-ink-secondary rounded-lg transition-all duration-200 shadow-sm hover:shadow-md transform hover:-translate-y-0.5 text-sm"
                  >
                    <Users className="w-4 h-4 mr-2" />
                    <span>{t('images.remove_from_public')}</span>
                  </button>
                  <button
                    onClick={() => setShowMoveModal(true)}
                    className="flex items-center px-3 py-2 bg-brand-fill text-white rounded-lg transition-all duration-200 shadow-sm hover:shadow-md transform hover:-translate-y-0.5 text-sm"
                  >
                    <Move className="w-4 h-4 mr-2" />
                    <span>{t('images.move')}</span>
                  </button>
                  <button
                    onClick={handleBatchDelete}
                    className="flex items-center px-3 py-2 bg-white text-ink-secondary rounded-lg transition-all duration-200 shadow-sm hover:shadow-md transform hover:-translate-y-0.5 text-sm"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    <span>{t('images.delete')}</span>
                  </button>
                </>
              )}
              {!isGuest && <RecycleBin onChange={() => { void loadImages({ page: imagesPage }); void loadFolders(); }} />}
              {!isGuest && <ImportWorkspace folders={folders} onComplete={() => { void loadImages({ page: imagesPage }); void loadFolders(); }} />}
              {!isGuest && selectedImages.length > 0 && <BulkCaptureTime ids={selectedImages} onDone={() => void loadImages({ page: imagesPage })} />}
              {!isGuest && selectedImages.length > 0 && <Button onClick={() => navigate('/prediction')}>预测所选 {selectedImages.length} 张</Button>}

            </div>
          </div>
        </div>

        {/* Content with Alphabet Index */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Main Content Area */}
          <div className="flex-1 min-w-0 p-4 overflow-y-auto overflow-x-hidden" ref={imageScrollRef}>
            
            {isMySharesView ? (
              <div className="space-y-4">
                <div className="card rounded-lg shadow-sm p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Share2 className="w-5 h-5 text-accent-text flex-shrink-0" />
                      <span className="font-semibold text-ink">{t('shares.my_shares')}</span>
                      {mySharesSelectedRecipient && (
                        <span className="text-sm text-muted truncate">({mySharesSelectedRecipient})</span>
                      )}
                    </div>
                    <div className="text-sm text-ink-secondary">
                      {t('shares.total_shares', { count: mySharesFilteredItems.length })}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="text-xs px-2 py-1 rounded-full bg-surface-sunken text-ink-secondary">
                      {t('shares.total_recipients', { count: mySharesRecipients.length })}
                    </span>
                  </div>
                </div>

                {loadingMyShares ? (
                  <div className="flex flex-col items-center justify-center h-64 card rounded-lg shadow-sm">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-t-4 border-green-600 mb-4"></div>
                    <p className="text-ink-secondary">{t('images.loading')}</p>
                  </div>
                ) : mySharesFilteredItems.length === 0 ? (
                  <div className="text-center py-16 card rounded-lg shadow-sm">
                    <div className="mx-auto w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mb-4">
                      <Search className="w-8 h-8 text-muted" />
                    </div>
                    <h3 className="text-lg font-medium text-ink mb-2">{t('shares.no_shares')}</h3>
                    <p className="text-muted">{t('shares.no_shares_desc')}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {mySharesDisplayGroups.map(({ username, items }) => (
                      <div key={username} className="card rounded-lg shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 bg-surface-muted border-b border-hairline">
                          <div className="font-semibold text-ink truncate">{username}</div>
                          <div className="text-sm text-ink-secondary">{items.length}</div>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {items.map((s: any) => {
                            const details: any = s.resource_details ?? {};
                            const name = String(details?.name ?? s.resource_id ?? '');
                            const thumb = s.resource_type === 'image' ? (details?.preview_url ?? details?.image_url ?? details?.url) : undefined;
                            const createdAt = s.created_at ? new Date(s.created_at).toLocaleString() : '';
                            const expiresAt = s.expires_at ? new Date(s.expires_at).toLocaleString() : '';
                            return (
                              <div key={String(s.id)} className="flex items-center justify-between gap-3 px-4 py-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  {thumb ? (
                                    <img src={thumb} alt={name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                                  ) : s.resource_type === 'folder' ? (
                                    <FolderOpen className="w-6 h-6 text-accent-text flex-shrink-0" />
                                  ) : (
                                    <FileText className="w-6 h-6 text-muted flex-shrink-0" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="font-medium text-ink truncate">{name}</span>
                                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface-sunken text-ink-secondary">
                                        {permissionLabel(s.permission)}
                                      </span>
                                    </div>
                                    <div className="text-xs text-muted">
                                      {createdAt}
                                      {expiresAt ? ` · ${t('shares.expires_at')}: ${expiresAt}` : ''}
                                    </div>
                                  </div>
                                </div>
                                <Button size="small" onClick={() => handleRevokeShare(String(s.id))}>
                                  {t('shares.revoke')}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
            <>
            {/* Selection Controls */}
            {filteredAndSortedImages.length > 0 && (
              <div className="mb-3 flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline pb-3 text-xs">
                <label className="flex items-center cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={filteredAndSortedImages.length > 0 && filteredAndSortedImages.every(image => selectedImages.includes(image.id))}
                    onChange={handleSelectAll}
                    className="mr-3 w-5 h-5 text-accent-text rounded-lg border-hairline-strong focus:ring-2 focus:ring-accent-line transition-all duration-200 group-hover:scale-110"
                  />
                  <span className="text-sm font-medium text-ink-secondary group-hover:text-accent-text transition-colors">全选本页</span>
                </label>
                {selectedImages.length > 0 && <span className="font-medium text-ink">已选 {selectedImages.length} 张</span>}
                {!isGuest && filteredAndSortedImages.every(image => selectedImages.includes(image.id)) && selectedImages.length < totalImages && totalImages > filteredAndSortedImages.length && <button className="text-accent-text hover:underline" onClick={() => void selectAllMatching()}>全选{searchQuery.trim() ? '搜索结果' : selectedFolder === null ? '全部图片' : '当前目录'}（{totalImages} 张）</button>}
                {selectedImages.length > 0 && <button className="text-muted hover:text-ink" onClick={() => setSelectedImages([])}>取消选择</button>}
                <div className="ml-auto text-muted">本页 {filteredAndSortedImages.length} 张 · 共 {totalImages} 张</div>
              </div>
            )}

            {/* Subfolders Grid */}
            {getCurrentSubfolders().length > 0 && (
              <div className="mb-4">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">{t('images.folders')}</h3>
                <div className="grid grid-cols-2 gap-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
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
                        className="group relative flex cursor-pointer items-center gap-2 rounded-lg border border-hairline bg-white px-2.5 py-2 text-left transition-colors hover:border-accent-line/40 hover:bg-surface-muted"
                        >
                        <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Dropdown menu={getFolderMenuItems(folder)} trigger={['click']}>
                                <div className="p-1 hover:bg-white rounded-full" onClick={e => e.stopPropagation()}>
                                    <MoreVertical className="w-4 h-4 text-muted" />
                                </div>
                            </Dropdown>
                        </div>
                        <FolderOpen className="h-4 w-4 shrink-0 text-accent-text/70 transition-colors group-hover:text-accent-text" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-secondary group-hover:text-accent-text">{folder.name}</span>
                        <span className="shrink-0 text-xs text-muted group-hover:opacity-0">{folder.imageCount}</span>
                        </div>
                    </Dropdown>
                  ))}
                </div>
                <div className="my-4 border-b border-hairline"></div>
              </div>
            )}

            {/* Images Grid/List */}
            {loading ? (
              <div className="flex flex-col items-center justify-center h-64 card rounded-lg shadow-sm">
                <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-t-4 border-green-600 mb-4"></div>
                <p className="text-ink-secondary">{t('images.loading')}</p>
              </div>
            ) : filteredAndSortedImages.length === 0 && getCurrentSubfolders().length === 0 ? (
              <div className="text-center py-16 card rounded-lg shadow-sm">
                <div className="mx-auto w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mb-4">
                  <Search className="w-8 h-8 text-muted" />
                </div>
                <h3 className="text-lg font-medium text-ink mb-2">{t('images.no_images_found')}</h3>
                <p className="text-muted">{searchQuery ? t('images.no_match') : t('images.no_images')}</p>
              </div>
            ) : (
              <div className={viewMode === 'grid' 
                ? 'grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3'
                : 'space-y-3'
              }>
                {groupedImages.map(group => (
                  <React.Fragment key={group.key}>
                    {group.key && (
                      <div id={`group-divider-${group.key}`} className="col-span-full my-3 flex items-center">
                        <div className="flex-1 border-t-2 border-dashed border-hairline-strong"></div>
                        <span className="mx-4 text-ink-secondary text-sm font-semibold card px-4 py-1 rounded-full shadow-sm">{group.key}</span>
                        <div className="flex-1 border-t-2 border-dashed border-hairline-strong"></div>
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
                              ? `group relative card rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 border overflow-hidden ${ selectedImages.includes(image.id) ? 'ring-3 ring-accent-line border-accent-line shadow-2xl' : '' }`
                              : `flex items-center p-4 card rounded-xl hover:shadow-md transition-all duration-300 ${ selectedImages.includes(image.id) ? 'bg-surface-muted border-accent-line' : '' }`
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
                                    aria-label={t('a11y.preview_image', { name: image.name })}
                        className="p-3 rounded-full bg-white shadow-lg transform scale-0 group-hover:scale-100 transition-transform duration-300 hover:bg-[rgba(10,132,255,0.08)]"
                                  >
                                    <Eye className="w-5 h-5 text-accent-text" />
                                  </button>
                                </div>
                                {image.is_guest_accessible && (
                                  <div className="absolute top-2 right-2 bg-[rgba(10,132,255,0.08)] text-white text-xs px-2 py-1 rounded-full shadow-md">
                                    {t('common.public')}
                                  </div>
                                )}
                              </div>
                              <div className="px-2.5 pb-2 pt-1.5">
                                <p className="truncate text-xs font-semibold text-ink" title={image.name}>
                                  {image.name}
                                </p>
                                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted" title={`${image.created_time ? new Date(image.created_time).toLocaleString() : ''}`}>
                                  <ImageResolutionLabel width={image.pixel_width} height={image.pixel_height} />
                                  <span className="text-hairline-strong" aria-hidden="true">·</span>
                                  <span className="truncate">{formatFileSize(image.size)}</span>
                                </div>
                                <p className="mt-1 truncate text-xs text-muted" title={image.capture_time || '拍摄时间未提供'}>{image.capture_time ? `拍摄 ${new Date(image.capture_time).toLocaleString()} · ${image.capture_time_source === 'manual' ? '人工填写' : image.capture_time_source === 'exif' ? 'EXIF' : '来源未记录'}` : '拍摄时间未提供'}</p>
                                {image.hasPPD && (
                                  <div className="mt-1 flex items-center">
                                    <div className={`w-3 h-3 rounded-full mr-2 ${
                                      ppdToneClass(image.ppdValue, 'dot')
                                    }`}></div>
                                    <span className="text-xs font-medium text-ink-secondary">
                                      {t('results.ppd_value')}: {image.ppdValue !== undefined ? formatPpd(image.ppdValue) : '--'}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                <input
                                  type="checkbox"
                                  aria-label={t('a11y.select_image', { name: image.name })}
                                  checked={selectedImages.includes(image.id)}
                                  onChange={(e) => handleImageSelect(image.id, e.target.checked)}
                                  className="w-5 h-5 text-accent-text rounded-lg border-hairline-strong bg-white shadow-md focus:ring-2 focus:ring-accent-line transition-all duration-200 hover:scale-110"
                                />
                              </div>
                              <div className="absolute top-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setEditingImage(image); }}
                                    className="p-1.5 rounded-lg bg-white shadow-md hover:bg-[rgba(10,132,255,0.08)] text-brand-fill-hover transition-colors"
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
                                  aria-label={t('a11y.select_image', { name: image.name })}
                                checked={selectedImages.includes(image.id)}
                                onChange={(e) => handleImageSelect(image.id, e.target.checked)}
                                className="mr-4 w-5 h-5 text-accent-text rounded-lg border-hairline-strong focus:ring-2 focus:ring-accent-line transition-all duration-200 hover:scale-110"
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
                                  <p className="font-semibold text-ink truncate">{image.name}</p>
                                  <ImageResolutionLabel width={image.pixel_width} height={image.pixel_height} />
                                  <div className="flex space-x-1">
                                    <button
                                        onClick={() => { setEditingImage(image); }}
                                        className="p-2 text-muted hover:text-accent-text hover:bg-[rgba(10,132,255,0.08)] rounded-lg transition-all duration-200"
                                        title={t('images.edit')}
                                    >
                                        <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleImagePreview(image, globalIndex)}
                                        className="p-2 text-muted hover:text-accent-text hover:bg-[rgba(10,132,255,0.08)] rounded-lg transition-all duration-200"
                                    >
                                        <Eye className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-1 text-sm text-muted">
                                  <span className="flex items-center" title={t('images.upload_time')}>
                                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                                    {image.created_time ? new Date(image.created_time).toLocaleString() : ''}
                                  </span>
                                  {true && (
                                    <span className="flex items-center" title={t('images.capture_time')}>
                                      <Calendar className="w-3.5 h-3.5 mr-1.5" />
                                      {image.capture_time ? new Date(image.capture_time).toLocaleString() : '拍摄时间未提供'}
                                    </span>
                                  )}
                                  <span className="flex items-center">
                                    <FileText className="w-3.5 h-3.5 mr-1.5" />
                                    {t('images.size')}: {formatFileSize(image.size)}
                                  </span>
                                  {image.hasPPD && (
                                    <span className={`flex items-center font-medium ${
                                      ppdToneClass(image.ppdValue, 'text')
                                    }`}>
                                      <div className={`w-2.5 h-2.5 rounded-full mr-1.5 ${
                                        ppdToneClass(image.ppdValue, 'dot')
                                      }`}></div>
                                      {t('results.ppd_value')}: {image.ppdValue !== undefined ? formatPpd(image.ppdValue) : '--'}
                                    </span>
                                  )}
                                </div>
                                {image.lastPrediction && (
                                  <p className="text-xs text-muted mt-1">
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

              </div>
            )}
            </>
            )}
          </div>

          {/* Alphabet Index Sidebar */}
          {filteredAndSortedImages.length > 0 && groupJumpIndex.length > 1 && (
            <nav
              aria-label={t('a11y.jump_index')}
              className="hidden w-[68px] shrink-0 flex-col items-center gap-1 self-start rounded-[10px] border border-hairline bg-white py-2 lg:flex"
            >
              {groupJumpIndex.map(({ key, index }) => (
                <button
                  key={key}
                  onClick={() => scrollToIndex(index)}
                  className="flex h-6 w-full items-center justify-center rounded-full text-xs font-medium tabular-nums text-muted transition-colors hover:bg-brand-fill hover:text-white"
                  title={t('images.jump_to', { key })}
                >
                  {key}
                </button>
              ))}
            </nav>
          )}
        </div>
        {!isSharedWithMeView && !isMySharesView && <WorkspacePagination page={imagesPage} pageSize={imagesPageSize} total={totalImages} onChange={(page, size) => void goToImagesPage(page, size)} />}
      </div>

      <Drawer
        placement="left"
        open={folderDrawerOpen}
        onClose={() => setFolderDrawerOpen(false)}
        width={288}
        styles={{ body: { padding: 0 } }}
      >
        {folderSidebar}
      </Drawer>

      {/* Image Preview Modal */}
      {showPreviewModal && previewImage && (
        <div className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center p-4 z-50">
          <div className="relative max-w-7xl max-h-full w-full h-full flex items-center justify-center">
            {/* Close Button */}
            <button
              onClick={() => setShowPreviewModal(false)}
              className="absolute top-6 right-6 p-3 bg-black/50 text-white rounded-full hover:bg-black/70 transition-all duration-300 z-10 hover:shadow-lg hover:scale-110"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Previous Button */}
            <button
              onClick={handlePrevImage}
              className="absolute left-6 top-1/2 transform -translate-y-1/2 p-3 bg-black/50 text-white rounded-full hover:bg-black/70 transition-all duration-300 z-10 hover:shadow-lg hover:scale-110"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            {/* Next Button */}
            <button
              onClick={handleNextImage}
              className="absolute right-6 top-1/2 transform -translate-y-1/2 p-3 bg-black/50 text-white rounded-full hover:bg-black/70 transition-all duration-300 z-10 hover:shadow-lg hover:scale-110"
            >
              <ChevronRight className="w-6 h-6" />
            </button>

            {/* Image */}
            <div className="flex flex-col items-center max-w-full max-h-full">
              <div className="bg-white/5 rounded-xl p-4 shadow-2xl">
                {previewImage.image_url || previewImage.preview_url || previewImage.url ? (
                  <div className="relative">
                    <img
                      src={previewImage.image_url || previewImage.preview_url || previewImage.url}
                      alt={previewImage.name}
                      className="max-w-full max-h-[80vh] object-contain rounded-lg"
                    />
                    {previewImageLoading && !previewImage.image_url && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/25 rounded-lg text-white/90">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-t-4 border-hairline mb-4"></div>
                        <p>{t('images.loading')}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-[60vw] max-w-4xl h-[60vh] max-h-[80vh] flex flex-col items-center justify-center text-white/80">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-t-4 border-hairline mb-4"></div>
                    <p>{t('images.loading')}</p>
                  </div>
                )}
              </div>
              
              {/* Image Info */}
              <div className="mt-6 bg-white/10 text-white p-6 rounded-xl max-w-md shadow-xl border border-hairline">
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
                        {previewImage.ppdValue !== undefined ? formatPpd(previewImage.ppdValue) : '--'}
                      </span>
                    </div>
                  )}
                </div>
                {previewImage.lastPrediction && (
                  <div className="mt-4 pt-4 border-t border-hairline">
                    <div className="flex flex-col">
                      <span className="text-gray-300 text-xs uppercase tracking-wider">{t('images.recent_prediction')}</span>
                      <span className="font-medium">{previewImage.lastPrediction}</span>
                    </div>
                  </div>
                )}
                <div className="mt-4 pt-4 border-t border-hairline text-center text-gray-300">
                  {previewIndex + 1} / {flatImages.length}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      <ShareModal
        visible={showShareModal}
        onCancel={() => setShowShareModal(false)}
        resourceType={shareResourceType}
        resourceIds={shareResourceIds}
        onSuccess={() => {
          setSelectedImages([]);
        }}
      />

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
        <div className="p-4 space-y-4"><p>将“{contextFolder?.name}”及其子目录、图片一起移入回收站。历史预测和人工修订保留，恢复时保留原来的关联。</p><Button danger type="primary" onClick={() => void handleDeleteFolder()}>移入回收站</Button></div>
      </Modal>

      {/* Move Modal */}
      {showMoveModal && (
        <div className="fixed inset-0 bg-[rgba(15,23,42,0.28)] flex items-center justify-center p-4 z-50">
          <div className="card card-float rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-xl font-semibold mb-4 text-ink">{t('images.move_to_folder')}</h3>
            <div className="space-y-3 max-h-72 overflow-y-auto">
              <Tree
                className="folder-tree image-folder-tree"
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
              <div className="flex items-center mt-5 p-3 card-soft rounded-lg border border-dashed border-hairline-strong">
                <div className="flex-1 mr-3 space-y-2">
                  <TreeSelect
                    className="w-full"
                    value={(moveModalNewFolderParentId ?? null) === null ? ROOT_NODE_VALUE : moveModalNewFolderParentId}
                    onChange={(v) => setMoveModalNewFolderParentId(v === ROOT_NODE_VALUE || v == null ? null : String(v))}
                    treeData={folderTreeSelectData}
                    treeDefaultExpandAll
                    showSearch
                    placeholder={t('images.choose_folder')}
                    aria-label={t('images.')}
                    size="small"
                  />
                  <input
                    type="text"
                    className="w-full border border-hairline-strong rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-line focus:border-transparent transition-all duration-300"
                    placeholder={t('images.new_folder_name')}
                    value={moveModalNewFolderName}
                    onChange={e => setMoveModalNewFolderName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreateFolderForMove(); }}
                    disabled={moveModalCreatingFolder}
                  />
                </div>
                <button
                  className="px-4 py-2 rounded-xl bg-brand-fill text-white text-sm font-medium transition-all duration-200 hover:bg-brand-fill-hover active:scale-[0.98] disabled:bg-slate-300 disabled:cursor-not-allowed"
                  onClick={handleCreateFolderForMove}
                  disabled={moveModalCreatingFolder || !moveModalNewFolderName.trim()}
                >{t('images.create')}</button>
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowMoveModal(false)}
                className="px-5 py-2.5 text-ink-secondary hover:text-ink bg-surface-sunken rounded-lg hover:bg-gray-200 transition-all duration-300"
              >
                {t('images.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Progress Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-[rgba(15,23,42,0.28)] flex items-center justify-center p-4 z-50">
          <div className="card card-float rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-xl font-semibold mb-2 text-ink">{t('images.upload_progress')}</h3>
            {uploadBatchHint && (
              <p className="text-sm text-muted mb-3">{uploadBatchHint}</p>
            )}
            <div className="space-y-4 max-h-72 overflow-y-auto">
              {uploadProgress.map((item, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate flex-1 mr-3 font-medium text-ink">{item.fileName}</span>
                    <span className={`font-semibold ${
                      item.status === 'completed' ? 'text-accent-text' : 
                      item.status === 'error' ? 'text-danger-text' : 'text-accent-text'
                    }`}>
                      {item.status === 'completed' ? t('images.completed') : 
                       item.status === 'error' ? t('images.failed') : `${item.progress}%`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ease-in-out ${
                        item.status === 'completed' ? 'bg-brand-fill' :
                        item.status === 'error' ? 'bg-white' : 'bg-brand-fill'
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
            aria-label={t('images.')}
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
            <label className="block text-sm font-medium text-ink-secondary mb-2">{t('images.upload_to_folder')}</label>
            <TreeSelect
              className="w-full"
              value={(uploadTargetFolder ?? null) === null ? ROOT_NODE_VALUE : uploadTargetFolder}
              onChange={(v) => setUploadTargetFolder(v === ROOT_NODE_VALUE || v == null ? null : String(v))}
              treeData={folderTreeSelectData}
              treeDefaultExpandAll
              showSearch
              placeholder={t('images.select_folder')}
              aria-label={t('images.')}
            />
          </div>

          {/* Duplicate Check */}
          <div className="flex items-center justify-between">
            <span className="text-ink-secondary">{t('images.check_duplicate')}</span>
            <Switch checked={uploadCheckDuplicate} onChange={setUploadCheckDuplicate} />
          </div>

          {/* Rename Settings */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-4">
              <span className="font-medium text-ink">{t('images.auto_rename')}</span>
              <Switch checked={renameEnabled} onChange={setRenameEnabled} />
            </div>
            
            {renameEnabled && (
              <div className="space-y-4 card-soft p-4 rounded-lg">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">{t('images.prefix')}</label>
                  <Input 
                    value={renamePrefix} 
                    onChange={e => setRenamePrefix(e.target.value)} 
                    placeholder={t('images.rename_prefix_placeholder')}
                    size="small"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">{t('images.start_seq')}</label>
                    <InputNumber 
                      min={1} 
                      value={renameStartSeq} 
                      onChange={v => setRenameStartSeq(v || 1)} 
                      size="small"
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">{t('images.digits')}</label>
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
                <div className="text-xs text-muted">
                  {t('images.preview')}: {renamePrefix}{String(renameStartSeq).padStart(renameDigits, '0')}.jpg
                </div>
              </div>
            )}
          </div>

          {/* Upload Area */}
          <div className="border-2 border-dashed border-hairline-strong rounded-lg p-8 text-center hover:border-accent-line hover:bg-[rgba(10,132,255,0.08)] transition-all cursor-pointer group"
               onClick={() => document.getElementById('real-upload-input')?.click()}
               onDragOver={(e) => { e.preventDefault(); }}
               onDrop={handleDrop}
          >
            <input
              type="file"
              id="legacy-upload-input"
              multiple
              accept="image/*,.zip"
              className="hidden"
              onChange={handleFileUpload}
            />
            <div className="w-16 h-16 bg-[rgba(10,132,255,0.12)] text-accent-text rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
              <Upload className="w-8 h-8" />
            </div>
            <p className="text-lg font-medium text-ink mb-1">{t('images.click_or_drag_upload')}</p>
            <p className="text-sm text-muted">{t('images.support_types')}</p>
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
        <div className="mb-4 text-ink-secondary">{t('images.following_files_exist')}</div>
        <div className="mb-4 flex space-x-3">
          <button 
            className={`px-4 py-2 rounded-lg transition-all duration-300 ${duplicateAction==='overwrite'?'bg-brand-fill text-white shadow-md':'bg-surface-sunken text-ink-secondary hover:bg-gray-200'}`} 
            onClick={()=>setDuplicateAction('overwrite')}
          >{t('images.overwrite_all')}</button>
          <button 
            className={`px-4 py-2 rounded-lg transition-all duration-300 ${duplicateAction==='skip'?'bg-brand-fill text-white shadow-md':'bg-surface-sunken text-ink-secondary hover:bg-gray-200'}`} 
            onClick={()=>setDuplicateAction('skip')}
          >{t('images.skip_all')}</button>
        </div>
        <div className="max-h-60 overflow-y-auto card-soft rounded-lg p-3 border">
          {duplicateFiles.map(name => (
            <div key={name} className="flex items-center mb-2 p-2 hover:card rounded-lg transition-all duration-200">
              <input 
                type="checkbox" 
                aria-label={t('a11y.select_image', { name })}
                checked={selectedDuplicates.includes(name)} 
                onChange={e=>{
                  setSelectedDuplicates(e.target.checked ? [...selectedDuplicates,name] : selectedDuplicates.filter(n=>n!==name));
                }} 
                className="w-4 h-4 text-accent-text rounded focus:ring-2 focus:ring-accent-line"
              />
              <span className="ml-3 text-ink font-medium">{name}</span>
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
