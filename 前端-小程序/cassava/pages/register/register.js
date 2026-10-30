// pages/register/register.js
const { authApi } = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    email: '',
    code: '',
    username: '',
    password: '',
    showPwd: false,
    countdown: 0,
    loading: false
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer);
  },

  onEmail(e) { this.setData({ email: e.detail.value }); },
  onCode(e) { this.setData({ code: e.detail.value }); },
  onUsername(e) { this.setData({ username: e.detail.value }); },
  onPassword(e) { this.setData({ password: e.detail.value }); },
  togglePwd() { this.setData({ showPwd: !this.data.showPwd }); },

  validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },

  sendCode() {
    if (this.data.countdown > 0) return;
    const email = this.data.email.trim();
    if (!this.validEmail(email)) {
      wx.showToast({ title: '请输入正确的邮箱', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '发送中…', mask: true });
    authApi.sendCode(email)
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '验证码已发送', icon: 'success' });
        this.startCountdown();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({
          title: err.message || '发送失败，请稍后重试',
          icon: 'none',
          duration: 2500
        });
      });
  },

  startCountdown() {
    this.setData({ countdown: 60 });
    this._timer = setInterval(() => {
      const c = this.data.countdown - 1;
      if (c <= 0) {
        clearInterval(this._timer);
        this.setData({ countdown: 0 });
      } else {
        this.setData({ countdown: c });
      }
    }, 1000);
  },

  doRegister() {
    const email = this.data.email.trim();
    const code = this.data.code.trim();
    const username = this.data.username.trim();
    const password = this.data.password;

    if (!this.validEmail(email)) {
      wx.showToast({ title: '请输入正确的邮箱', icon: 'none' });
      return;
    }
    if (!code) {
      wx.showToast({ title: '请输入验证码', icon: 'none' });
      return;
    }
    if (password.length < 8) {
      wx.showToast({ title: '密码至少 8 位', icon: 'none' });
      return;
    }
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      wx.showToast({ title: '密码需同时包含字母和数字', icon: 'none' });
      return;
    }

    const payload = {
      email,
      password,
      email_code: code
    };
    if (username) payload.username = username;

    this.setData({ loading: true });
    authApi.register(payload)
      .then((res) => {
        const token = res && res.token;
        if (!token) throw new Error('注册响应异常');
        // 响应里的 user 不含 email，用注册时填写的邮箱补全
        auth.setAuth(token, Object.assign({ email }, res.user || {}));
        wx.showToast({ title: '注册成功', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/predict/predict' }) });
        }, 600);
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '注册失败', icon: 'none', duration: 2500 });
      })
      .then(() => {
        this.setData({ loading: false });
      });
  },

  goLogin() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/login/login' }) });
  }
});
