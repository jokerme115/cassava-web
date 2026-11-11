import { workspaceStorageKey } from './workspaceContext';
import type { ExportTemplate } from './exportStyle';

export interface PredictionPreset {
  id: string; name: string; model: string; mode: 'single' | 'ensemble'; version: number;
  parameters: Record<string, number | boolean | number[]>;
}

export interface UserPreferences {
  language: 'zh' | 'en'; editorTheme: 'light' | 'dark'; brushSize: number; vertexSize: number;
  cassavaOpacity: number; rottenOpacity: number; defaultExportTemplate: string;
  listView: 'grid' | 'list'; listSort: 'date' | 'name' | 'size' | 'capture_time' | 'folder'; listOrder: 'asc' | 'desc';
  listGroup: 'none' | 'year' | 'month' | 'day'; listPageSize: number;
  importMode: 'new' | 'existing'; preserveHierarchy: boolean;
  predictionPresets: PredictionPreset[]; defaultPredictionPreset: string; taskNamePrefix: string;
  exportTemplates: ExportTemplate[];
  editorResetZoom: boolean; editorDimOutside: boolean; editorShowCassava: boolean; editorShowRotten: boolean;
  autoAdvanceReview: boolean;
}
export const defaultPreferences: UserPreferences = {
  language: 'zh', editorTheme: 'light', brushSize: 24, vertexSize: 2, cassavaOpacity: .28, rottenOpacity: .68, defaultExportTemplate: '',
  listView: 'grid', listSort: 'date', listOrder: 'desc', listGroup: 'year', listPageSize: 48,
  importMode: 'new', preserveHierarchy: true, predictionPresets: [], defaultPredictionPreset: '', taskNamePrefix: '预测任务',
  exportTemplates: [], editorResetZoom: true, editorDimOutside: true, editorShowCassava: true, editorShowRotten: true, autoAdvanceReview: true,
};
export function getUserPreferences(): UserPreferences {
  try { return { ...defaultPreferences, ...JSON.parse(localStorage.getItem(workspaceStorageKey('preferences')) || '{}') }; }
  catch { return { ...defaultPreferences }; }
}
export function cacheUserPreferences(preferences: Partial<UserPreferences>, etag?: string) {
  try {
    localStorage.setItem(workspaceStorageKey('preferences'), JSON.stringify({ ...defaultPreferences, ...preferences }));
    if (etag) localStorage.setItem(workspaceStorageKey('preferences-etag'), etag);
  }
  catch { /* The server remains the source if browser storage is unavailable. */ }
}

export function getPreferenceEtag() {
  try { return localStorage.getItem(workspaceStorageKey('preferences-etag')) || undefined; } catch { return undefined; }
}
