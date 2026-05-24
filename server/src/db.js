const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let db = null;

// 确保数据目录存在
const dataDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 持久化到文件
function saveToFile() {
  fs.writeFileSync(config.DB_PATH, Buffer.from(db.export()));
}

// 便捷查询方法（适配 sql.js API）
function run(sql, params = []) {
  db.run(sql, params);
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function lastInsertRowid() {
  const row = get('SELECT last_insert_rowid() as id');
  return row ? row.id : null;
}

function transaction(fn) {
  return (...args) => {
    run('BEGIN');
    try {
      const result = fn(...args);
      run('COMMIT');
      return result;
    } catch (e) {
      // 如果 DB 已关闭，不尝试 ROLLBACK
      try { run('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
  };
}

function createSchema() {
  run('PRAGMA foreign_keys = ON');

  run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      owner_id INTEGER NOT NULL REFERENCES users(id),
      invite_code TEXT UNIQUE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member')),
      joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(team_id, user_id)
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS shelves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '货架 1',
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  run('CREATE INDEX IF NOT EXISTS idx_shelves_team ON shelves(team_id)');

  run(`
    CREATE TABLE IF NOT EXISTS parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
      name TEXT DEFAULT '',
      code TEXT DEFAULT '',
      specs TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      note TEXT DEFAULT '',
      shelf_row INTEGER,
      shelf_col INTEGER,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  run('CREATE INDEX IF NOT EXISTS idx_parts_shelf ON parts(shelf_id)');
  run('CREATE INDEX IF NOT EXISTS idx_parts_position ON parts(shelf_row, shelf_col)');

  run(`
    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      team_id INTEGER REFERENCES teams(id),
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      detail TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  run('CREATE INDEX IF NOT EXISTS idx_logs_user ON operation_logs(user_id)');
  run('CREATE INDEX IF NOT EXISTS idx_logs_team ON operation_logs(team_id)');
  run('CREATE INDEX IF NOT EXISTS idx_logs_time ON operation_logs(created_at)');
}

async function open() {
  const SQL = await initSqlJs();
  if (fs.existsSync(config.DB_PATH)) {
    const buffer = fs.readFileSync(config.DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  run('PRAGMA foreign_keys = ON');
  createSchema();
  saveToFile();
  return db;
}

// 定时保存（每 5 秒，如果有变更的话）
let dirty = false;
const origRun = run;
run = function(sql, params) {
  // 只对写操作标记 dirty
  const upper = sql.trim().toUpperCase();
  if (upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE') ||
      upper.startsWith('CREATE') || upper.startsWith('DROP') || upper.startsWith('ALTER')) {
    dirty = true;
  }
  return origRun(sql, params);
};

setInterval(() => {
  if (dirty && db) {
    saveToFile();
    dirty = false;
  }
}, 5000);

// 进程退出前保存
process.on('exit', () => {
  if (dirty && db) saveToFile();
});
process.on('SIGINT', () => {
  if (dirty && db) saveToFile();
  process.exit();
});

module.exports = { open, run, get, all, lastInsertRowid, transaction, saveToFile };
