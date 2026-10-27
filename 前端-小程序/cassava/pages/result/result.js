// pages/result/result.js
const { predictionsApi } = require('../../utils/api');
const { resolveUrl } = require('../../utils/config');
const app = getApp();

// PPD 值归一化：unit='ratio' 时乘以 100，否则视为百分比
function normalizePpd(value, unit) {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  const pct = unit === 'ratio' ? n * 100 : n;
  return Math.max(0, Math.min(100, pct));
}

function clamp100(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

// 从 vis_images 里按前缀提取子图 URL 列表（pred_ 预测叠加 / cut2_ 二次分割）
function visGroup(vis, prefix) {
  if (!vis || typeof vis !== 'object') return [];
  return Object.keys(vis)
    .filter((k) => k.indexOf(prefix) === 0 && vis[k])
    .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
    .map((k) => resolveUrl(vis[k]));
}

function getLevelMeta(ppd) {
  if (ppd < 4) {
    return {
      levelText: '健康 / 轻微',
      levelTag: 'tag-success',
      suggestions: ['通风干燥，避免受潮堆放', '尽快加工处理']
    };
  }
  if (ppd < 7) {
    return {
      levelText: '轻度腐烂',
      levelTag: 'tag-info',
      suggestions: ['尽快分拣加工', '检查温湿度与通风']
    };
  }
  if (ppd < 12) {
    return {
      levelText: '中度腐烂',
      levelTag: 'tag-warning',
      suggestions: ['单独存放，防止交叉污染', '优先淘汰腐烂样本']
    };
  }
  return {
    levelText: '重度腐烂',
    levelTag: 'tag-danger',
    suggestions: ['及时淘汰并规范处置', '排查储藏与运输环节']
  };
}

Page({
  data: {
    loaded: false,
    loading: false,
    batchItems: [],
    selectedIndex: 0,
    result: null,

    ppdPercent: '0.00',
    ppdDisplay: '0.00',
    levelText: '',
    levelTag: 'tag-success',
    imageName: '—',
    suggestions: [],
    loadError: false,

    viewTab: 'original',
    viewTabs: [],
    currentViewUrl: '',
    subPpdList: [],
    predImages: [],
    cut2Images: []
  },

  onLoad(options) {
    this._options = options || {};
    const id = options && options.id;
    if (id) {
      this.loadById(id);
    } else {
      this.loadFromGlobal();
    }
  },

  onUnload() {
    if (this._numTimer) clearInterval(this._numTimer);
  },

  retry() {
    const options = this._options || {};
    if (options.id) this.loadById(options.id);
    else this.loadFromGlobal();
  },

  // 从全局缓存读取（预测后跳转）
  loadFromGlobal() {
    this.setData({ loadError: false });
    const data = app.globalData.lastResults;
    if (!data || !data.results || !data.results.length) {
      this.setData({ loading: true });
      // 无缓存则尝试拉取最近预测列表
      predictionsApi.list({ page_size: 10 })
        .then((list) => {
          this.setData({ loading: false });
          if (!list.length) {
            this.setData({ loaded: true });
            return;
          }
          this.setupBatch(list.map((r) => this.toBatchItem(r)));
        })
        .catch(() => {
          this.setData({ loading: false, loaded: true, loadError: true });
        });
      return;
    }
    this.setupBatch(data.results.map((r) => this.toBatchItem(r)));
  },

  loadById(id) {
    this.setData({ loading: true, loadError: false });
    predictionsApi.getById(id)
      .then((res) => {
        this.setData({ loading: false });
        this.setupBatch([this.toBatchItem(res)]);
      })
      .catch(() => {
        this.setData({ loading: false, loaded: true, loadError: true });
      });
  },

  toBatchItem(r) {
    const url = resolveUrl(r.original_image_url || r.originalImageUrl || r.image_url || '');
    return {
      id: r.id,
      payload: r,
      thumb: url
    };
  },

  setupBatch(items) {
    const batchItems = items.map((it, i) => ({
      ...it,
      _key: it.id !== undefined && it.id !== null ? String(it.id) : 'k' + i
    }));
    this.setData({
      loaded: true,
      batchItems,
      selectedIndex: 0
    });
    if (batchItems.length) this.applyResult(batchItems[0].payload);
  },

  selectBatch(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const item = this.data.batchItems[idx];
    if (!item) return;
    this.setData({ selectedIndex: idx });
    this.applyResult(item.payload);
  },

  applyResult(r) {
    const ppd = normalizePpd(r.ppd_value, r.ppd_unit);
    const meta = getLevelMeta(ppd);

    // 图像查看 tab（只保留后端真实返回的视图）
    const viewTabs = [];
    const pushTab = (key, label, url) => {
      if (url) viewTabs.push({ key, label, url: resolveUrl(url) });
    };
    pushTab('original', '原图', r.original_image_url || r.originalImageUrl);
    pushTab('result', '检测结果', r.result_image_url || r.resultImageUrl || r.oss_key);

    // 子图：预测叠加（pred_）与二次分割（cut2_），来自后端 vis_images
    const vis = r.vis_images || r.visImages || {};
    const predImages = visGroup(vis, 'pred_');
    const cut2Images = visGroup(vis, 'cut2_');

    // 子图 PPD
    const subRaw = r.sub_ppd_values || r.subPpdValues || [];
    const subPpdList = (Array.isArray(subRaw) ? subRaw : []).map((v) => clamp100(normalizePpd(v, r.ppd_unit)).toFixed(2));

    this.setData({
      result: r,
      ppdPercent: ppd.toFixed(2),
      levelText: meta.levelText,
      levelTag: meta.levelTag,
      suggestions: meta.suggestions,
      imageName: r.original_image_name || r.originalImageName || r.imageName || '—',
      viewTabs,
      viewTab: viewTabs.length ? viewTabs[0].key : 'original',
      currentViewUrl: viewTabs.length ? viewTabs[0].url : '',
      subPpdList,
      predImages,
      cut2Images
    });

    // PPD 数字滚动动画
    this.animateNumber(ppd);
  },

  // 数字从 0 缓动滚动到目标值（苹果风格）
  animateNumber(target) {
    if (this._numTimer) clearInterval(this._numTimer);
    const duration = 900;
    const startTime = Date.now();
    this._numTimer = setInterval(() => {
      const progress = Math.min((Date.now() - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      const current = target * eased;
      this.setData({ ppdDisplay: current.toFixed(2) });
      if (progress >= 1) {
        clearInterval(this._numTimer);
        this._numTimer = null;
        this.setData({ ppdDisplay: target.toFixed(2) });
      }
    }, 16);
  },

  switchTab(e) {
    const key = e.currentTarget.dataset.key;
    const tab = this.data.viewTabs.find((t) => t.key === key);
    if (!tab) return;
    this.setData({ viewTab: key, currentViewUrl: tab.url });
  },

  previewCurrent() {
    if (this.data.currentViewUrl) {
      wx.previewImage({ current: this.data.currentViewUrl, urls: [this.data.currentViewUrl] });
    }
  },

  // 预览子图（同组可左右滑动）
  previewGroup(e) {
    const { group, index } = e.currentTarget.dataset;
    const urls = group === 'cut2' ? this.data.cut2Images : this.data.predImages;
    if (!urls.length) return;
    wx.previewImage({ current: urls[index] || urls[0], urls });
  },

  // 保存到本地历史
  saveResult() {
    const r = this.data.result;
    if (!r) {
      wx.showToast({ title: '暂无可保存的结果', icon: 'none' });
      return;
    }
    const key = 'cassava_local_history';
    const list = wx.getStorageSync(key) || [];
    list.unshift({
      id: r.id || Date.now(),
      ppd: this.data.ppdPercent,
      levelText: this.data.levelText,
      imageName: this.data.imageName,
      thumb: resolveUrl(r.original_image_url || ''),
      time: Date.now()
    });
    wx.setStorageSync(key, list.slice(0, 100));
    wx.showToast({ title: '已保存到历史', icon: 'success' });
  },

  reDetect() {
    wx.switchTab({ url: '/pages/predict/predict' });
  }
});
