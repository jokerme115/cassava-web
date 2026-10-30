// utils/request.js — 网络请求封装
const config = require('./config');

/**
 * 获取登录 Token
 */
function getToken() {
  return wx.getStorageSync(config.STORAGE_KEYS.TOKEN) || '';
}

/**
 * 构建请求头
 */
function buildHeader(custom = {}) {
  const header = {
    'Content-Type': 'application/json'
  };
  const token = getToken();
  if (token) {
    header['Authorization'] = 'Token ' + token;
  }
  if (config.MINIAPP_TOKEN) {
    header['X-Miniapp-Token'] = config.MINIAPP_TOKEN;
  }
  return Object.assign(header, custom);
}

/**
 * 统一请求（JSON）
 * @param {object} options { url, method, data, header, timeout }
 */
function request(options) {
  const url = options.url || '';
  const full = /^https?:\/\//.test(url) ? url : config.BASE_URL + url;

  return new Promise((resolve, reject) => {
    wx.request({
      url: full,
      method: options.method || 'GET',
      data: options.data || {},
      header: buildHeader(options.header),
      timeout: options.timeout || 30000,
      success(res) {
        const status = res.statusCode;
        if (status >= 200 && status < 300) {
          resolve(res.data);
        } else {
          reject(normalizeError(status, res.data));
        }
      },
      fail(err) {
        const e = makeError('E1001', '网络连接失败，请检查网络后重试');
        e.cause = err;
        reject(e);
      }
    });
  });
}

/**
 * 统一上传（multipart/form-data）
 * @param {object} options { url, filePath, name, formData }
 */
function upload(options) {
  const url = options.url || '';
  const full = /^https?:\/\//.test(url) ? url : config.BASE_URL + url;

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: full,
      filePath: options.filePath,
      name: options.name || 'file',
      formData: options.formData || {},
      header: buildHeader({ 'Content-Type': 'multipart/form-data' }),
      timeout: options.timeout || 60000,
      success(res) {
        const status = res.statusCode;
        let data = res.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (e) {
            data = { raw: res.data };
          }
        }
        if (status >= 200 && status < 300) {
          resolve(data);
        } else {
          reject(normalizeError(status, data));
        }
      },
      fail(err) {
        const e = makeError('E1001', '上传失败，请检查网络后重试');
        e.cause = err;
        reject(e);
      }
    });
  });
}

/**
 * 构造带错误码的 Error 对象
 */
function makeError(code, msg) {
  const e = new Error(msg);
  e.code = code;
  return e;
}

/**
 * 把后端错误统一成面向用户的友好话术 + 错误码
 * 错误码用于日志/埋点，用户话术用于 toast 展示
 */
function normalizeError(status, data) {
  const serverMsg = data && typeof data === 'object'
    ? (data.error || data.detail || data.message || '')
    : '';

  let code = 'E500';
  let msg = '服务器繁忙，请稍后重试';

  if (status === 401) {
    code = 'E401';
    msg = '登录已过期，请重新登录';
  } else if (status === 403) {
    code = 'E403';
    msg = '没有操作权限';
  } else if (status === 404) {
    code = 'E404';
    msg = '服务升级中，请稍后重试';
  } else if (status === 429) {
    code = 'E429';
    msg = '操作太频繁，请稍后再试';
  } else if (status >= 500) {
    code = 'E500';
    msg = '服务器繁忙，请稍后重试';
  } else if (status === 400) {
    code = 'E400';
    msg = '请求有误，请重试';
  } else {
    code = 'E' + status;
    msg = '操作失败，请重试';
  }

  // 后端返回了明确业务提示（如「用户名或密码错误」）时优先采用，但仍带错误码
  if (serverMsg && serverMsg !== '身份认证信息未提供。') {
    msg = serverMsg;
  }

  const e = makeError(code, msg);
  e.statusCode = status;
  e.data = data;
  return e;
}

/**
 * 判断是否是认证失效（401），用于引导重新登录
 */
function isAuthError(err) {
  return err && (err.statusCode === 401 || err.code === 'E401');
}

module.exports = {
  request,
  upload,
  getToken,
  isAuthError,
  buildHeader
};
