const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireMember } = require('../middleware/teamAccess');

const router = express.Router({ mergeParams: true });

// 获取团队操作日志
router.get('/', requireAuth, requireMember, (req, res) => {
  const teamId = parseInt(req.params.teamId);
  const { limit, offset, action, userId } = req.query;

  let sql = `
    SELECT ol.*, u.username, u.display_name
    FROM operation_logs ol
    JOIN users u ON ol.user_id = u.id
    WHERE ol.team_id = ?
  `;
  const params = [teamId];

  if (action) {
    sql += ' AND ol.action = ?';
    params.push(action);
  }
  if (userId) {
    sql += ' AND ol.user_id = ?';
    params.push(parseInt(userId));
  }

  sql += ' ORDER BY ol.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit) || 50, parseInt(offset) || 0);

  const logs = db.all(sql, params);
  const total = db.get(
    'SELECT COUNT(*) as count FROM operation_logs WHERE team_id = ?',
    [teamId]
  );

  return res.json({ ok: true, data: { logs, total: total ? total.count : 0 } });
});

module.exports = router;
