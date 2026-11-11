import { authApi } from './api';
import { cacheUserPreferences, getPreferenceEtag, type UserPreferences } from '../utils/userPreferences';
import { workspaceStorageKey } from '../utils/workspaceContext';

export async function saveUserPreferences(patch: Partial<UserPreferences>) {
  const user = await authApi.updateProfile({ preferences: patch, preferences_etag: getPreferenceEtag() });
  cacheUserPreferences(user.profile?.preferences || {}, user.profile?.preferences_etag);
  const views: Partial<Record<keyof UserPreferences, string[]>> = {
    listView: ['image-view-mode', 'results-view'], listSort: ['image-sort'], listOrder: ['image-sort-order'],
    listGroup: ['image-group'], listPageSize: ['task-page-size', 'results-page-size', 'image-page', 'task-page', 'results-page'],
  };
  for (const key of Object.keys(patch) as Array<keyof UserPreferences>) {
    for (const name of views[key] || []) { try { sessionStorage.removeItem(workspaceStorageKey(name)); } catch { /* Optional browser state. */ } }
  }
  window.dispatchEvent(new CustomEvent('preferences:updated', { detail: user }));
  return user;
}
