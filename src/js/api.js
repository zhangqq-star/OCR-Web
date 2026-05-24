/**
 * API 模块 — HTTP 封装、离线检测、同步队列
 */
const API = (() => {
  const BASE_URL = window.API_BASE || '';
  let isOnline = navigator.onLine;
  let queueFlushing = false;

  function getOnlineStatus() { return isOnline; }

  function updateOnlineStatus() {
    const was = isOnline;
    isOnline = navigator.onLine;
    if (!was && isOnline) {
      console.log('[API] 恢复在线，开始同步...');
      flushQueue();
    }
    if (was && !isOnline) {
      console.log('[API] 已离线');
      showToast && showToast('网络已断开，切换到离线模式');
    }
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  async function request(method, path, body, opts = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    };

    const token = typeof Auth !== 'undefined' && Auth.getToken ? Auth.getToken() : null;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const fetchOpts = { method, headers };
    if (body && method !== 'GET') {
      fetchOpts.body = JSON.stringify(body);
    }

    const url = `${BASE_URL}${path}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), opts.timeout || 15000);
      fetchOpts.signal = controller.signal;

      const res = await fetch(url, fetchOpts);
      clearTimeout(timeout);

      // 401: token 过期 → 清除登录态
      if (res.status === 401) {
        if (typeof Auth !== 'undefined' && Auth.logout) {
          Auth.logout();
          showToast && showToast('登录已过期，已切换至本地模式');
        }
        throw new Error('登录已过期');
      }

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`请求失败 (${res.status}): 服务器返回了非 JSON 响应`);
      }
      if (!res.ok) {
        throw new Error(data.error || `请求失败 (${res.status})`);
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('请求超时');
      }
      // 网络错误：如果是写操作，加入同步队列
      if (!isOnline && method !== 'GET' && !opts.noQueue) {
        enqueueMutation(method, path, body);
        throw new Error('已离线，操作已暂存，恢复网络后自动同步');
      }
      throw err;
    }
  }

  function get(path, opts) { return request('GET', path, null, opts); }
  function post(path, body, opts) { return request('POST', path, body, opts); }
  function put(path, body, opts) { return request('PUT', path, body, opts); }
  function del(path, opts) { return request('DELETE', path, null, opts); }

  // ---- 离线队列 ----

  async function enqueueMutation(method, path, body) {
    if (typeof DB === 'undefined') return;
    const op = method === 'POST' ? 'insert' : method === 'PUT' ? 'update' : 'delete';
    await DB.enqueueSync(op, null, op, path, body);
    console.log('[API] 写入已入队:', op, path);
  }

  async function flushQueue() {
    if (queueFlushing || typeof DB === 'undefined') return;
    queueFlushing = true;

    try {
      const queue = await DB.getSyncQueue();
      if (queue.length === 0) {
        console.log('[API] 同步队列为空');
        return;
      }

      console.log(`[API] 开始同步 ${queue.length} 条离线操作...`);
      let successCount = 0;
      let failCount = 0;

      for (const entry of queue) {
        try {
          await request(
            entry.operation === 'delete' ? 'DELETE' :
            entry.operation === 'update' ? 'PUT' : 'POST',
            entry.endpoint,
            entry.payload,
            { noQueue: true }
          );
          await DB.clearSyncEntry(entry.id);
          successCount++;
        } catch (err) {
          console.warn('[API] 同步失败:', entry.operation, entry.endpoint, err.message);
          failCount++;
          // 冲突时直接移除（无法自动合并）
          if (err.message.includes('已被') || err.message.includes('占用')) {
            await DB.clearSyncEntry(entry.id);
          }
        }
      }

      console.log(`[API] 同步完成: 成功 ${successCount}, 失败 ${failCount}`);
      if (successCount > 0) {
        showToast && showToast(`已同步 ${successCount} 条离线操作`);
      }
    } finally {
      queueFlushing = false;
    }
  }

  async function getQueueLength() {
    if (typeof DB === 'undefined') return 0;
    return DB.countSyncQueue();
  }

  return {
    request, get, post, put, del,
    getOnlineStatus, flushQueue, getQueueLength,
  };
})();
