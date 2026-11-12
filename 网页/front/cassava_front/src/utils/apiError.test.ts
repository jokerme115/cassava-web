import { describe, expect, it } from 'vitest';
import { getApiErrorMessage, PERMISSION_DENIED_MESSAGE, SESSION_EXPIRED_MESSAGE } from './apiError';

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

  it('403 没有可读原因时明确说是权限问题', () => {
    expect(getApiErrorMessage({ response: { status: 403, data: { success: false } } }, '删除失败')).toBe(
      PERMISSION_DENIED_MESSAGE,
    );
    expect(getApiErrorMessage({ response: { status: 403, data: {} } }, '删除失败')).toBe(PERMISSION_DENIED_MESSAGE);
    expect(getApiErrorMessage({ response: { status: 403 } }, '删除失败')).toBe(PERMISSION_DENIED_MESSAGE);
  });

  it('403 带服务端 detail 时用服务端文案', () => {
    const error = { response: { status: 403, data: { detail: '您没有执行该操作的权限。' } } };
    expect(getApiErrorMessage(error, '删除失败')).toBe('您没有执行该操作的权限。');
  });

  it('401 提示重新登录', () => {
    expect(getApiErrorMessage({ response: { status: 401 } }, '保存失败')).toBe(SESSION_EXPIRED_MESSAGE);
    expect(getApiErrorMessage({ response: { status: 401, data: { detail: '身份认证信息未提供。' } } }, '保存失败')).toBe(
      SESSION_EXPIRED_MESSAGE,
    );
  });

  it('其它状态码仍回落原兜底文案', () => {
    expect(getApiErrorMessage({ response: { status: 500, data: {} } }, '导出失败，请重试')).toBe('导出失败，请重试');
    expect(getApiErrorMessage({ response: { status: 502 } }, '导出失败，请重试')).toBe('导出失败，请重试');
  });
});
