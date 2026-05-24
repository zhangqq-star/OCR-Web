const jwt = require('jsonwebtoken');
const config = require('../config');

// 必选验证：无 token 返回 401
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: '未登录' });
  }
  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, config.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ ok: false, error: '登录已过期' });
  }
}

// 可选验证：有 token 就解析，没有也放行
function softAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.slice(7), config.JWT_SECRET);
    } catch { /* ignore */ }
  }
  next();
}

module.exports = { requireAuth, softAuth };
