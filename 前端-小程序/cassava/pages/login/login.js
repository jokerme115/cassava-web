// pages/login/login.js
const { authApi } = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    username: '',
    password: '',
    showPwd: false,
    loading: false
  },

  onUsername(e) {
    this.setData({ username: e.detail.value });
  },
  onPassword(e) {
    this.setData({ password: e.detail.value });
  },
  togglePwd() {
    this.setData({ showPwd: !this.data.showPwd });
  },

  doLogin() {
    const { username, password } = this.data;
    if (!username.trim()) {
      wx.showToast({ title: '请输入用户名', icon: 'none' });
      return;
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    authApi.login(username.trim(), password)
      .then((res) => {
        const token = res && res.token;
        if (!token) {
          throw new Error('登录响应异常');
        }
        auth.setAuth(token, res.user || null);
        // 登录响应里的 user 不含 email，补拉一次完整资料
        authApi.currentUser()
          .then((u) => {
            if (u && !u.error) auth.setAuth(null, u);
          })
          .catch(() => {});
        wx.showToast({ title: '登录成功', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/predict/predict' }) });
        }, 600);
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '登录失败', icon: 'none' });
      })
      .then(() => {
        this.setData({ loading: false });
      });
  },

  goRegister() {
    wx.navigateTo({ url: '/pages/register/register' });
  }
});
