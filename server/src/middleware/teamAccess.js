const db = require('../db');

const ROLE_ORDER = { owner: 3, admin: 2, member: 1 };

// 验证当前用户是团队成员
function requireMember(req, res, next) {
  const teamId = parseInt(req.params.teamId);
  if (!teamId) return res.status(400).json({ ok: false, error: '无效的团队 ID' });

  const row = db.get(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    [teamId, req.user.id]
  );

  if (!row) {
    return res.status(403).json({ ok: false, error: '你不是该团队成员' });
  }

  req.teamMember = { teamId, role: row.role };
  next();
}

// 要求至少达到某角色等级
function requireRole(minRole) {
  return (req, res, next) => {
    const current = ROLE_ORDER[req.teamMember?.role] || 0;
    const required = ROLE_ORDER[minRole] || 0;
    if (current < required) {
      return res.status(403).json({ ok: false, error: `需要 ${minRole} 或更高权限` });
    }
    next();
  };
}

module.exports = { requireMember, requireRole };
