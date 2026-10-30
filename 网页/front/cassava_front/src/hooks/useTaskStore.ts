import { message } from '../utils/feedback';
import api from '../services/rest/client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { PredictionTask } from '../types';
import { tasksApi } from '../services/api';

import i18n from '../i18n';
import { getApiErrorMessage } from '../utils/apiError';

export const useTaskStore = (currentUser?: any, scope?: { search: string; status: string; page: number; pageSize: number; onInvalidPage?: () => void }) => {
  const [tasks, setTasks] = useState<PredictionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const completedSignatureRef = useRef('');
  const sequenceRef = useRef(0);
  const [totalCount, setTotalCount] = useState(0);
  const [aggregate, setAggregate] = useState<any>(null);
  const { search = '', status = '', page: selectedPage = 1, pageSize = 30 } = scope || {};
  const paginated = Boolean(scope);
  const invalidPageRef = useRef(scope?.onInvalidPage); invalidPageRef.current = scope?.onInvalidPage;

  const loadTasks = useCallback(async (silent = false) => {
    const sequence = ++sequenceRef.current;
    if (!silent) setLoading(true);
    try {
      const params = { ...(currentUser?.is_guest ? { user_id: currentUser.id } : {}), ...(paginated ? { search, status } : {}) };
      let data = await tasksApi.getAll({ ...params, page: paginated ? selectedPage : 1, page_size: paginated ? pageSize : 100 });
      if (sequence !== sequenceRef.current) return;
      setTotalCount(data.count ?? data.items.length);
      if (paginated) {
        const response = await api.get('/tasks/summary/', { params });
        if (sequence !== sequenceRef.current) return;
        setAggregate(response.data);
      }
      const nextTasks = [...(data.items || [])];
      let page = 1;
      while (!paginated && data.next) {
        data = await tasksApi.getAll({ ...params, page: ++page, page_size: 100 });
        nextTasks.push(...(data.items || []));
      }
      if (sequence !== sequenceRef.current) return;
      setTasks(nextTasks);
      const completedSignature = nextTasks
        .filter((task: PredictionTask) => task.status === 'completed')
        .map((task: PredictionTask) => `${task.id}:${task.updated_time ?? ''}`)
        .join('|');
      if (completedSignatureRef.current && completedSignature !== completedSignatureRef.current) {
        window.dispatchEvent(new CustomEvent('results:reload'));
      }
      completedSignatureRef.current = completedSignature;
    } catch (error: any) {
      if (sequence !== sequenceRef.current) return;
      if (paginated && selectedPage > 1 && error?.response?.status === 404 && invalidPageRef.current) { invalidPageRef.current(); return; }
      if (!silent) message.error(i18n.t('tasks.load_failed'));
      console.error(error);
      if (!silent) setTasks([]);
    } finally {
      if (!silent && sequence === sequenceRef.current) setLoading(false);
    }
  }, [currentUser, paginated, search, status, selectedPage, pageSize]);

  useEffect(() => {
    void loadTasks();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadTasks(true);
    }, 2500);
    return () => { sequenceRef.current++; window.clearInterval(timer); };
  }, [loadTasks]);

  const createTask = async (taskData: any) => {
    try {
      const {
        name,
        modelType,
        batchSize,
        predictionMode,
        confidence,
        selectedItems,
        selectionType,
        parameters,
        single_model_type,
      } = taskData;

      const payload: any = {
        name,
        type: 'prediction',
        algorithm: modelType,
        threshold: parameters?.confidenceThreshold ?? confidence,
        min_size: parameters?.minArea,
        method: parameters?.usePostProcessing ? 'post' : undefined,
        split_count: batchSize,
        parameters: {
          ...parameters,
          predictionMode: predictionMode ?? parameters?.predictionMode ?? 'single',
          confidenceThreshold: parameters?.confidenceThreshold ?? confidence,
          minArea: parameters?.minArea,
        },
      };

      if (selectionType === 'images' && selectedItems.length > 0) {
        payload.image_ids = selectedItems;
      } else if (selectionType === 'folders' && selectedItems.length > 0) {
        payload.folder_ids = selectedItems;
      }

      if (single_model_type) {
        payload.single_model_type = single_model_type;
      }

      Object.keys(payload).forEach((key) => {
        if (payload[key] === undefined || payload[key] === null) {
          delete payload[key];
        }
      });

      const createdTask = await tasksApi.createPredictionTask(payload);
      void loadTasks(true);
      message.success(i18n.t('tasks.create_success'));
      return createdTask;
    } catch (error) {
      message.error(i18n.t('tasks.create_failed'));
      console.error(error);
      throw error;
    }
  };

  const cancelTask = async (taskId: string) => {
    try {
      await tasksApi.cancel(taskId);
      void loadTasks(true);
      message.success(i18n.t('tasks.cancel_success'));
    } catch (error) {
      message.error(i18n.t('tasks.cancel_failed'));
      console.error(error);
    }
  };

  const deleteTask = async (taskId: number | string) => {
    await tasksApi.deleteTask(taskId);
    await loadTasks();
  };

  // 失败任务重新提交：复用原任务的输入与参数，生成一个新任务
  const retryTask = async (task: PredictionTask) => {
    const raw = task as any;
    const payload: any = {
      name: `${task.name} - ${i18n.t('tasks.retry')}`,
      type: raw.type || 'prediction',
      algorithm: raw.algorithm,
      threshold: raw.threshold,
      min_size: raw.min_size,
      split_count: raw.split_count,
      method: raw.method,
      parameters: raw.parameters,
    };
    if (Array.isArray(raw.image_ids) && raw.image_ids.length > 0) {
      payload.image_ids = raw.image_ids;
    }
    if (Array.isArray(raw.folder_ids) && raw.folder_ids.length > 0) {
      payload.folder_ids = raw.folder_ids;
    }
    if (raw.single_model_type) {
      payload.single_model_type = raw.single_model_type;
    }
    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined || payload[key] === null) delete payload[key];
    });

    try {
      const created = await tasksApi.createPredictionTask(payload);
      void loadTasks(true);
      message.success(i18n.t('tasks.retry_success'));
      return created;
    } catch (error: any) {
      // 后端现在会因为模型名写错、权重缺失等直接返回 400 并给出可读原因，
      // 重试失败时把它透出来，否则用户只看到一句「重新提交失败」。
      message.error(getApiErrorMessage(error, i18n.t('tasks.retry_failed')));
      console.error(error);
      throw error;
    }
  };

  const getTasksByStatus = (status?: string) => {
    if (!status) return tasks;
    return tasks.filter(task => task.status === status);
  };

  const getTaskStatistics = () => {
    if (paginated && aggregate) return { ...aggregate, successRate: aggregate.total ? Math.round(aggregate.completed / aggregate.total * 100) : 0 };
    const completed = tasks.filter(t => t.status === 'completed').length;
    const running = tasks.filter(t => t.status === 'running').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    const total = tasks.length;

    return {
      total,
      completed,
      running,
      failed,
      successRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  };

  return {
    tasks,
    totalCount,
    loading,
    loadTasks,
    createTask,
    cancelTask,
    deleteTask,
    retryTask,
    getTasksByStatus,
    getTaskStatistics,
  };
};
