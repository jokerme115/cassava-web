import { useState, useEffect } from 'react';
import { PredictionResult, TaskStatistics } from '../types';
import { predictionsApi } from '../services/api';
import { message } from 'antd';
import i18n from '../i18n';

export const useResultsStore = (currentUser?: any) => {
  const [results, setResults] = useState<PredictionResult[]>([]);
  const [loading, setLoading] = useState(true);

  const normalizeResults = (resultsList: any[]) => resultsList.map((r: any) => ({
    ...r,
    imageUrl: r.original_image_url || r.image_url || r.imageUrl || '',
    imageName: r.original_image_name ?? r.imageName ?? r.image_name ?? '',
    overlayImageUrl: r.overlayImageUrl || r.result_image_url || '',
    ppdValue: r.ppd_value ?? r.ppdValue ?? 0,
    sub_ppd_values: r.sub_ppd_values ?? r.subPpdValues ?? [],
    prediction: r.prediction ?? '',
    confidence: typeof r.confidence === 'number' ? r.confidence : 1,
    taskId: r.taskId || r.task_id || r.processing_task || r.processing_task_id || r.processingTaskId || '',
    folderId: r.original_image_folder_id ?? r.folder_id ?? r.folderId ?? r.folder ?? null,
    folderName: r.original_image_folder_name ?? r.folder_name ?? r.folderName ?? null,
    vis_images: r.vis_images || {},
    split_count: r.split_count ?? r.splitCount ?? (Array.isArray(r.sub_ppd_values) ? r.sub_ppd_values.length : 0),
  }));

  useEffect(() => {
    loadResults();
    
    const handleReload = () => loadResults();
    window.addEventListener('results:reload', handleReload);
    return () => window.removeEventListener('results:reload', handleReload);
  }, [currentUser]);

  const loadResults = async () => {
    setLoading(true);
    try {
      const params = {
        ...(currentUser?.is_guest ? { user_id: currentUser.id } : {}),
        page_size: 1000
      };
      
      const data = await predictionsApi.getAllPages(params);
      const resultsList = Array.isArray(data) ? data : ((data as any)?.results || []);
      setResults(normalizeResults(resultsList));
    } catch (error) {
      message.error(i18n.t('results.load_failed'));
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // 异步获取并设置results
  const fetchResultsByTask = async (taskId: string) => {
    try {
      setLoading(true);
      const data = await predictionsApi.getAllPages({ task_id: taskId, page_size: 1000 });
      const resultsList = Array.isArray(data) ? data : ((data as any)?.results || []);
      const normalizedResults = normalizeResults(resultsList);
      setResults(normalizedResults);
      return resultsList;
    } catch (error) {
      message.error(i18n.t('results.load_by_task_failed'));
      console.error(error);
      return [];
    } finally {
      setLoading(false);
    }
  };

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

    const toCsvCell = (value: unknown) => {
      const str = value === null || value === undefined ? '' : String(value);
      const escaped = str.replaceAll('"', '""');
      return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
    };

    const headerRow = [
      i18n.t('results.csv_headers.folder_name'),
      i18n.t('results.csv_headers.image_name'),
      i18n.t('results.csv_headers.ppd_value'),
      i18n.t('results.csv_headers.sub_ppd_values'),
      i18n.t('results.csv_headers.confidence'),
      i18n.t('results.csv_headers.processing_time'),
      i18n.t('results.csv_headers.prediction'),
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

        // 计算健康状态
        const ppd = r.ppd_value ?? r.ppdValue ?? 0;
        const healthStatus = ppd < 4 ? '健康' : ppd < 7 ? '轻微病害' : '严重病害';

        return [
          toCsvCell(r.folderName ?? ''),
          toCsvCell(r.imageName ?? ''),
          toCsvCell(ppd),
          toCsvCell(Array.isArray(r.sub_ppd_values) ? r.sub_ppd_values.join('|') : ''),
          toCsvCell(typeof r.confidence === 'number' ? (r.confidence * 100).toFixed(2) + '%' : ''),
          toCsvCell(r.processingTime ? r.processingTime.toFixed(3) + 's' : ''),
          toCsvCell(healthStatus),
          toCsvCell(r.imageUrl ?? ''),
          toCsvCell(pred),
          toCsvCell(cut2),
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
