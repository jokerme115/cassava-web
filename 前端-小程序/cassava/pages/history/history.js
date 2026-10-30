// pages/history/history.js
const { predictionsApi } = require('../../utils/api');
const auth = require('../../utils/auth');
const { resolveUrl } = require('../../utils/config');
const { isAuthError } = require('../../utils/request');

const PAGE_SIZE = 20;

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

Page({
  data: {
    loggedIn: false,
    tab: 'cloud',
    cloudList: [],
    localList: [],
    page: 1,
    hasMore: true,
    loadingMore: false,
    cloudError: false,
    cloudLoading: false
  },

  onShow() {
    const loggedIn = auth.isLoggedIn();
    this.setData({ loggedIn });
    this.loadLocal();
    if (loggedIn) {
      this.loadCloud(true);
    }
  },

  onPullDownRefresh() {
    if (auth.isLoggedIn()) {
      this.loadCloud(true).then(() => wx.stopPullDownRefresh());
    } else {
      wx.stopPullDownRefresh();
    }
  },

  onReachBottom() {
    if (this.data.loggedIn && this.data.tab === 'cloud') {
      this.loadMore();
    }
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  retryCloud() {
    this.loadCloud(true);
  },

  loadLocal() {
    const key = 'cassava_local_history';
    const raw = wx.getStorageSync(key) || [];
    const localList = raw.map((r) => ({
      id: r.id,
      thumb: r.thumb,
      imageName: r.imageName || '未命名',
      ppd: r.ppd || '0.00',
      levelText: r.levelText || '',
      timeText: r.time ? fmtTime(r.time) : '—'
    }));
    this.setData({ localList });
  },

  mapCloudItem(r) {
    const ppd = this.normalizePpd(r.ppd_value, r.ppd_unit);
    return {
      id: r.id,
      thumb: resolveUrl(r.original_image_url || r.originalImageUrl || ''),
      name: r.original_image_name || r.originalImageName || '图片',
      ppd: ppd.toFixed(2),
      time: fmtTime(r.prediction_time || r.predictionTime || r.created_at)
    };
  },

  // 首次加载 / 刷新（reset=true）
  loadCloud() {
    this.setData({ cloudLoading: true, cloudError: false });
    return predictionsApi.listPage({ page: 1, page_size: PAGE_SIZE })
      .then((res) => {
        const cloudList = res.items.map((r) => this.mapCloudItem(r));
        this.setData({
          cloudList,
          loggedIn: true,
          page: 1,
          hasMore: !!res.next,
          cloudLoading: false
        });
      })
      .catch((err) => {
        this.setData({ cloudLoading: false });
        if (isAuthError(err)) {
          auth.clearAuth();
          this.setData({ loggedIn: false });
        } else {
          this.setData({ cloudError: true });
        }
      });
  },

  // 加载下一页
  loadMore() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.cloudLoading) return;
    this.setData({ loadingMore: true });
    const nextPage = this.data.page + 1;
    predictionsApi.listPage({ page: nextPage, page_size: PAGE_SIZE })
      .then((res) => {
        const more = res.items.map((r) => this.mapCloudItem(r));
        this.setData({
          cloudList: this.data.cloudList.concat(more),
          page: nextPage,
          hasMore: !!res.next,
          loadingMore: false
        });
      })
      .catch(() => {
        this.setData({ loadingMore: false });
      });
  },

  normalizePpd(value, unit) {
    const n = Number(value);
    if (Number.isNaN(n)) return 0;
    const pct = unit === 'ratio' ? n * 100 : n;
    return Math.max(0, Math.min(100, pct));
  },

  openResult(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/result/result?id=' + id });
  },

  openLocalResult(e) {
    wx.showToast({ title: '本地记录仅存摘要，请从云端查看完整结果', icon: 'none' });
  }
});
