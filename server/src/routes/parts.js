const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireMember } = require('../middleware/teamAccess');
const { logAction } = require('../utils/logger');

const router = express.Router({ mergeParams: true });

// 获取货架下所有零件
router.get('/', requireAuth, requireMember, (req, res) => {
  const parts = db.all(
    'SELECT * FROM parts WHERE shelf_id = ? ORDER BY shelf_row, shelf_col',
    [parseInt(req.params.shelfId)]
  );
  return res.json({ ok: true, data: parts });
});

// 创建零件
router.post('/', requireAuth, requireMember, (req, res) => {
  const { name, code, specs, quantity, note, shelfRow, shelfCol } = req.body;
  const teamId = parseInt(req.params.teamId);
  const shelfId = parseInt(req.params.shelfId);

  // 检查位置是否被占用
  if (shelfRow != null && shelfCol != null) {
    const dup = db.get(
      'SELECT id FROM parts WHERE shelf_id = ? AND shelf_row = ? AND shelf_col = ? LIMIT 1',
      [shelfId, shelfRow, shelfCol]
    );
    if (dup) {
      return res.status(409).json({ ok: false, error: '该位置已被占用' });
    }
  }

  db.run(
    `INSERT INTO parts (shelf_id, name, code, specs, quantity, note, shelf_row, shelf_col, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
    [shelfId, name || '', code || '', specs || '', quantity || 1, note || '', shelfRow ?? null, shelfCol ?? null, req.user.id]
  );
  const partId = db.lastInsertRowid();

  logAction(req.user.id, teamId, 'part.create', 'part', partId, { code, shelfRow, shelfCol });

  const part = db.get('SELECT * FROM parts WHERE id = ?', [partId]);
  return res.json({ ok: true, data: part });
});

// 获取单个零件
router.get('/:partId', requireAuth, requireMember, (req, res) => {
  const part = db.get(
    'SELECT * FROM parts WHERE id = ? AND shelf_id = ?',
    [parseInt(req.params.partId), parseInt(req.params.shelfId)]
  );
  if (!part) return res.status(404).json({ ok: false, error: '零件不存在' });
  return res.json({ ok: true, data: part });
});

// 更新零件
router.put('/:partId', requireAuth, requireMember, (req, res) => {
  const { name, code, specs, quantity, note, shelfRow, shelfCol, updatedAt } = req.body;
  const teamId = parseInt(req.params.teamId);
  const partId = parseInt(req.params.partId);

  const existing = db.get(
    'SELECT * FROM parts WHERE id = ? AND shelf_id = ?',
    [partId, parseInt(req.params.shelfId)]
  );
  if (!existing) return res.status(404).json({ ok: false, error: '零件不存在' });

  // 乐观锁：检查冲突
  if (updatedAt && existing.updated_at > updatedAt) {
    return res.status(409).json({ ok: false, error: '零件已被他人修改，请刷新后重试' });
  }

  db.run(
    `UPDATE parts SET name=?, code=?, specs=?, quantity=?, note=?, shelf_row=?, shelf_col=?, updated_by=?, updated_at=unixepoch()
     WHERE id=? AND shelf_id=?`,
    [
      name ?? existing.name, code ?? existing.code, specs ?? existing.specs,
      quantity ?? existing.quantity, note ?? existing.note,
      shelfRow ?? existing.shelf_row, shelfCol ?? existing.shelf_col,
      req.user.id, partId, parseInt(req.params.shelfId),
    ]
  );

  logAction(req.user.id, teamId, 'part.update', 'part', partId, { code, shelfRow, shelfCol });

  const part = db.get('SELECT * FROM parts WHERE id = ?', [partId]);
  return res.json({ ok: true, data: part });
});

// 批量追加多个零件（用于同步上传）
router.post('/batch', requireAuth, requireMember, (req, res) => {
  const { parts } = req.body;
  if (!Array.isArray(parts) || parts.length === 0) {
    return res.status(400).json({ ok: false, error: '请提供零件列表' });
  }

  const teamId = parseInt(req.params.teamId);
  const shelfId = parseInt(req.params.shelfId);

  const ids = db.transaction(() => {
    const result = [];
    for (const p of parts) {
      db.run(
        `INSERT INTO parts (shelf_id, name, code, specs, quantity, note, shelf_row, shelf_col, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
        [shelfId, p.name || '', p.code || '', p.specs || '', p.quantity || 1, p.note || '', p.shelfRow ?? null, p.shelfCol ?? null, req.user.id]
      );
      result.push(db.lastInsertRowid());
    }
    return result;
  })();

  logAction(req.user.id, teamId, 'part.batch_create', 'part', null, { count: parts.length });

  return res.json({ ok: true, data: { ids, count: ids.length } });
});

// 删除零件
router.delete('/:partId', requireAuth, requireMember, (req, res) => {
  const teamId = parseInt(req.params.teamId);

  db.run(
    'DELETE FROM parts WHERE id = ? AND shelf_id = ?',
    [parseInt(req.params.partId), parseInt(req.params.shelfId)]
  );

  logAction(req.user.id, teamId, 'part.delete', 'part', req.params.partId, null);

  return res.json({ ok: true });
});

module.exports = router;
