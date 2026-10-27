import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  Trash2,
  RefreshCw,
  HardDrive,
  Clock,
  Database,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Zap,
  Download,
  ExternalLink,
  Keyboard
} from 'lucide-react';
import { Switch, message } from 'antd';
import { systemSettingsApi } from '../services/api';

interface CacheInfo {
  thumbnail_cache: {
    path: string;
    size: number;
    size_formatted: string;
  };
  temp_files: {
    path: number;
    size: number;
    size_formatted: string;
  };
  predictions_cache: {
    path: string;
    size: number;
    size_formatted: string;
  };
  total_size: number;
  total_size_formatted: string;
}

interface Preferences {
  useCpuOnly: boolean;
  gpuEnabled: boolean;
  customShortcuts?: {
    newPrediction?: string;
    openImages?: string;
    openSettings?: string;
    toggleDarkMode?: string;
    showHelp?: string;
    goHome?: string;
    cancel?: string;
  };
}

interface ShortcutItem {
  key: string;
  action: string;
  currentShortcut: string;
}

interface SettingsPageProps {
  onSectionChange: (section: string) => void;
}

declare global {
  interface Window {
    electronAPI?: {
      getPreferences: () => Promise<Preferences>;
      setPreferences: (prefs: Partial<Preferences>) => Promise<Preferences>;
      getBackendUrl: () => Promise<string>;
      checkIssues: () => Promise<{ issues: string[] }>;
      rebuildIndex: () => Promise<{ ok: boolean; message: string }>;
      selectLocalImages: () => Promise<string[]>;
      selectLocalFolder: () => Promise<string | null>;
      getAppVersion: () => Promise<{ version: string; name: string; isPackaged: boolean }>;
      checkForUpdates: () => Promise<UpdateInfo>;
      getVersionInfo: () => Promise<UpdateInfo | null>;
      downloadUpdate: (url: string) => Promise<{ success: boolean; message?: string; error?: string }>;
    };
  }
}

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  needsUpdate: boolean;
  downloadUrl: string | null;
  releaseNotes: string;
  lastChecked: string;
  error?: string;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ onSectionChange }) => {
  const { t } = useTranslation();
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState<string | null>(null);
  const [clearResult, setClearResult] = useState<{ cleared: string[]; errors: string[] } | null>(null);
  const [preferences, setPreferences] = useState<Preferences>({ useCpuOnly: false, gpuEnabled: true });
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [shortcuts, setShortcuts] = useState<ShortcutItem[]>([
    { key: 'newPrediction', action: 'settings.shortcuts.newPrediction', currentShortcut: 'ctrl+n' },
    { key: 'openImages', action: 'settings.shortcuts.openImages', currentShortcut: 'ctrl+o' },
    { key: 'openSettings', action: 'settings.shortcuts.openSettings', currentShortcut: 'ctrl+,' },
    { key: 'toggleDarkMode', action: 'settings.shortcuts.toggleDarkMode', currentShortcut: 'ctrl+d' },
    { key: 'showHelp', action: 'settings.shortcuts.showHelp', currentShortcut: 'ctrl+/' },
    { key: 'goHome', action: 'settings.shortcuts.goHome', currentShortcut: 'ctrl+h' },
    { key: 'cancel', action: 'settings.shortcuts.cancel', currentShortcut: 'escape' },
  ]);
  const [editingShortcut, setEditingShortcut] = useState<string | null>(null);
  const [tempShortcut, setTempShortcut] = useState<string>('');

  const fetchCacheInfo = async () => {
    try {
      const response = await fetch('/api/system/cache/info/');
      if (response.ok) {
        const data = await response.json();
        setCacheInfo(data);
      }
    } catch (error) {
      console.error('Failed to fetch cache info', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCacheInfo();
    fetchPreferences();
    fetchVersionInfo();
  }, []);

  const fetchVersionInfo = async () => {
    if (!window.electronAPI) return;
    try {
      const version = await window.electronAPI.getAppVersion();
      setAppVersion(version.version);
      const info = await window.electronAPI.getVersionInfo();
      if (info) {
        setUpdateInfo(info);
      }
    } catch (error) {
      console.error('Failed to fetch version info', error);
    }
  };

  const handleCheckUpdate = async () => {
    if (!window.electronAPI) return;
    setCheckingUpdate(true);
    try {
      const info = await window.electronAPI.checkForUpdates();
      setUpdateInfo(info);
      if (info.needsUpdate) {
        message.info(t('settings.update.newVersionAvailable', `发现新版本 ${info.latestVersion}`));
      } else {
        message.success(t('settings.update.upToDate', '当前已是最新版本'));
      }
    } catch (error) {
      console.error('Failed to check for updates', error);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (!window.electronAPI || !updateInfo?.downloadUrl) return;
    try {
      const result = await window.electronAPI.downloadUpdate(updateInfo.downloadUrl);
      if (result.success) {
        message.success(result.message || t('settings.update.downloadStarted', '下载已开始'));
      } else {
        message.error(result.error || t('settings.update.downloadFailed', '下载失败'));
      }
    } catch (error) {
      console.error('Failed to download update', error);
    }
  };

  const handleStartEditShortcut = (key: string, currentShortcut: string) => {
    setEditingShortcut(key);
    setTempShortcut(currentShortcut);
  };

  const handleSaveShortcut = async () => {
    if (!window.electronAPI || !editingShortcut) return;
    try {
      const newShortcuts = { ...preferences.customShortcuts, [editingShortcut]: tempShortcut };
      await window.electronAPI.setPreferences({ customShortcuts: newShortcuts });
      setPreferences((prev: any) => ({ ...prev, customShortcuts: newShortcuts }));
      setShortcuts((prev: ShortcutItem[]) =>
        prev.map((s) => (s.key === editingShortcut ? { ...s, currentShortcut: tempShortcut } : s))
      );
      message.success(t('settings.shortcuts.saved', '快捷键已保存'));
    } catch (error) {
      console.error('Failed to save shortcut', error);
      message.error(t('settings.shortcuts.saveFailed', '保存快捷键失败'));
    } finally {
      setEditingShortcut(null);
      setTempShortcut('');
    }
  };

  const handleCancelEditShortcut = () => {
    setEditingShortcut(null);
    setTempShortcut('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!editingShortcut) return;
    e.preventDefault();
    const keys: string[] = [];
    if (e.ctrlKey) keys.push('ctrl');
    if (e.altKey) keys.push('alt');
    if (e.shiftKey) keys.push('shift');
    if (e.metaKey) keys.push('meta');
    if (e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Shift' && e.key !== 'Meta') {
      keys.push(e.key.toLowerCase());
    }
    if (keys.length > 1) {
      setTempShortcut(keys.join('+'));
    }
  };

  const fetchPreferences = async () => {
    if (!window.electronAPI) return;
    try {
      const prefs = await window.electronAPI.getPreferences();
      setPreferences(prefs);
    } catch (error) {
      console.error('Failed to fetch preferences', error);
    }
  };

  const handlePreferenceChange = async (key: keyof Preferences, value: boolean) => {
    if (!window.electronAPI) return;
    setPreferencesLoading(true);
    try {
      const newPrefs = await window.electronAPI.setPreferences({ [key]: value });
      setPreferences(newPrefs);
      message.success(t('settings.gpu.restartNotice', '设置已保存，部分更改需重启应用后生效'));
    } catch (error) {
      console.error('Failed to save preference', error);
      message.error(t('settings.gpu.saveFailed', '保存设置失败'));
    } finally {
      setPreferencesLoading(false);
    }
  };

  const handleClearCache = async (type: string) => {
    setClearing(type);
    setClearResult(null);
    try {
      const response = await fetch('/api/system/cache/clear/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      if (response.ok) {
        const result = await response.json();
        setClearResult(result);
        fetchCacheInfo();
      }
    } catch (error) {
      console.error('Failed to clear cache', error);
    } finally {
      setClearing(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f7f4] px-4 py-8 dark:bg-slate-900 dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
            {t('settings.title', '设置')}
          </h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            {t('settings.description', '管理系统设置和缓存')}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-slate-700/80 dark:bg-slate-800/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                  {t('settings.cache.title', '缓存管理')}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('settings.cache.description', '清理缩略图和临时文件')}
                </p>
              </div>
            </div>

            {loading ? (
              <div className="mt-6 flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : cacheInfo ? (
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-700/50">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-slate-500" />
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {t('settings.cache.thumbnails', '缩略图缓存')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-slate-900 dark:text-white">
                      {cacheInfo.thumbnail_cache.size_formatted}
                    </span>
                    <button
                      onClick={() => handleClearCache('thumbnails')}
                      disabled={clearing !== null}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-200 px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-300 disabled:opacity-50 dark:bg-slate-600 dark:text-slate-300 dark:hover:bg-slate-500"
                    >
                      {clearing === 'thumbnails' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      {t('settings.cache.clear', '清理')}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-700/50">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-slate-500" />
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {t('settings.cache.temp', '临时文件')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-slate-900 dark:text-white">
                      {cacheInfo.temp_files.size_formatted}
                    </span>
                    <button
                      onClick={() => handleClearCache('temp')}
                      disabled={clearing !== null}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-200 px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-300 disabled:opacity-50 dark:bg-slate-600 dark:text-slate-300 dark:hover:bg-slate-500"
                    >
                      {clearing === 'temp' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      {t('settings.cache.clear', '清理')}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-700/50">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-slate-500" />
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {t('settings.cache.predictions', '预测缓存')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-slate-900 dark:text-white">
                      {cacheInfo.predictions_cache.size_formatted}
                    </span>
                    <button
                      onClick={() => handleClearCache('predictions')}
                      disabled={clearing !== null}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-200 px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-300 disabled:opacity-50 dark:bg-slate-600 dark:text-slate-300 dark:hover:bg-slate-500"
                    >
                      {clearing === 'predictions' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      {t('settings.cache.clear', '清理')}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-900/30">
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    {t('settings.cache.total', '总计')}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      {cacheInfo.total_size_formatted}
                    </span>
                    <button
                      onClick={() => handleClearCache('all')}
                      disabled={clearing !== null}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {clearing === 'all' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      {t('settings.cache.clearAll', '清理全部')}
                    </button>
                  </div>
                </div>

                {clearResult && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                    {clearResult.cleared.length > 0 && (
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                          {clearResult.cleared.join(', ')}
                        </div>
                      </div>
                    )}
                    {clearResult.errors.length > 0 && (
                      <div className="mt-2 flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                        <div className="text-sm text-red-600 dark:text-red-400">
                          {clearResult.errors.join(', ')}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-6 text-center text-sm text-slate-500">
                {t('settings.cache.loadFailed', '加载缓存信息失败')}
              </div>
            )}
          </div>

          <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-slate-700/80 dark:bg-slate-800/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                  {t('settings.gpu.title', '推理设置')}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('settings.gpu.description', '配置 GPU/CPU 推理选项')}
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-700/50">
                <div className="flex items-center gap-3">
                  <Zap className="h-5 w-5 text-amber-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {t('settings.gpu.enableGpu', '启用 GPU 加速')}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t('settings.gpu.enableGpuDesc', '使用 NVIDIA/AMD GPU 加速预测')}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={!preferences.useCpuOnly}
                  onChange={(checked) => handlePreferenceChange('useCpuOnly', !checked)}
                  loading={preferencesLoading}
                  disabled={preferencesLoading}
                />
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t('settings.gpu.notice', '注意：更改推理设置后需要重启应用才能生效。')}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-slate-700/80 dark:bg-slate-800/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                <Settings className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                  {t('settings.other.title', '其他设置')}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('settings.other.description', '更多系统设置')}
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <button
                onClick={() => handleClearCache('all')}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-700/50 dark:hover:bg-slate-700"
              >
                <div className="flex items-center gap-3">
                  <RefreshCw className="h-5 w-5 text-slate-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {t('settings.other.rebuildIndex', '重建图片索引')}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t('settings.other.rebuildIndexDesc', '检测外部引用图片是否有效')}
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => onSectionChange('about')}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-700/50 dark:hover:bg-slate-700"
              >
                <div className="flex items-center gap-3">
                  <Database className="h-5 w-5 text-slate-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {t('settings.other.about', '关于系统')}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t('settings.other.aboutDesc', '查看版本信息和系统状态')}
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* 软件更新 */}
          <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-slate-700/80 dark:bg-slate-800/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                  {t('settings.update.title', '软件更新')}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('settings.update.description', '检查并安装最新版本')}
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-700/50">
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-emerald-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {t('settings.update.currentVersion', '当前版本')}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {appVersion || '1.0.0'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleCheckUpdate}
                  disabled={checkingUpdate}
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {checkingUpdate ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {t('settings.update.check', '检查更新')}
                </button>
              </div>

              {updateInfo?.needsUpdate && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                        {t('settings.update.newVersion', '发现新版本')} {updateInfo.latestVersion}
                      </p>
                      {updateInfo.releaseNotes && (
                        <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-500">
                          {updateInfo.releaseNotes}
                        </p>
                      )}
                      {updateInfo.downloadUrl && (
                        <button
                          onClick={handleDownloadUpdate}
                          className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-xs font-medium text-white transition hover:bg-emerald-700"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t('settings.update.download', '下载更新')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {updateInfo && !updateInfo.needsUpdate && !updateInfo.error && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {t('settings.update.upToDate', '当前已是最新版本')}
                    </p>
                  </div>
                </div>
              )}

              {updateInfo?.lastChecked && (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {t('settings.update.lastChecked', '上次检查')}: {new Date(updateInfo.lastChecked).toLocaleString()}
                </p>
              )}
            </div>
          </div>

          {/* 快捷键设置 */}
          <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-slate-700/80 dark:bg-slate-800/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-400">
                <Keyboard className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                  {t('settings.shortcuts.title', '快捷键设置')}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('settings.shortcuts.description', '自定义键盘快捷键')}
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {shortcuts.map((shortcut) => (
                <div
                  key={shortcut.key}
                  className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-700/50"
                >
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    {t(shortcut.action, shortcut.action)}
                  </span>
                  {editingShortcut === shortcut.key ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={tempShortcut}
                        onChange={(e) => setTempShortcut(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-32 rounded-lg border border-slate-300 px-3 py-1 text-sm focus:border-emerald-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveShortcut}
                        className="h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={handleCancelEditShortcut}
                        className="h-7 w-7 items-center justify-center rounded-lg bg-slate-300 text-slate-700 hover:bg-slate-400 dark:bg-slate-600 dark:text-slate-300"
                      >
                        <AlertCircle className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleStartEditShortcut(shortcut.key, shortcut.currentShortcut)}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      {shortcut.currentShortcut}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;