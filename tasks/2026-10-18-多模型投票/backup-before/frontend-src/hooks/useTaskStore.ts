import { useState, useEffect, useCallback, useRef } from 'react';
import { PredictionTask } from '../types';
import { tasksApi } from '../services/api';
import { message } from 'antd';
import i18n from '../i18n';

export const useTaskStore = (currentUser?: any) => {
  const [tasks, setTasks] = useState<PredictionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const completedSignatureRef = useRef('');

  const loadTasks = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = currentUser?.is_guest ? { user_id: currentUser.id } : {};
      const data = await tasksApi.getAll(params);
      const nextTasks = data.items || [];
      setTasks(nextTasks);
      const completedSignature = nextTasks
        .filter((task: PredictionTask) => task.status === 'completed')
        .map((task: PredictionTask) => `${task.id}:${task.updated_time ?? ''}`)
        .join('|');
      if (completedSignatureRef.current && completedSignature !== completedSignatureRef.current) {
        window.dispatchEvent(new CustomEvent('results:reload'));
      }
      completedSignatureRef.current = completedSignature;
    } catch (error) {
      if (!silent) message.error(i18n.t('tasks.load_failed'));
      console.error(error);
      if (!silent) setTasks([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadTasks();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadTasks(true);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [loadTasks]);

  const createTask = async (taskData: any) => {
    try {
      const {
        name,
        modelType,
        batchSize,
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

  const getTasksByStatus = (status?: string) => {
    if (!status) return tasks;
    return tasks.filter(task => task.status === status);
  };

  const getTaskStatistics = () => {
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
    loading,
    loadTasks,
    createTask,
    cancelTask,
    deleteTask,
    getTasksByStatus,
    getTaskStatistics,
  };
};
