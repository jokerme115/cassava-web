// pages/mine/mine.js
const auth = require('../../utils/auth');
const { systemApi, authApi } = require('../../utils/api');

Page({
  data: {
    loggedIn: false,
    userName: '',
    userEmail: '',
    avatarText: '木',
    stats: {
      images: 0,
      predictions: 0,
      visits: 0
    }
  },

  onShow() {
    const loggedIn = auth.isLoggedIn();
    const user = auth.getUser() || {};
    const name = user.username || user.first_name || '';
    this.setData({
      loggedIn,
      userName: name || '已登录',
      userEmail: user.email || '',
      avatarText: name ? name.slice(0, 1).toUpperCase() : '木'
    });
    this.loadStats();
  },

  loadStats() {
    systemApi.publicStats()
      .then((res) => {
        this.setData({
          stats: {
            images: res.images_predicted_count || 0,
            predictions: res.prediction_usage_count || 0,
            visits: res.visit_count || 0
          }
        });
      })
      .catch(() => {});
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  goRegister() {
    wx.navigateTo({ url: '/pages/register/register' });
  },

  showAbout() {
    wx.showModal({
      title: '关于平台',
      content: '木薯腐烂面积精准量化平台，基于深度学习自动识别木薯切面腐烂区域，计算腐烂面积占比（PPD）。' +
        '为田间检测与实验室研究提供便捷工具。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  showIntro() {
    wx.removeStorageSync('cassava_intro_seen');
    wx.reLaunch({ url: '/pages/intro/intro' });
  },

  showGuide() {
    wx.showModal({
      title: '使用说明',
      content: '1. 登录账号\n2. 拍照或从相册选择木薯切面照片\n3. 点击「开始检测」\n4. 查看腐烂面积占比与可视化结果\n\n建议：拍摄时保持光线均匀、腐烂区域清晰。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  clearCache() {
    wx.showModal({
      title: '清除缓存',
      content: '将清除本地保存的历史记录，云端数据不受影响。确定清除？',
      confirmText: '清除',
      confirmColor: '#E53935',
      success: (res) => {
        if (!res.confirm) return;
        wx.removeStorageSync('cassava_local_history');
        wx.showToast({ title: '已清除', icon: 'success' });
      }
    });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定退出当前账号？',
      confirmText: '退出',
      confirmColor: '#E53935',
      success: (res) => {
        if (!res.confirm) return;
        // 通知后端吊销 Token（失败不阻塞本地退出）
        authApi.logout().catch(() => {});
        auth.clearAuth();
        this.setData({
          loggedIn: false,
          userName: '',
          userEmail: ''
        });
        wx.showToast({ title: '已退出', icon: 'success' });
      }
    });
  }
});
