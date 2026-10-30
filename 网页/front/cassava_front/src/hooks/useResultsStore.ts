import { message } from '../utils/feedback';
import api from '../services/rest/client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { PredictionResult, TaskStatistics } from '../types';
import { predictionsApi } from '../services/api';

import i18n from '../i18n';
import { effectivePpd } from '../utils/measurement';

export const useResultsStore = (currentUser?: any, taskId?: string | null, search = '', status = 'all', reviewStatus = 'all', page = 1, pageSize = 48, onInvalidPage?: () => void) => {
  const [results, setResults] = useState<PredictionResult[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [allResultsCount, setAllResultsCount] = useState(0);
  const requestSequence = useRef(0);
  const invalidPage = useRef(onInvalidPage);
  invalidPage.current = onInvalidPage;

  const loadResults = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const baseParams = { ...(currentUser?.is_guest ? { user_id: currentUser.id } : {}), page, page_size: pageSize };
      const query = { ...baseParams, ...(taskId ? { task_id: taskId } : {}), search, status, review_status: reviewStatus };
      const [data, aggregate, overall] = await Promise.all([predictionsApi.getAll(query), api.get('/predictions/summary/', { params: query }), api.get('/predictions/summary/', { params: currentUser?.is_guest ? { user_id: currentUser.id } : {} })]);
      if (sequence !== requestSequence.current) return;
      setSummary(aggregate.data);
      const mergedRaw = data.results;
      setAllResultsCount(overall.data.total ?? data.count ?? mergedRaw.length);
      setTotalCount(data.count ?? mergedRaw.length);
      const normalizedResults = mergedRaw.map((r: any) => ({
        ...r,
        imageUrl: r.original_image_url || r.image_url || r.imageUrl || '',
        imageName: r.original_image_name ?? r.imageName ?? r.image_name ?? '',
        overlayImageUrl: r.overlayImageUrl || r.result_image_url || '',
        ppdValue: r.ppdValue ?? r.ppd_value ?? 0,
        sub_ppd_values: r.sub_ppd_values ?? r.subPpdValues ?? [],
        prediction: r.prediction ?? '',
        confidence: typeof r.confidence === 'number' ? r.confidence : null,
        taskId: r.taskId || r.task_id || r.processing_task || r.processing_task_id || r.processingTaskId || '',
        folderId: r.original_image_folder_id ?? r.folder_id ?? r.folderId ?? r.folder ?? null,
        folderName: r.original_image_folder_name ?? r.folder_name ?? r.folderName ?? null,
        vis_images: r.vis_images || {},
        split_count: r.split_count ?? r.splitCount ?? (Array.isArray(r.sub_ppd_values) ? r.sub_ppd_values.length : 0),
      }));
      setResults(normalizedResults);
    } catch (error: any) {
      if (sequence !== requestSequence.current) return;
      if (page > 1 && error?.response?.status === 404 && invalidPage.current) { invalidPage.current(); return; }
      message.error(i18n.t('results.load_failed'));
      console.error(error);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [currentUser, taskId, search, status, reviewStatus, page, pageSize]);

  useEffect(() => {
    void loadResults();
    const handleReload = () => { void loadResults(); };
    window.addEventListener('results:reload', handleReload);
    return () => { requestSequence.current++; window.removeEventListener('results:reload', handleReload); };
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
    const ppdValues = results.map(effectivePpd).filter((value): value is number => value !== null);
    const uniqueTaskIds = [...new Set(results.map((r: any) => r.taskId))];

    return {
      totalPredictions: results.length,
      averagePPD: Number((ppdValues.reduce((a, b) => a + b, 0) / (ppdValues.length || 1)).toFixed(2)),
      highestPPD: ppdValues.length ? Math.max(...ppdValues) : 0,
      lowestPPD: ppdValues.length ? Math.min(...ppdValues) : 0,
      completedTasks: uniqueTaskIds.length,
      runningTasks: 0 // This would come from task store
    };
  };

  const exportResults = async (fileType: 'csv' | 'xlsx' | 'zip', filters: { task_id?: string; search?: string; status?: string; review_status?: string; style?: string; version?: string; result_ids?: string } = {}) => {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await predictionsApi.export({ file_type: fileType, ...filters });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `cassava_results_${filters.task_id || 'all'}_${new Date().toISOString().slice(0, 10)}.${fileType}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      const count = Number(response.headers['x-export-count'] || 0);
      const warnings = Number(response.headers['x-export-warnings'] || 0);
      if (warnings) message.warning(`已生成 ${count} 条结果，${warnings} 条存在缺失资源，请检查数据包清单`);
      else message.success(`已生成 ${count} 条结果，已发起下载`);
    } catch (error: any) {
      let detail = '导出失败，请重试';
      if (error?.response?.data instanceof Blob) {
        try { const payload = JSON.parse(await error.response.data.text()); detail = payload.message || payload.detail || detail; } catch { /* Keep the readable fallback. */ }
      }
      message.error(detail);
    } finally {
      setExporting(false);
    }
  };

  return {
    results,
    summary,
    loading,
    exporting,
    totalCount,
    allResultsCount,
    hasMore: page * pageSize < totalCount,
    loadResults,
    getResultsByTask,
    getStatistics,
    exportResults,
  };
};
