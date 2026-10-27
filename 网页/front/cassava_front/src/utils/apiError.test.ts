import { describe, expect, it } from 'vitest';
import { getApiErrorMessage } from './apiError';

describe('getApiErrorMessage', () => {
  it('透出 DRF 的 detail 文案', () => {
    const error = { response: { data: { detail: '身份认证信息未提供。' } } };
    expect(getApiErrorMessage(error, '默认')).toBe('身份认证信息未提供。');
  });

  it('把字段级校验错误拼成一行', () => {
    const error = {
      response: {
        data: {
          algorithm: ['不支持的预测模型「x」。'],
          single_model_type: ['模型「y」的权重文件缺失。'],
        },
      },
    };
    expect(getApiErrorMessage(error, '默认')).toBe(
      '不支持的预测模型「x」。；模型「y」的权重文件缺失。',
    );
  });

  it('兼容 envelope 里的 error 字段', () => {
    const error = { response: { data: { success: false, error: '会话已超时，请重新登录' } } };
    expect(getApiErrorMessage(error, '默认')).toBe('会话已超时，请重新登录');
  });

  it('响应体是字符串时直接用', () => {
    expect(getApiErrorMessage({ response: { data: '服务器开小差了' } }, '默认')).toBe('服务器开小差了');
  });

  it('没有响应体时用异常自身的 message', () => {
    expect(getApiErrorMessage(new Error('Network Error'), '创建任务失败')).toBe('Network Error');
  });

  it('连 message 都没有时回落', () => {
    expect(getApiErrorMessage(null, '创建任务失败')).toBe('创建任务失败');
    expect(getApiErrorMessage({}, '创建任务失败')).toBe('创建任务失败');
  });
});
