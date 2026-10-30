import { describe, expect, it } from 'vitest';
import {
  normalizeFolder,
  normalizeImage,
  normalizePredictionResult,
  normalizeSystemSetting,
  normalizeTask,
} from './normalizers';

describe('normalizePredictionResult', () => {
  it('ratio 单位换算成百分比', () => {
    const result = normalizePredictionResult({ id: 7, ppd_value: 0.0267, ppd_unit: 'ratio' });
    expect(result.id).toBe('7');
    expect(result.ppdValue).toBeCloseTo(2.67, 4);
  });

  it('percent 单位保持原值', () => {
    const result = normalizePredictionResult({ id: 8, ppd_value: 2.67, ppd_unit: 'percent' });
    expect(result.ppdValue).toBeCloseTo(2.67, 4);
  });

  it('带上任务 id、图片名与子分数', () => {
    const result = normalizePredictionResult({
      id: 9,
      task_id: 63,
      image_name: 'S1039 (3).jpg',
      sub_ppd_values: [3.07, 3.5],
      error_code: 'MODEL_MISSING',
      error_message: '权重缺失',
    });
    expect(result.taskId).toBe('63');
    expect(result.imageName).toBe('S1039 (3).jpg');
    expect(result.subPpdValues).toEqual([3.07, 3.5]);
    expect(result.errorCode).toBe('MODEL_MISSING');
    expect(result.errorMessage).toBe('权重缺失');
    expect(result.ppdValue).toBe(0);
  });
});

describe('normalizeTask', () => {
  it('模型标签按 algorithm 兜底并补齐参数默认值', () => {
    const task = normalizeTask({ id: 63, algorithm: 'resnet101', image_ids: [261, 262], threshold: 0.1, min_size: 100 });
    expect(task.id).toBe('63');
    expect(task.imageCount).toBe(2);
    expect(task.parameters.confidenceThreshold).toBe(0.1);
    expect(task.parameters.minArea).toBe(100);
    expect(task.modelType).toBeTruthy();
  });

  it('服务端已给 parameters 时以它为准', () => {
    const task = normalizeTask({ id: 1, parameters: { confidenceThreshold: 0.55, minArea: 250 } });
    expect(task.parameters.confidenceThreshold).toBe(0.55);
    expect(task.parameters.minArea).toBe(250);
  });
});

describe('normalizeImage / normalizeFolder', () => {
  it('图片 id 转字符串并回落预览图地址', () => {
    const image = normalizeImage({ id: 5, preview_url: '/media/previews/5.jpg', folder: { id: 3 } });
    expect(image.id).toBe('5');
    expect(image.url).toBe('/media/previews/5.jpg');
    expect(image.folderId).toBe('3');
  });

  it('文件夹兼容 image_count 与 parent_id', () => {
    const folder = normalizeFolder({ id: 2, name: '单细胞', image_count: 30, parent_id: null });
    expect(folder.id).toBe('2');
    expect(folder.imageCount).toBe(30);
    expect(folder.parent).toBeUndefined();
  });
});

describe('normalizeSystemSetting', () => {
  it('同时给出驼峰与下划线两种写法', () => {
    const setting = normalizeSystemSetting({
      site_title: '木薯平台',
      allow_registration: false,
      upload_size_limit_mb: 40,
    });
    expect(setting.siteTitle).toBe('木薯平台');
    expect(setting.site_title).toBe('木薯平台');
    expect(setting.allowRegistration).toBe(false);
    expect(setting.uploadSizeLimitMb).toBe(40);
    expect(setting.maxDisplayImages).toBe(200);
  });
});
