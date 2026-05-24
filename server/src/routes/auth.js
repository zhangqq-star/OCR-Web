const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  });
}

// 注册（邮箱可选）
router.post('/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: '用户名和密码不能为空' });
  }
  if (password.length < 6) {
    return res.status(400).json({ ok: false, error: '密码至少 6 位' });
  }

  const existing = db.get(
    'SELECT id FROM users WHERE username = ?',
    [username]
  );
  if (existing) {
    return res.status(409).json({ ok: false, error: '用户名已被注册' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const emailVal = email || null;

  const createUser = db.transaction(() => {
    db.run(
      'INSERT INTO users (username, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, unixepoch(), unixepoch())',
      [username, emailVal, hash, username]
    );
    const userId = db.lastInsertRowid();

    db.run(
      'INSERT INTO teams (name, description, owner_id, created_at, updated_at) VALUES (?, ?, ?, unixepoch(), unixepoch())',
      ['我的空间', '个人专属空间', userId]
    );
    const teamId = db.lastInsertRowid();

    db.run(
      'INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, unixepoch())',
      [teamId, userId, 'owner']
    );

    db.run(
      'INSERT INTO shelves (team_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, unixepoch(), unixepoch())',
      [teamId, '货架 1', userId]
    );

    return { userId, teamId };
  });

  const { userId } = createUser();
  const token = makeToken({ id: userId, username });

  return res.json({
    ok: true,
    data: { token, user: { id: userId, username, email: emailVal, display_name: username } },
  });
});

// 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: '用户名和密码不能为空' });
  }

  const user = db.get(
    'SELECT id, username, email, password_hash, display_name FROM users WHERE username = ?',
    [username]
  );

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ ok: false, error: '用户名或密码错误' });
  }

  const token = makeToken({ id: user.id, username: user.username });
  return res.json({
    ok: true,
    data: {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
      },
    },
  });
});

// 获取当前用户信息
router.get('/me', requireAuth, (req, res) => {
  const user = db.get(
    'SELECT id, username, email, display_name, created_at FROM users WHERE id = ?',
    [req.user.id]
  );

  if (!user) {
    return res.status(404).json({ ok: false, error: '用户不存在' });
  }

  const teams = db.all(
    `SELECT t.id, t.name, t.description, t.owner_id, tm.role
     FROM teams t
     JOIN team_members tm ON t.id = tm.team_id
     WHERE tm.user_id = ?
     ORDER BY tm.joined_at`,
    [req.user.id]
  );

  return res.json({
    ok: true,
    data: { user, teams },
  });
});

// 更新个人信息
router.put('/me', requireAuth, (req, res) => {
  const { display_name, email } = req.body;

  const sets = [];
  const values = [];
  if (display_name !== undefined) { sets.push('display_name = ?'); values.push(display_name); }
  if (email !== undefined) { sets.push('email = ?'); values.push(email); }

  if (sets.length === 0) {
    return res.status(400).json({ ok: false, error: '无可更新字段' });
  }

  values.push(req.user.id);
  db.run(
    `UPDATE users SET ${sets.join(', ')}, updated_at = unixepoch() WHERE id = ?`,
    values
  );

  const user = db.get(
    'SELECT id, username, email, display_name FROM users WHERE id = ?',
    [req.user.id]
  );

  return res.json({ ok: true, data: user });
});

module.exports = router;
