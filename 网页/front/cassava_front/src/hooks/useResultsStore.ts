import { useState, useEffect, useCallback } from 'react';
import { PredictionResult, TaskStatistics } from '../types';
import { predictionsApi, systemSettingsApi } from '../services/api';
import { message } from 'antd';
import i18n from '../i18n';
import { effectivePpd } from '../utils/measurement';

export const useResultsStore = (currentUser?: any, taskId?: string | null) => {
  const [results, setResults] = useState<PredictionResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [allResultsCount, setAllResultsCount] = useState(0);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadResults = useCallback(async () => {
    setLoading(true);
    try {
      // Get system settings for pagination limit
      // 访客没有认证态，只能读公开设置，否则会打出 401
      let limit = 100;
      try {
        const settings = currentUser?.is_guest
          ? await systemSettingsApi.getPublic()
          : await systemSettingsApi.get();
        limit = Number(settings.maxDisplayResults) || 100;
      } catch (e) {
        console.warn('Failed to load system settings for results limit', e);
      }

      const baseParams = {
        ...(currentUser?.is_guest ? { user_id: currentUser.id } : {}),
        page_size: limit
      };

      // 聚焦某个任务时，额外拉取该任务的全部结果并合并进来：
      // 否则历史任务的结果落在第一页之外时，结果中心会显示“0 条”。
      const [data, taskData] = await Promise.all([
        predictionsApi.getAll(baseParams),
        taskId ? predictionsApi.getAll({ ...baseParams, task_id: taskId, page_size: 2000 }) : Promise.resolve(null),
      ]);
      const resultsList = Array.isArray(data) ? data : ((data as any)?.results || []);
      const taskList = taskData ? (Array.isArray(taskData) ? taskData : ((taskData as any)?.results || [])) : [];
      const overallCount = Array.isArray(data) ? data.length : data.count ?? resultsList.length;
      setAllResultsCount(overallCount);
      // 聚焦某个任务时，导出与“已加载/总数”都以该任务为准；否则用全库计数。
      if (taskId) {
        setTotalCount(taskList.length);
        setNextPage(null);
      } else {
        setTotalCount(overallCount);
        setNextPage(Array.isArray(data) ? null : data.next ?? null);
      }
      const mergedRaw = [...resultsList];
      const seenIds = new Set(mergedRaw.map((item: any) => String(item?.id ?? '')));
      for (const item of taskList) {
        const key = String((item as any)?.id ?? '');
        if (!seenIds.has(key)) { seenIds.add(key); mergedRaw.push(item); }
      }
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
    } catch (error) {
      message.error(i18n.t('results.load_failed'));
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [currentUser, taskId]);

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

  const loadMore = async () => {
    if (!nextPage || loadingMore) return;
    setLoadingMore(true);
    try {
      const query = new URL(nextPage, window.location.origin).searchParams;
      const data = await predictionsApi.getAll({
        page: query.get('page') || 1,
        page_size: query.get('page_size') || 100,
        ...(taskId ? { task_id: taskId } : {}),
      });
      setResults((current) => [...current, ...data.results.filter((item) => !current.some((old) => old.id === item.id))]);
      setNextPage(data.next ?? null);
    } catch { message.error('加载下一页失败，请重试'); }
    finally { setLoadingMore(false); }
  };

  const exportResults = async (fileType: 'csv' | 'xlsx' | 'zip', filters: { task_id?: string; search?: string; status?: string } = {}) => {
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
    loading,
    exporting,
    totalCount,
    allResultsCount,
    hasMore: Boolean(nextPage),
    loadingMore,
    loadMore,
    loadResults,
    getResultsByTask,
    getStatistics,
    exportResults,
  };
};
