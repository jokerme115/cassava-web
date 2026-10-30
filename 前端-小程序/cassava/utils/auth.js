// utils/auth.js — 登录态管理
const config = require('./config');
const { getToken } = require('./request');

function getTokenSync() {
  return getToken();
}

function getUser() {
  return wx.getStorageSync(config.STORAGE_KEYS.USER) || null;
}

function setAuth(token, user) {
  if (token) wx.setStorageSync(config.STORAGE_KEYS.TOKEN, token);
  if (user) wx.setStorageSync(config.STORAGE_KEYS.USER, user);
}

function clearAuth() {
  wx.removeStorageSync(config.STORAGE_KEYS.TOKEN);
  wx.removeStorageSync(config.STORAGE_KEYS.USER);
}

function isLoggedIn() {
  return !!getTokenSync();
}

/**
 * 检查登录态，未登录则跳转登录页
 * @returns {boolean} 是否已登录
 */
function requireLogin() {
  if (isLoggedIn()) return true;
  wx.navigateTo({ url: '/pages/login/login' });
  return false;
}

module.exports = {
  getToken: getTokenSync,
  getUser,
  setAuth,
  clearAuth,
  isLoggedIn,
  requireLogin
};
