/**
 * 账号模块 — 本地认证（Web Crypto PBKDF2 + 本地 SQLite）
 */
const Auth = (() => {
  let currentUser = null;
  let token = null;

  function getToken() { return token; }
  function getUser() { return currentUser; }
  function isLoggedIn() { return !!token && !!currentUser; }
  function getOwnerId() { return currentUser ? String(currentUser.id) : 'anon'; }

  // ---- 密码哈希 (Web Crypto API) ----

  async function hashPassword(password, existingSalt) {
    const encoder = new TextEncoder();
    const salt = existingSalt || crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      key,
      256
    );
    const hash = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    return { hash, saltHex };
  }

  // ---- 会话管理 ----

  function saveSession(user) {
    token = crypto.randomUUID();
    currentUser = user;
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(user));
  }

  function clearSession() {
    token = null;
    currentUser = null;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
  }

  // ---- 公开接口 ----

  async function init() {
    token = localStorage.getItem('auth_token');
    const cached = localStorage.getItem('auth_user');
    if (token && cached) {
      currentUser = JSON.parse(cached);
      return true;
    }
    return false;
  }

  async function login(username, password) {
    const user = await DB.getLocalUser(username);
    if (!user) {
      throw new Error('用户名或密码错误');
    }

    const [saltHex] = user.password_hash.split(':');
    const { hash } = await hashPassword(password, hexToBytes(saltHex));

    if (saltHex + ':' + hash !== user.password_hash) {
      throw new Error('用户名或密码错误');
    }

    const sessionUser = { id: user.id, username: user.username, display_name: user.display_name };
    saveSession(sessionUser);
    return sessionUser;
  }

  async function register(username, password) {
    if (!username || !password) {
      throw new Error('用户名和密码不能为空');
    }
    if (password.length < 6) {
      throw new Error('密码至少 6 位');
    }

    const existing = await DB.getLocalUser(username);
    if (existing) {
      throw new Error('用户名已被注册');
    }

    const { hash, saltHex } = await hashPassword(password);
    const passwordHash = saltHex + ':' + hash;

    const userId = await DB.createLocalUser(username, passwordHash);
    const user = { id: userId, username, display_name: username };
    saveSession(user);
    return user;
  }

  function logout() {
    clearSession();
  }

  async function updateProfile(fields) {
    if (!currentUser) throw new Error('未登录');
    await DB.updateLocalUser(currentUser.id, fields);
    if (fields.display_name) currentUser.display_name = fields.display_name;
    localStorage.setItem('auth_user', JSON.stringify(currentUser));
    return currentUser;
  }

  // ---- 辅助 ----

  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  return { init, isLoggedIn, getToken, getUser, getOwnerId, login, register, logout, updateProfile };
})();
