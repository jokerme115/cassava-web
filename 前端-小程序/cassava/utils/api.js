// utils/api.js — 后端接口封装
const { request, upload } = require('./request');
const config = require('./config');

/**
 * 解析统一包裹格式 { success, message, data }
 */
function unwrap(data) {
  if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
    return data.data;
  }
  return data;
}

/**
 * 解析后端列表响应为数组（可能是数组、{results}、{success,data:[...]}）
 */
function normalizeList(data) {
  const d = unwrap(data);
  if (!d) return [];
  if (Array.isArray(d)) return d;
  if (typeof d === 'object' && Array.isArray(d.results)) return d.results;
  if (typeof d === 'object' && Array.isArray(d.data)) return d.data;
  return [];
}

// ===== 认证 =====
const authApi = {
  // 登录：返回 { success, user, token }
  login(username, password) {
    return request({
      url: '/auth/login/',
      method: 'POST',
      data: { username, password }
    });
  },
  // 注册：{ email, password, email_code, username?, first_name? }
  register(data) {
    return request({
      url: '/auth/register/',
      method: 'POST',
      data
    });
  },
  // 发送验证码：{ email, purpose: 'register' }
  sendCode(email) {
    return request({
      url: config.SEND_CODE_PATH,
      method: 'POST',
      data: { email, purpose: 'register' }
    });
  },
  // 当前用户信息
  currentUser() {
    return request({ url: '/auth/user/', method: 'GET' });
  },
  // 退出登录
  logout() {
    return request({ url: '/auth/logout/', method: 'POST' });
  }
};

// ===== 图片库 =====
const imagesApi = {
  // 图片列表（游客只能看到白名单图片）
  list(params = {}) {
    return request({ url: '/images/', method: 'GET', data: params })
      .then((res) => normalizeList(res));
  },
  // 批量上传图片：filePaths -> 上传成功后返回图片对象数组（扁平化，含 id）
  uploadFiles(filePaths, folderId) {
    const formData = folderId ? { folder_id: String(folderId) } : {};
    // 逐个上传（小程序 uploadFile 一次一个文件）
    const tasks = filePaths.map((fp) => upload({
      url: '/images/upload-files/',
      filePath: fp,
      name: 'files',
      formData
    }).then((res) => {
      // upload-files 返回的是图片对象数组（或 {results: [...]}）
      if (Array.isArray(res)) return res;
      if (res && Array.isArray(res.results)) return res.results;
      if (res && typeof res === 'object') return [res];
      return [];
    }));
    return Promise.all(tasks).then((arrays) => {
      const all = [];
      arrays.forEach((a) => a.forEach((x) => all.push(x)));
      return all;
    });
  },
  remove(id) {
    return request({ url: '/images/' + id + '/', method: 'DELETE' });
  }
};

// ===== 预测 =====
const predictionsApi = {
  // 小程序专用预测：{ image_ids: [...] } -> { results, errors, processed_count }
  run(imageIds, params = {}) {
    return request({
      url: '/predictions/miniapp-run/',
      method: 'POST',
      data: Object.assign({ image_ids: imageIds }, params),
      timeout: 120000
    }).then((res) => unwrap(res));
  },
  // 预测结果列表（数组）
  list(params = {}) {
    return request({ url: '/predictions/', method: 'GET', data: params })
      .then((res) => normalizeList(res));
  },
  // 预测结果列表（带分页信息）
  listPage(params = {}) {
    return request({ url: '/predictions/', method: 'GET', data: params })
      .then((res) => {
        const d = unwrap(res) || {};
        return {
          items: normalizeList(d),
          count: d.count,
          next: d.next
        };
      });
  },
  // 单个预测结果
  getById(id) {
    return request({ url: '/predictions/' + id + '/', method: 'GET' })
      .then((res) => unwrap(res));
  }
};

// ===== 系统信息 =====
const systemApi = {
  status() {
    return request({ url: '/status/', method: 'GET' });
  },
  publicSettings() {
    return request({ url: '/system/settings/public/', method: 'GET' });
  },
  publicStats() {
    return request({ url: '/analytics/public-stats/', method: 'GET' });
  }
};

module.exports = {
  authApi,
  imagesApi,
  predictionsApi,
  systemApi,
  normalizeList,
  unwrap
};
