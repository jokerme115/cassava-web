// pages/predict/predict.js
const { imagesApi, predictionsApi } = require('../../utils/api');
const auth = require('../../utils/auth');
const { isAuthError } = require('../../utils/request');
const { mapConcurrent } = require('../../utils/async');

const MAX_IMAGES = 9;
const UPLOAD_CONCURRENCY = 3;

Page({
  data: {
    loggedIn: false,
    images: [],        // 本地临时路径列表
    detecting: false,
    stageText: '',
    progress: 0
  },

  onShow() {
    this.setData({ loggedIn: auth.isLoggedIn() });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  // 选择来源（相册/拍照）
  showSourceSheet() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        if (res.tapIndex === 0) this.takePhoto();
        else this.chooseAlbum();
      }
    });
  },

  takePhoto() {
    this.pickImages(['camera'], 1);
  },

  chooseAlbum() {
    this.pickImages(['album'], MAX_IMAGES - this.data.images.length);
  },

  pickImages(sourceType, count) {
    if (count <= 0) return;
    wx.chooseMedia({
      count,
      mediaType: ['image'],
      sourceType,
      camera: 'back',
      sizeType: ['compressed'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath);
        if (!paths.length) return;
        this.setData({
          images: this.data.images.concat(paths).slice(0, MAX_IMAGES)
        });
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.includes('cancel')) return;
        wx.showToast({ title: '选择图片失败', icon: 'none' });
      }
    });
  },

  previewImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    wx.previewImage({ current: this.data.images[idx], urls: this.data.images });
  },

  removeImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const images = this.data.images.slice();
    images.splice(idx, 1);
    this.setData({ images });
  },

  // 压缩单张图片（失败退回原图）
  compressImage(path) {
    return new Promise((resolve) => {
      wx.compressImage({
        src: path,
        quality: 80,
        success: (res) => resolve(res.tempFilePath),
        fail: () => resolve(path)
      });
    });
  },

  // 开始检测
  async startDetect() {
    if (this.data.detecting) return;
    if (!this.data.images.length) {
      wx.showToast({ title: '请先添加图片', icon: 'none' });
      return;
    }
    if (!auth.isLoggedIn()) {
      this.goLogin();
      return;
    }

    this.setData({ detecting: true, progress: 0, stageText: '准备…' });

    try {
      const filePaths = this.data.images;
      const total = filePaths.length;

      // 1. 压缩图片（并发窗口=3，单张失败自动回退原图）
      let compressedCount = 0;
      const compressResults = await mapConcurrent(filePaths, UPLOAD_CONCURRENCY, async (path) => {
        const out = await this.compressImage(path);
        compressedCount += 1;
        this.setData({
          stageText: '处理图片 ' + compressedCount + '/' + total,
          progress: Math.round((compressedCount / total) * 15)
        });
        return out;
      });
      const compressed = compressResults.map((r) => r.value);

      // 2. 并发上传（窗口=3，单张失败不中断）
      let uploadedCount = 0;
      const uploadResults = await mapConcurrent(compressed, UPLOAD_CONCURRENCY, async (path) => {
        const res = await imagesApi.uploadFiles([path]);
        uploadedCount += 1;
        this.setData({
          stageText: '上传图片 ' + uploadedCount + '/' + total,
          progress: 15 + Math.round((uploadedCount / total) * 55)
        });
        return (res && res[0]) || null;
      });

      const uploaded = uploadResults
        .filter((r) => r.ok && r.value && r.value.id)
        .map((r) => r.value);
      const failedCount = total - uploaded.length;

      if (!uploaded.length) {
        throw new Error('图片上传失败，请重试');
      }

      const imageIds = uploaded.map((img) => img.id).filter(Boolean);

      // 3. 调用预测（miniapp-run 批量同步返回）
      this.setData({ stageText: 'AI 检测中…', progress: 75 });
      const runRes = await predictionsApi.run(imageIds);

      // 4. 保存结果到全局并跳转
      const results = (runRes && runRes.results) || [];
      const app = getApp();
      app.globalData.lastResults = {
        results,
        errors: (runRes && runRes.errors) || [],
        uploadedImages: uploaded
      };

      this.setData({ progress: 100, stageText: '检测完成' });
      setTimeout(() => {
        this.setData({ detecting: false, images: [] });
        wx.navigateTo({ url: '/pages/result/result' });
      }, 400);

      if (failedCount > 0) {
        wx.showToast({ title: failedCount + ' 张上传失败，已跳过', icon: 'none', duration: 2000 });
      }
    } catch (err) {
      this.setData({ detecting: false });
      if (isAuthError(err)) {
        auth.clearAuth();
        this.setData({ loggedIn: false });
        wx.showToast({ title: '登录已失效，请重新登录', icon: 'none' });
        setTimeout(() => this.goLogin(), 600);
      } else {
        wx.showToast({ title: err.message || '检测失败', icon: 'none', duration: 2500 });
      }
    }
  }
});
