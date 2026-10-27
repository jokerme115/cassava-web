// utils/config.js — 全局配置

// 后端 API 基础地址（线上生产环境）
const BASE_URL = 'https://www.cassavappd.com/api';

// 图片 / 结果资源地址前缀（用于拼接相对路径）
const MEDIA_ORIGIN = 'https://www.cassavappd.com';

// 小程序受信令牌（可选）。后端 settings 里配置 MINIAPP_ACCESS_TOKEN 后，
// 请求头带 X-Miniapp-Token 可让小程序以“官方客户端”身份访问部分接口。
// 若后端未配置，保持空字符串即可（此时依赖用户登录 Token）。
const MINIAPP_TOKEN = '';

// 发送注册验证码接口路径（相对 BASE_URL）。
// 已在服务器 predict/urls.py 核实：path('auth/email/code/', auth_views.send_email_code)。
// 后端接收 { email, purpose }，purpose 固定传 'register'。
const SEND_CODE_PATH = '/auth/email/code/';

// 本地存储 key
const STORAGE_KEYS = {
  TOKEN: 'cassava_token',
  USER: 'cassava_user',
  LOCAL_HISTORY: 'cassava_local_history'
};

/**
 * 把后端返回的资源 URL 转成可访问的完整地址。
 * 后端 local 存储模式返回相对路径（如 /media/images/xxx.jpg），
 * OSS 模式返回完整签名 URL，这里统一处理两种情况。
 */
function resolveUrl(url) {
  if (!url) return '';
  const s = String(url);
  if (/^https?:\/\//.test(s)) return s;
  if (s.startsWith('//')) return 'https:' + s;
  if (s.startsWith('/')) return MEDIA_ORIGIN + s;
  return MEDIA_ORIGIN + '/' + s;
}

module.exports = {
  BASE_URL,
  MEDIA_ORIGIN,
  MINIAPP_TOKEN,
  SEND_CODE_PATH,
  STORAGE_KEYS,
  resolveUrl
};
