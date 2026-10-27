// pages/intro/intro.js
const INTRO_SEEN_KEY = 'cassava_intro_seen';

Page({
  data: {
    current: 0,
    slides: [
      {
        icon: '/static/images/intro/leaf.png',
        title: '木薯 PPD 智能检测',
        desc: '品质一体化无损快速筛选平台',
        highlight: ''
      },
      {
        icon: '/static/images/intro/warn.png',
        title: '采后腐烂 损失超 30%',
        desc: '收获后 48 小时软腐病迅速蔓延，传统人工检测费时且误差大',
        highlight: ''
      },
      {
        icon: '/static/images/intro/ai.png',
        title: 'MSCD-Net 深度模型',
        desc: 'AI 自动分割腐烂区域，精准计算面积占比',
        highlight: ''
      },
      {
        icon: '/static/images/intro/speed.png',
        title: '秒级出结果',
        desc: '2653 张样本验证 · 已发表于 Plant Phenomics',
        highlight: '误差 < 2.1%'
      },
      {
        icon: '/static/images/intro/check.png',
        title: '开始检测',
        desc: '拍照上传，立即获取腐烂面积占比',
        highlight: ''
      }
    ]
  },

  onLoad() {
    // 已看过则直接进入
    if (wx.getStorageSync(INTRO_SEEN_KEY)) {
      wx.switchTab({ url: '/pages/predict/predict' });
    }
  },

  onChange(e) {
    this.setData({ current: e.detail.current });
  },

  start() {
    wx.setStorageSync(INTRO_SEEN_KEY, true);
    wx.switchTab({ url: '/pages/predict/predict' });
  }
});
