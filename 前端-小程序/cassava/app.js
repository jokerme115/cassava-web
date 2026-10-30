// app.js
const { systemApi } = require('./utils/api');

App({
  globalData: {
    // 当前待预测图片（本地临时路径列表）
    pendingImages: [],
    // 最近一次预测结果（内存传递，避免频繁读写 storage）
    lastResults: null,
    // 系统公开信息（首页/统计展示用）
    publicStats: null,
    systemInfo: null
  },

  onLaunch() {
    // 预取公开统计信息（失败静默，不影响使用）
    this.fetchPublicStats();

    // 检查更新
    if (wx.canIUse('getUpdateManager')) {
      const updateManager = wx.getUpdateManager();
      updateManager.onUpdateReady(() => {
        wx.showModal({
          title: '更新提示',
          content: '新版本已经准备好，是否重启应用？',
          success(res) {
            if (res.confirm) updateManager.applyUpdate();
          }
        });
      });
    }
  },

  fetchPublicStats() {
    systemApi.publicStats()
      .then((stats) => {
        this.globalData.publicStats = stats;
      })
      .catch(() => {});
  }
});
