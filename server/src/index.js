const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { requireAuth } = require('./middleware/auth');

const authRoutes = require('./routes/auth');

async function main() {
  await db.open();
  console.log('[Server] 数据库已初始化');

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(morgan('dev'));

  // 静态文件服务 (前端)
  app.use(express.static(config.STATIC_ROOT));

  // API 路由
  app.use('/api/auth', authRoutes);

  // 获取用户个人团队 ID
  function getPersonalTeamId(userId) {
    const row = db.get(
      `SELECT t.id FROM teams t
       JOIN team_members tm ON t.id = tm.team_id
       WHERE tm.user_id = ? AND tm.role = 'owner'
       ORDER BY t.created_at LIMIT 1`,
      [userId]
    );
    return row ? row.id : null;
  }

  app.use('/api/personal', requireAuth);

  // 个人空间 — 货架
  app.get('/api/personal/shelves', (req, res) => {
    const teamId = getPersonalTeamId(req.user.id);
    if (!teamId) return res.status(500).json({ ok: false, error: '个人空间未找到' });
    const shelves = db.all('SELECT * FROM shelves WHERE team_id = ? ORDER BY created_at', [teamId]);
    return res.json({ ok: true, data: shelves });
  });

  app.post('/api/personal/shelves', (req, res) => {
    const teamId = getPersonalTeamId(req.user.id);
    if (!teamId) return res.status(500).json({ ok: false, error: '个人空间未找到' });
    const { name } = req.body;
    db.run(
      'INSERT INTO shelves (team_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, unixepoch(), unixepoch())',
      [teamId, name || '货架 1', req.user.id]
    );
    const shelfId = db.lastInsertRowid();
    const shelf = db.get('SELECT * FROM shelves WHERE id = ?', [shelfId]);
    return res.json({ ok: true, data: shelf });
  });

  app.get('/api/personal/shelves/:shelfId', (req, res) => {
    const teamId = getPersonalTeamId(req.user.id);
    if (!teamId) return res.status(500).json({ ok: false, error: '个人空间未找到' });
    const shelf = db.get('SELECT * FROM shelves WHERE id = ? AND team_id = ?', [parseInt(req.params.shelfId), teamId]);
    if (!shelf) return res.status(404).json({ ok: false, error: '货架不存在' });
    return res.json({ ok: true, data: shelf });
  });

  app.put('/api/personal/shelves/:shelfId', (req, res) => {
    const teamId = getPersonalTeamId(req.user.id);
    if (!teamId) return res.status(500).json({ ok: false, error: '个人空间未找到' });
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ ok: false, error: '名称不能为空' });
    db.run('UPDATE shelves SET name = ?, updated_at = unixepoch() WHERE id = ? AND team_id = ?', [name.trim(), parseInt(req.params.shelfId), teamId]);
    return res.json({ ok: true });
  });

  app.delete('/api/personal/shelves/:shelfId', (req, res) => {
    const teamId = getPersonalTeamId(req.user.id);
    if (!teamId) return res.status(500).json({ ok: false, error: '个人空间未找到' });
    db.run('DELETE FROM shelves WHERE id = ? AND team_id = ?', [parseInt(req.params.shelfId), teamId]);
    return res.json({ ok: true });
  });

  // 个人空间 — 零件
  app.get('/api/personal/shelves/:shelfId/parts', (req, res) => {
    const teamId = getPersonalTeamId(req.user.id);
    if (!teamId) return res.status(500).json({ ok: false, error: '个人空间未找到' });
    const parts = db.all('SELECT * FROM parts WHERE shelf_id = ? ORDER BY shelf_row, shelf_col', [parseInt(req.params.shelfId)]);
    return res.json({ ok: true, data: parts });
  });

  app.post('/api/personal/shelves/:shelfId/parts', (req, res) => {
    const teamId = getPersonalTeamId(req.user.id);
    if (!teamId) return res.status(500).json({ ok: false, error: '个人空间未找到' });
    const { name, code, specs, quantity, note, shelfRow, shelfCol } = req.body;
    const shelfId = parseInt(req.params.shelfId);
    if (shelfRow != null && shelfCol != null) {
      const dup = db.get('SELECT id FROM parts WHERE shelf_id = ? AND shelf_row = ? AND shelf_col = ? LIMIT 1', [shelfId, shelfRow, shelfCol]);
      if (dup) return res.status(409).json({ ok: false, error: '该位置已被占用' });
    }
    db.run(
      'INSERT INTO parts (shelf_id, name, code, specs, quantity, note, shelf_row, shelf_col, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())',
      [shelfId, name || '', code || '', specs || '', quantity || 1, note || '', shelfRow ?? null, shelfCol ?? null, req.user.id]
    );
    const partId = db.lastInsertRowid();
    const part = db.get('SELECT * FROM parts WHERE id = ?', [partId]);
    return res.json({ ok: true, data: part });
  });

  app.put('/api/personal/shelves/:shelfId/parts/:partId', (req, res) => {
    const { name, code, specs, quantity, note, shelfRow, shelfCol } = req.body;
    const shelfId = parseInt(req.params.shelfId);
    const partId = parseInt(req.params.partId);
    const existing = db.get('SELECT * FROM parts WHERE id = ? AND shelf_id = ?', [partId, shelfId]);
    if (!existing) return res.status(404).json({ ok: false, error: '零件不存在' });
    db.run(
      'UPDATE parts SET name=?, code=?, specs=?, quantity=?, note=?, shelf_row=?, shelf_col=?, updated_by=?, updated_at=unixepoch() WHERE id=? AND shelf_id=?',
      [name ?? existing.name, code ?? existing.code, specs ?? existing.specs, quantity ?? existing.quantity, note ?? existing.note, shelfRow ?? existing.shelf_row, shelfCol ?? existing.shelf_col, req.user.id, partId, shelfId]
    );
    const part = db.get('SELECT * FROM parts WHERE id = ?', [partId]);
    return res.json({ ok: true, data: part });
  });

  app.delete('/api/personal/shelves/:shelfId/parts/:partId', (req, res) => {
    db.run('DELETE FROM parts WHERE id = ? AND shelf_id = ?', [parseInt(req.params.partId), parseInt(req.params.shelfId)]);
    return res.json({ ok: true });
  });

  app.post('/api/personal/shelves/:shelfId/parts/batch', (req, res) => {
    const teamId = getPersonalTeamId(req.user.id);
    if (!teamId) return res.status(500).json({ ok: false, error: '个人空间未找到' });
    const { parts } = req.body;
    if (!Array.isArray(parts) || parts.length === 0) return res.status(400).json({ ok: false, error: '请提供零件列表' });
    const shelfId = parseInt(req.params.shelfId);
    const ids = db.transaction(() => {
      const result = [];
      for (const p of parts) {
        db.run(
          'INSERT INTO parts (shelf_id, name, code, specs, quantity, note, shelf_row, shelf_col, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())',
          [shelfId, p.name || '', p.code || '', p.specs || '', p.quantity || 1, p.note || '', p.shelfRow ?? null, p.shelfCol ?? null, req.user.id]
        );
        result.push(db.lastInsertRowid());
      }
      return result;
    })();
    return res.json({ ok: true, data: { ids, count: ids.length } });
  });

  // API 404 — 所有 HTTP 方法都返回 JSON
  app.all('/api/*', (req, res) => {
    res.status(404).json({ ok: false, error: 'API 不存在: ' + req.method + ' ' + req.path });
  });

  // 前端路由回退（非 API 请求）
  app.get('*', (req, res) => {
    res.sendFile(path.join(config.STATIC_ROOT, 'index.html'));
  });

  // 错误处理
  app.use((err, _req, res, _next) => {
    console.error('[Server Error]', err);
    res.status(500).json({ ok: false, error: '服务器内部错误' });
  });

  app.listen(config.PORT, () => {
    console.log(`[Server] OCR 货架管理后端已启动 → http://localhost:${config.PORT}`);
  });
}

main().catch(err => {
  console.error('[Server] 启动失败:', err);
  process.exit(1);
});
