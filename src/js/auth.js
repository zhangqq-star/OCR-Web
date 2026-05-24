/**
 * 账号模块 — 登录态管理、注册/登录/登出
 */
const Auth = (() => {
  let currentUser = null;
  let token = null;

  function getToken() { return token; }
  function getUser() { return currentUser; }
  function isLoggedIn() { return !!token && !!currentUser; }

  async function init() {
    token = localStorage.getItem('auth_token');
    if (!token) return false;

    try {
      const body = await API.get('/api/auth/me');
      currentUser = body.data.user;
      localStorage.setItem('auth_user', JSON.stringify(currentUser));
      return true;
    } catch (err) {
      // 401 token 过期 — API 已自动调用 logout()
      if (err.message === '登录已过期') {
        return false;
      }
      // 网络不可达，使用缓存的用户信息
      const cached = localStorage.getItem('auth_user');
      if (cached) {
        currentUser = JSON.parse(cached);
        return true;
      }
      return false;
    }
  }

  async function login(username, password) {
    const body = await API.post('/api/auth/login', { username, password });
    token = body.data.token;
    currentUser = body.data.user;
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(currentUser));
    return body.data;
  }

  async function register(username, email, password) {
    const body = await API.post('/api/auth/register', { username, email: email || '', password });
    token = body.data.token;
    currentUser = body.data.user;
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(currentUser));
    return body.data;
  }

  function logout() {
    token = null;
    currentUser = null;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
  }

  async function updateProfile(fields) {
    if (!token) throw new Error('未登录');
    const body = await API.put('/api/auth/me', fields);
    currentUser = body.data;
    localStorage.setItem('auth_user', JSON.stringify(currentUser));
    return currentUser;
  }

  return { init, isLoggedIn, getToken, getUser, login, register, logout, updateProfile };
})();
