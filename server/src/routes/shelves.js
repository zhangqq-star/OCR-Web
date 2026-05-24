const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireMember } = require('../middleware/teamAccess');
const { logAction } = require('../utils/logger');

const router = express.Router({ mergeParams: true });

// 获取团队下所有货架
router.get('/', requireAuth, requireMember, (req, res) => {
  const shelves = db.all(
    'SELECT * FROM shelves WHERE team_id = ? ORDER BY created_at',
    [parseInt(req.params.teamId)]
  );
  return res.json({ ok: true, data: shelves });
});

// 创建货架
router.post('/', requireAuth, requireMember, (req, res) => {
  const teamId = parseInt(req.params.teamId);
  const { name } = req.body;

  db.run(
    'INSERT INTO shelves (team_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, unixepoch(), unixepoch())',
    [teamId, name || '货架 1', req.user.id]
  );
  const shelfId = db.lastInsertRowid();

  logAction(req.user.id, teamId, 'shelf.create', 'shelf', shelfId, { name });

  const shelf = db.get('SELECT * FROM shelves WHERE id = ?', [shelfId]);
  return res.json({ ok: true, data: shelf });
});

// 获取单个货架
router.get('/:shelfId', requireAuth, requireMember, (req, res) => {
  const shelf = db.get(
    'SELECT * FROM shelves WHERE id = ? AND team_id = ?',
    [parseInt(req.params.shelfId), parseInt(req.params.teamId)]
  );
  if (!shelf) return res.status(404).json({ ok: false, error: '货架不存在' });
  return res.json({ ok: true, data: shelf });
});

// 更新货架（重命名）
router.put('/:shelfId', requireAuth, requireMember, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ ok: false, error: '名称不能为空' });
  }

  db.run(
    'UPDATE shelves SET name = ?, updated_at = unixepoch() WHERE id = ? AND team_id = ?',
    [name.trim(), parseInt(req.params.shelfId), parseInt(req.params.teamId)]
  );

  logAction(req.user.id, parseInt(req.params.teamId), 'shelf.update', 'shelf', req.params.shelfId, { name });

  return res.json({ ok: true });
});

// 删除货架
router.delete('/:shelfId', requireAuth, requireMember, (req, res) => {
  db.run(
    'DELETE FROM shelves WHERE id = ? AND team_id = ?',
    [parseInt(req.params.shelfId), parseInt(req.params.teamId)]
  );

  logAction(req.user.id, parseInt(req.params.teamId), 'shelf.delete', 'shelf', req.params.shelfId, null);

  return res.json({ ok: true });
});

module.exports = router;
