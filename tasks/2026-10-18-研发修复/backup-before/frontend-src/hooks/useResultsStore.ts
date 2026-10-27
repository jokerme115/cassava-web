import { useState, useEffect, useCallback } from 'react';
import { PredictionResult, TaskStatistics } from '../types';
import { predictionsApi, systemSettingsApi } from '../services/api';
import { message } from 'antd';
import i18n from '../i18n';
import { sanitizeCsvCell } from '../utils/measurement';

export const useResultsStore = (currentUser?: any) => {
  const [results, setResults] = useState<PredictionResult[]>([]);
  const [loading, setLoading] = useState(true);

  const loadResults = useCallback(async () => {
    setLoading(true);
    try {
      // Get system settings for pagination limit
      let limit = 100;
      try {
        const settings = await systemSettingsApi.get();
        limit = Number(settings.maxDisplayResults) || 100;
      } catch (e) {
        console.warn('Failed to load system settings for results limit', e);
      }

      const params = {
        ...(currentUser?.is_guest ? { user_id: currentUser.id } : {}),
        page_size: limit
      };
      
      const data = await predictionsApi.getAll(params);
      const resultsList = Array.isArray(data) ? data : ((data as any)?.results || []);
      const normalizedResults = resultsList.map((r: any) => ({
        ...r,
        imageUrl: r.original_image_url || r.image_url || r.imageUrl || '',
        imageName: r.original_image_name ?? r.imageName ?? r.image_name ?? '',
        overlayImageUrl: r.overlayImageUrl || r.result_image_url || '',
        ppdValue: r.ppdValue ?? r.ppd_value ?? 0,
        sub_ppd_values: r.sub_ppd_values ?? r.subPpdValues ?? [],
        prediction: r.prediction ?? '',
        confidence: typeof r.confidence === 'number' ? r.confidence : 1,
        taskId: r.taskId || r.task_id || r.processing_task || r.processing_task_id || r.processingTaskId || '',
        folderId: r.original_image_folder_id ?? r.folder_id ?? r.folderId ?? r.folder ?? null,
        folderName: r.original_image_folder_name ?? r.folder_name ?? r.folderName ?? null,
        vis_images: r.vis_images || {},
        split_count: r.split_count ?? r.splitCount ?? (Array.isArray(r.sub_ppd_values) ? r.sub_ppd_values.length : 0),
      }));
      setResults(normalizedResults);
    } catch (error) {
      message.error(i18n.t('results.load_failed'));
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadResults();
    const handleReload = () => { void loadResults(); };
    window.addEventListener('results:reload', handleReload);
    return () => window.removeEventListener('results:reload', handleReload);
  }, [loadResults]);

  // 同步本地过滤
  const getResultsByTask = (taskId: string) => {
    return Array.isArray(results) ? results.filter(result => result.taskId === taskId) : [];
  };

  const getStatistics = (): TaskStatistics => {
    // 只统计当前results（同步）
    if (!Array.isArray(results) || results.length === 0) {
      return {
        totalPredictions: 0,
        averagePPD: 0,
        highestPPD: 0,
        lowestPPD: 0,
        completedTasks: 0,
        runningTasks: 0
      };
    }

    // 兼容后端字段
    const ppdValues = results.map((r: any) => r.ppd_value ?? r.ppdValue ?? 0);
    const uniqueTaskIds = [...new Set(results.map((r: any) => r.taskId))];

    return {
      totalPredictions: results.length,
      averagePPD: Number((ppdValues.reduce((a, b) => a + b, 0) / ppdValues.length).toFixed(2)),
      highestPPD: Math.max(...ppdValues),
      lowestPPD: Math.min(...ppdValues),
      completedTasks: uniqueTaskIds.length,
      runningTasks: 0 // This would come from task store
    };
  };

  const exportResults = (taskId?: string, resultsOverride?: PredictionResult[]) => {
    const resultsToExport = resultsOverride ?? (taskId ? getResultsByTask(taskId) : results);

    const headerRow = [
      i18n.t('results.csv_headers.folder_name'),
      i18n.t('results.csv_headers.image_name'),
      i18n.t('results.csv_headers.ppd_value'),
      'PPD unit',
      'Manual corrected PPD (%)',
      'Measurement status',
      i18n.t('results.csv_headers.sub_ppd_values'),
      i18n.t('results.csv_headers.original_image_url'),
      i18n.t('results.csv_headers.pred_vis_urls'),
      i18n.t('results.csv_headers.second_cut_urls'),
    ].join(',');

    const csvContent = [
      headerRow,
      ...resultsToExport.map(r => {
        const cut2 = Object.entries(r.vis_images || {})
          .filter(([k, v]) => k.startsWith('cut2_') && v)
          .sort((a, b) => Number(a[0].slice(5)) - Number(b[0].slice(5)))
          .map(([, v]) => v)
          .join('|');
        const pred = Object.entries(r.vis_images || {})
          .filter(([k, v]) => k.startsWith('pred_') && v)
          .sort((a, b) => Number(a[0].slice(5)) - Number(b[0].slice(5)))
          .map(([, v]) => v)
          .join('|');

        return [
          sanitizeCsvCell(r.folderName ?? ''),
          sanitizeCsvCell(r.imageName ?? ''),
          sanitizeCsvCell(r.ppdValue ?? ''),
          sanitizeCsvCell(r.ppd_unit ?? 'unknown'),
          sanitizeCsvCell(r.latest_correction_ppd ?? ''),
          sanitizeCsvCell(r.has_correction ? 'manual-correction' : 'model-only'),
          sanitizeCsvCell(Array.isArray(r.sub_ppd_values) ? r.sub_ppd_values.join('|') : ''),
          sanitizeCsvCell(r.imageUrl ?? ''),
          sanitizeCsvCell(pred),
          sanitizeCsvCell(cut2),
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prediction_results_${taskId || 'all'}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    message.success(i18n.t('results.export_success'));
  };

  return {
    results,
    loading,
    loadResults,
    getResultsByTask,
    getStatistics,
    exportResults,
  };
};
