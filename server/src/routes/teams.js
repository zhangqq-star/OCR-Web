const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireMember, requireRole } = require('../middleware/teamAccess');
const { logAction } = require('../utils/logger');

const router = express.Router({ mergeParams: true });

// 生成 8 位邀请码
function genInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// 获取用户的所有团队
router.get('/', requireAuth, (req, res) => {
  const teams = db.all(
    `SELECT t.id, t.name, t.description, t.owner_id, t.invite_code, tm.role,
            (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS member_count
     FROM teams t
     JOIN team_members tm ON t.id = tm.team_id
     WHERE tm.user_id = ?
     ORDER BY tm.joined_at`,
    [req.user.id]
  );
  return res.json({ ok: true, data: teams });
});

// 创建团队
router.post('/', requireAuth, (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ ok: false, error: '团队名称不能为空' });
  }

  const inviteCode = genInviteCode();

  const result = db.transaction(() => {
    db.run(
      'INSERT INTO teams (name, description, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, unixepoch(), unixepoch())',
      [name.trim(), description || '', req.user.id, inviteCode]
    );
    const teamId = db.lastInsertRowid();

    db.run(
      'INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, unixepoch())',
      [teamId, req.user.id, 'owner']
    );

    // 创建默认货架
    db.run(
      'INSERT INTO shelves (team_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, unixepoch(), unixepoch())',
      [teamId, '货架 1', req.user.id]
    );

    return teamId;
  })();

  logAction(req.user.id, result, 'team.create', 'team', result, { name });

  return res.json({
    ok: true,
    data: { id: result, name: name.trim(), invite_code: inviteCode },
  });
});

// 获取单个团队信息
router.get('/:id', requireAuth, requireMember, (req, res) => {
  const team = db.get(
    'SELECT t.*, (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS member_count FROM teams t WHERE t.id = ?',
    [parseInt(req.params.id)]
  );
  return res.json({ ok: true, data: team });
});

// 更新团队信息
router.put('/:id', requireAuth, requireMember, requireRole('admin'), (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ ok: false, error: '团队名称不能为空' });
  }

  db.run(
    'UPDATE teams SET name = ?, description = ?, updated_at = unixepoch() WHERE id = ?',
    [name.trim(), description || '', parseInt(req.params.id)]
  );

  logAction(req.user.id, parseInt(req.params.id), 'team.update', 'team', req.params.id, { name });

  return res.json({ ok: true });
});

// 删除团队
router.delete('/:id', requireAuth, requireMember, requireRole('owner'), (req, res) => {
  const teamId = parseInt(req.params.id);
  logAction(req.user.id, teamId, 'team.delete', 'team', teamId, null);
  db.run('DELETE FROM teams WHERE id = ?', [teamId]);
  return res.json({ ok: true });
});

// 通过邀请码加入团队
router.post('/:id/join', requireAuth, (req, res) => {
  const teamId = parseInt(req.params.id);
  const { inviteCode } = req.body;

  const team = db.get('SELECT * FROM teams WHERE id = ?', [teamId]);
  if (!team) {
    return res.status(404).json({ ok: false, error: '团队不存在' });
  }

  if (team.invite_code && team.invite_code !== inviteCode) {
    return res.status(400).json({ ok: false, error: '邀请码错误' });
  }

  const existing = db.get(
    'SELECT id FROM team_members WHERE team_id = ? AND user_id = ?',
    [teamId, req.user.id]
  );
  if (existing) {
    return res.status(409).json({ ok: false, error: '你已经是该团队成员' });
  }

  db.run(
    'INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, unixepoch())',
    [teamId, req.user.id, 'member']
  );

  logAction(req.user.id, teamId, 'member.join', 'member', req.user.id, null);

  return res.json({ ok: true, data: { teamId, role: 'member' } });
});

// 重新生成邀请码
router.post('/:id/regenerate-invite', requireAuth, requireMember, requireRole('admin'), (req, res) => {
  const code = genInviteCode();
  db.run('UPDATE teams SET invite_code = ?, updated_at = unixepoch() WHERE id = ?',
    [code, parseInt(req.params.id)]);
  logAction(req.user.id, parseInt(req.params.id), 'team.regenerate_invite', 'team', req.params.id, null);
  return res.json({ ok: true, data: { invite_code: code } });
});

// 获取团队成员列表
router.get('/:id/members', requireAuth, requireMember, (req, res) => {
  const members = db.all(
    `SELECT u.id, u.username, u.email, u.display_name, tm.role, tm.joined_at
     FROM team_members tm
     JOIN users u ON tm.user_id = u.id
     WHERE tm.team_id = ?
     ORDER BY tm.joined_at`,
    [parseInt(req.params.id)]
  );
  return res.json({ ok: true, data: members });
});

// 更新成员角色
router.put('/:id/members/:userId', requireAuth, requireMember, requireRole('owner'), (req, res) => {
  const { role } = req.body;
  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ ok: false, error: '无效的角色' });
  }

  const target = db.get(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    [parseInt(req.params.id), parseInt(req.params.userId)]
  );
  if (!target) {
    return res.status(404).json({ ok: false, error: '成员不存在' });
  }
  if (target.role === 'owner') {
    return res.status(400).json({ ok: false, error: '不能修改团队创建者的角色' });
  }

  db.run(
    'UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?',
    [role, parseInt(req.params.id), parseInt(req.params.userId)]
  );

  logAction(req.user.id, parseInt(req.params.id), 'member.role_change', 'member', req.params.userId, { role });

  return res.json({ ok: true });
});

// 移除成员
router.delete('/:id/members/:userId', requireAuth, requireMember, requireRole('admin'), (req, res) => {
  const target = db.get(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    [parseInt(req.params.id), parseInt(req.params.userId)]
  );
  if (!target) {
    return res.status(404).json({ ok: false, error: '成员不存在' });
  }
  if (target.role === 'owner') {
    return res.status(400).json({ ok: false, error: '不能移除团队创建者' });
  }
  if (req.teamMember.role === 'admin' && target.role !== 'member') {
    return res.status(403).json({ ok: false, error: '管理员只能移除普通成员' });
  }

  db.run(
    'DELETE FROM team_members WHERE team_id = ? AND user_id = ?',
    [parseInt(req.params.id), parseInt(req.params.userId)]
  );

  logAction(req.user.id, parseInt(req.params.id), 'member.remove', 'member', req.params.userId, null);

  return res.json({ ok: true });
});

// 离开团队
router.post('/:id/leave', requireAuth, requireMember, (req, res) => {
  const teamId = parseInt(req.params.id);

  const target = db.get(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    [teamId, req.user.id]
  );

  if (target.role === 'owner') {
    const otherOwner = db.get(
      'SELECT id FROM team_members WHERE team_id = ? AND role = ? AND user_id != ?',
      [teamId, 'owner', req.user.id]
    );
    if (!otherOwner) {
      return res.status(400).json({ ok: false, error: '作为唯一创建者，请先转让所有权或删除团队' });
    }
  }

  db.run(
    'DELETE FROM team_members WHERE team_id = ? AND user_id = ?',
    [teamId, req.user.id]
  );

  logAction(req.user.id, teamId, 'member.leave', 'member', req.user.id, null);

  return res.json({ ok: true });
});

module.exports = router;
