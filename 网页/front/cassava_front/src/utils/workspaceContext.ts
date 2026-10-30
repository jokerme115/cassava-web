import { useSyncExternalStore } from 'react';

export interface WorkspaceContext {
  folder: string | null;
  lastWritableFolder: string | null;
  selectedIds: string[];
}
let userKey = 'guest';
let context: WorkspaceContext = { folder: null, lastWritableFolder: null, selectedIds: [] };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const key = () => `cassava:workspace:${userKey}`;

export function setWorkspaceUser(id?: string | number) {
  const next = String(id ?? 'guest');
  if (next === userKey) return;
  userKey = next;
  try { context = { folder: null, lastWritableFolder: null, selectedIds: [], ...JSON.parse(localStorage.getItem(key()) || '{}') }; }
  catch { context = { folder: null, lastWritableFolder: null, selectedIds: [] }; }
  emit();
}

export function updateWorkspace(patch: Partial<WorkspaceContext>) {
  context = { ...context, ...patch };
  if (patch.folder && (/^\d+$/.test(patch.folder) || ['uncategorized', 'root'].includes(patch.folder))) {
    context.lastWritableFolder = ['uncategorized', 'root'].includes(patch.folder) ? null : patch.folder;
  }
  try { localStorage.setItem(key(), JSON.stringify(context)); } catch { /* Storage may be unavailable. */ }
  emit();
}

export const getWorkspace = () => context;
export const workspaceStorageKey = (suffix: string) => `${key()}:${suffix}`;
export const useWorkspace = () => useSyncExternalStore(listener => {
  listeners.add(listener); return () => { listeners.delete(listener); };
}, getWorkspace, getWorkspace);

export function folderPath(folders: Array<{ id: string; name: string; parent?: string | null }>, id?: string | null) {
  if (!id || id === 'uncategorized') return '未分类';
  const parts: string[] = [], seen = new Set<string>();
  let current = String(id);
  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = folders.find(item => String(item.id) === current);
    if (!folder) break;
    parts.unshift(folder.name); current = String(folder.parent || '');
  }
  return parts.length ? `我的文件 / ${parts.join(' / ')}` : '未分类';
}
