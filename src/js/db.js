/**
 * SQLite 数据层 — SQL.js + OPFS 持久化
 * 数据库: OcrShelfDB (SQLite)
 * Schema v4: shelves 增加 owner_id 实现用户数据隔离
 */
const DB = (() => {
  const DB_FILE = 'ocrshelf.db';
  const SCHEMA_VERSION = 4;
  let db = null;
  let initPromise = null;

  // ---- OPFS 持久化 ----

  async function getOPFSHandle() {
    const root = await navigator.storage.getDirectory();
    return root;
  }

  async function loadFromOPFS() {
    try {
      const root = await getOPFSHandle();
      const fileHandle = await root.getFileHandle(DB_FILE, { create: false });
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  async function saveToOPFS(data) {
    try {
      const root = await getOPFSHandle();
      const fileHandle = await root.getFileHandle(DB_FILE, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
    } catch (e) {
      console.warn('[DB] OPFS 写入失败，回退到 localStorage:', e);
      // 回退：存 base64 到 localStorage
      const base64 = arrayToBase64(data);
      localStorage.setItem(DB_FILE, base64);
    }
  }

  function arrayToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64ToArray(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // ---- 持久化调度（防抖写回） ----

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!db) return;
      const data = db.export();
      await saveToOPFS(data);
    }, 300);
  }

  async function saveNow() {
    if (saveTimer) clearTimeout(saveTimer);
    if (!db) return;
    const data = db.export();
    await saveToOPFS(data);
  }

  // ---- 建表 ----

  function createSchema() {
    db.run('PRAGMA foreign_keys = ON');

    db.run(`
      CREATE TABLE IF NOT EXISTS shelves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        space_id TEXT DEFAULT 'personal',
        server_id INTEGER,
        owner_id TEXT DEFAULT 'anon',
        createdAt INTEGER NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS parts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT DEFAULT '',
        code TEXT DEFAULT '',
        specs TEXT DEFAULT '',
        quantity INTEGER DEFAULT 1,
        note TEXT DEFAULT '',
        shelfRow INTEGER,
        shelfCol INTEGER,
        shelfId INTEGER,
        createdAt INTEGER,
        updatedAt INTEGER,
        FOREIGN KEY (shelfId) REFERENCES shelves(id) ON DELETE CASCADE
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_parts_shelfId ON parts(shelfId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_parts_position ON parts(shelfRow, shelfCol)');

    // v2 新增表
    db.run(`
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('personal', 'team')),
        server_id INTEGER,
        synced_at INTEGER
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        record_id INTEGER,
        operation TEXT NOT NULL CHECK(operation IN ('insert', 'update', 'delete')),
        endpoint TEXT NOT NULL,
        payload TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // v3: 本地用户表
    db.run(`
      CREATE TABLE IF NOT EXISTS _users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT DEFAULT '',
        created_at INTEGER NOT NULL
      )
    `);

    // 记录 schema 版本
    db.run('CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)');
    db.run("INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)]);
  }

  // v1 → v2 迁移
  function migrateV1toV2() {
    try {
      // 检查 shelves 是否已有 space_id 列
      const info = db.exec("PRAGMA table_info('shelves')");
      const cols = info.length > 0 ? info[0].values.map(r => r[1]) : [];
      if (!cols.includes('space_id')) {
        db.run("ALTER TABLE shelves ADD COLUMN space_id TEXT DEFAULT 'personal'");
      }
      if (!cols.includes('server_id')) {
        db.run('ALTER TABLE shelves ADD COLUMN server_id INTEGER');
      }
      // 创建 v2 新表
      db.run(`
        CREATE TABLE IF NOT EXISTS spaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('personal', 'team')),
          server_id INTEGER,
          synced_at INTEGER
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS sync_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          table_name TEXT NOT NULL,
          record_id INTEGER,
          operation TEXT NOT NULL CHECK(operation IN ('insert', 'update', 'delete')),
          endpoint TEXT NOT NULL,
          payload TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      db.run('CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)');
      db.run("INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)]);
      console.log('[DB] v1 → v2 迁移完成');
    } catch (e) {
      console.warn('[DB] 迁移失败（可能已是 v2）:', e.message);
    }
  }

  // v2 → v3 迁移
  function migrateV2toV3() {
    try {
      db.run(`
        CREATE TABLE IF NOT EXISTS _users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          display_name TEXT DEFAULT '',
          created_at INTEGER NOT NULL
        )
      `);
      db.run("INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)]);
      console.log('[DB] v2 → v3 迁移完成');
    } catch (e) {
      console.warn('[DB] 迁移失败（可能已是 v3）:', e.message);
    }
  }

  // v3 → v4 迁移
  function migrateV3toV4() {
    try {
      const info = db.exec("PRAGMA table_info('shelves')");
      const cols = info.length > 0 ? info[0].values.map(r => r[1]) : [];
      if (!cols.includes('owner_id')) {
        db.run("ALTER TABLE shelves ADD COLUMN owner_id TEXT DEFAULT 'anon'");
      }
      db.run("INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)]);
      console.log('[DB] v3 → v4 迁移完成');
    } catch (e) {
      console.warn('[DB] 迁移失败（可能已是 v4）:', e.message);
    }
  }

  // ---- 查询辅助 ----

  function rowToPart(row) {
    if (!row) return null;
    return {
      id: row[0],
      name: row[1],
      code: row[2],
      specs: row[3],
      quantity: row[4],
      note: row[5],
      shelfRow: row[6],
      shelfCol: row[7],
      shelfId: row[8],
      createdAt: row[9],
      updatedAt: row[10],
    };
  }

  function rowToShelf(row) {
    if (!row) return null;
    return { id: row[0], name: row[1], space_id: row[2], server_id: row[3], owner_id: row[4], createdAt: row[5] };
  }

  // ---- 初始化 ----

  async function open() {
    if (db) return db;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      const SQL = await initSqlJs({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/sql.js@1.10/dist/${file}`,
      });

      // 尝试从 OPFS 加载已有数据库
      let savedData = await loadFromOPFS();

      // OPFS 不可用时回退到 localStorage
      if (!savedData) {
        const base64 = localStorage.getItem(DB_FILE);
        if (base64) {
          try { savedData = base64ToArray(base64); } catch (e) { /* ignore */ }
        }
      }

      if (savedData && savedData.length > 0) {
        db = new SQL.Database(savedData);
        db.run('PRAGMA foreign_keys = ON');
        migrateV1toV2();
        migrateV2toV3();
        migrateV3toV4();
        console.log('[DB] 从 OPFS 加载已有数据库');
      } else {
        db = new SQL.Database();
        createSchema();
        console.log('[DB] 创建新数据库');
      }

      return db;
    })();

    return initPromise;
  }

  // ---- Shelves ----

  async function createShelf(name, ownerId) {
    await open();
    const oid = ownerId || 'anon';
    db.run('INSERT INTO shelves (name, space_id, owner_id, createdAt) VALUES (?, ?, ?, ?)', [name, 'personal', oid, Date.now()]);
    const result = db.exec('SELECT last_insert_rowid()');
    scheduleSave();
    return result[0].values[0][0];
  }

  async function getAllShelves(ownerId) {
    await open();
    let sql = 'SELECT * FROM shelves';
    let params = [];
    if (ownerId) { sql += ' WHERE owner_id = ?'; params.push(ownerId); }
    sql += ' ORDER BY createdAt';
    const result = db.exec(sql, params);
    if (!result.length || !result[0].values.length) return [];
    return result[0].values.map(rowToShelf);
  }

  async function updateShelf(id, name) {
    await open();
    db.run('UPDATE shelves SET name = ? WHERE id = ?', [name, id]);
    scheduleSave();
  }

  async function deleteShelf(id) {
    await open();
    db.run('DELETE FROM parts WHERE shelfId = ?', [id]);
    db.run('DELETE FROM shelves WHERE id = ?', [id]);
    scheduleSave();
  }

  // ---- Parts ----

  async function add(part) {
    await open();
    const now = Date.now();
    db.run(
      `INSERT INTO parts (name, code, specs, quantity, note, shelfRow, shelfCol, shelfId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        part.name || '', part.code || '', part.specs || '',
        part.quantity || 1, part.note || '',
        part.shelfRow ?? null, part.shelfCol ?? null,
        part.shelfId ?? null, now,
      ]
    );
    const result = db.exec('SELECT last_insert_rowid()');
    scheduleSave();
    return result[0].values[0][0];
  }

  async function update(id, part) {
    await open();
    db.run(
      `UPDATE parts SET name=?, code=?, specs=?, quantity=?, note=?, shelfRow=?, shelfCol=?, shelfId=?, updatedAt=?
       WHERE id=?`,
      [
        part.name ?? '', part.code ?? '', part.specs ?? '',
        part.quantity ?? 1, part.note ?? '',
        part.shelfRow ?? null, part.shelfCol ?? null,
        part.shelfId ?? null, Date.now(), id,
      ]
    );
    scheduleSave();
  }

  async function remove(id) {
    await open();
    db.run('DELETE FROM parts WHERE id = ?', [id]);
    scheduleSave();
  }

  async function get(id) {
    await open();
    const result = db.exec('SELECT * FROM parts WHERE id = ?', [id]);
    if (!result.length || !result[0].values.length) return null;
    return rowToPart(result[0].values[0]);
  }

  async function getByPosition(row, col, shelfId) {
    await open();
    const result = db.exec(
      'SELECT * FROM parts WHERE shelfRow = ? AND shelfCol = ? AND shelfId = ? LIMIT 1',
      [row, col, shelfId]
    );
    if (!result.length || !result[0].values.length) return null;
    return rowToPart(result[0].values[0]);
  }

  async function getByShelf(shelfId) {
    await open();
    const result = db.exec('SELECT * FROM parts WHERE shelfId = ? ORDER BY shelfRow, shelfCol', [shelfId]);
    if (!result.length || !result[0].values.length) return [];
    return result[0].values.map(rowToPart);
  }

  async function getAll() {
    await open();
    const result = db.exec('SELECT * FROM parts');
    if (!result.length || !result[0].values.length) return [];
    return result[0].values.map(rowToPart);
  }

  async function migratePartsToShelf(shelfId) {
    await open();
    db.run('UPDATE parts SET shelfId = ? WHERE shelfId IS NULL', [shelfId]);
    scheduleSave();
  }

  // ---- Spaces (v2) ----

  async function getSpaces() {
    await open();
    const result = db.exec('SELECT * FROM spaces ORDER BY type, name');
    if (!result.length || !result[0].values.length) {
      // 首次：自动创建个人空间
      db.run("INSERT INTO spaces (id, name, type) VALUES ('personal', '个人空间', 'personal')");
      scheduleSave();
      return [{ id: 'personal', name: '个人空间', type: 'personal', server_id: null, synced_at: null }];
    }
    return result[0].values.map(r => ({ id: r[0], name: r[1], type: r[2], server_id: r[3], synced_at: r[4] }));
  }

  async function createSpace(id, name, type, serverId) {
    await open();
    db.run('INSERT OR REPLACE INTO spaces (id, name, type, server_id, synced_at) VALUES (?, ?, ?, ?, ?)',
      [id, name, type, serverId || null, Date.now()]);
    scheduleSave();
  }

  async function updateSpaceSyncTime(spaceId) {
    await open();
    db.run('UPDATE spaces SET synced_at = ? WHERE id = ?', [Date.now(), spaceId]);
    scheduleSave();
  }

  async function getShelvesBySpace(spaceId) {
    await open();
    const result = db.exec('SELECT * FROM shelves WHERE space_id = ? ORDER BY createdAt', [spaceId]);
    if (!result.length || !result[0].values.length) return [];
    return result[0].values.map(rowToShelf);
  }

  async function updateShelfServerId(localId, serverId) {
    await open();
    db.run('UPDATE shelves SET server_id = ? WHERE id = ?', [serverId, localId]);
    scheduleSave();
  }

  // ---- Sync Queue (v2) ----

  async function enqueueSync(tableName, recordId, operation, endpoint, payload) {
    await open();
    db.run(
      'INSERT INTO sync_queue (table_name, record_id, operation, endpoint, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [tableName, recordId, operation, endpoint, JSON.stringify(payload), Date.now()]
    );
    scheduleSave();
  }

  async function getSyncQueue() {
    await open();
    const result = db.exec('SELECT * FROM sync_queue ORDER BY id');
    if (!result.length || !result[0].values.length) return [];
    return result[0].values.map(r => ({
      id: r[0], table_name: r[1], record_id: r[2],
      operation: r[3], endpoint: r[4], payload: JSON.parse(r[5] || '{}'), created_at: r[6],
    }));
  }

  async function clearSyncEntry(id) {
    await open();
    db.run('DELETE FROM sync_queue WHERE id = ?', [id]);
    scheduleSave();
  }

  async function countSyncQueue() {
    await open();
    const result = db.exec('SELECT COUNT(*) as count FROM sync_queue');
    if (!result.length || !result[0].values.length) return 0;
    return result[0].values[0][0];
  }

  // ---- Local Users (v3) ----

  function rowToUser(row) {
    if (!row) return null;
    return { id: row[0], username: row[1], password_hash: row[2], display_name: row[3], created_at: row[4] };
  }

  async function createLocalUser(username, passwordHash) {
    await open();
    db.run(
      'INSERT INTO _users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)',
      [username, passwordHash, username, Date.now()]
    );
    const result = db.exec('SELECT last_insert_rowid()');
    scheduleSave();
    return result[0].values[0][0];
  }

  async function getLocalUser(username) {
    await open();
    const result = db.exec('SELECT * FROM _users WHERE username = ?', [username]);
    if (!result.length || !result[0].values.length) return null;
    return rowToUser(result[0].values[0]);
  }

  async function updateLocalUser(id, fields) {
    await open();
    const sets = [];
    const vals = [];
    if (fields.display_name !== undefined) { sets.push('display_name = ?'); vals.push(fields.display_name); }
    if (sets.length === 0) return;
    vals.push(id);
    db.run(`UPDATE _users SET ${sets.join(', ')} WHERE id = ?`, vals);
    scheduleSave();
  }

  return {
    open, saveNow,
    // Shelves
    createShelf, getAllShelves, updateShelf, deleteShelf,
    // Parts
    add, update, remove, get, getByPosition, getByShelf, getAll, migratePartsToShelf,
    // Spaces (v2)
    getSpaces, createSpace, updateSpaceSyncTime, getShelvesBySpace, updateShelfServerId,
    // Sync (v2)
    enqueueSync, getSyncQueue, clearSyncEntry, countSyncQueue,
    // Local Users (v3)
    createLocalUser, getLocalUser, updateLocalUser,
  };
})();
