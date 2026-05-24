const db = require('../db');

function logAction(userId, teamId, action, targetType, targetId, detail) {
  db.run(
    `INSERT INTO operation_logs (user_id, team_id, action, target_type, target_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
    [userId, teamId, action, targetType, targetId, detail ? JSON.stringify(detail) : null]
  );
}

module.exports = { logAction };
