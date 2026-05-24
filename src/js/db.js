/**
 * SQLite 数据层 — SQL.js + OPFS 持久化
 * 数据库: OcrShelfDB (SQLite)
 */
const DB = (() => {
  const DB_FILE = 'ocrshelf.db';
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
    db.run(`
      CREATE TABLE IF NOT EXISTS shelves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
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
    // SQL.js 默认不启用外键，需手动开启
    db.run('PRAGMA foreign_keys = ON');
    db.run('CREATE INDEX IF NOT EXISTS idx_parts_shelfId ON parts(shelfId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_parts_position ON parts(shelfRow, shelfCol)');
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
    return { id: row[0], name: row[1], createdAt: row[2] };
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

  async function createShelf(name) {
    await open();
    db.run('INSERT INTO shelves (name, createdAt) VALUES (?, ?)', [name, Date.now()]);
    const result = db.exec('SELECT last_insert_rowid()');
    scheduleSave();
    return result[0].values[0][0];
  }

  async function getAllShelves() {
    await open();
    const result = db.exec('SELECT * FROM shelves ORDER BY createdAt');
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
    const result = db.exec('SELECT * FROM parts WHERE shelfId = ?', [shelfId]);
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

  return {
    open,
    // Shelves
    createShelf, getAllShelves, updateShelf, deleteShelf,
    // Parts
    add, update, remove, get, getByPosition, getByShelf, getAll, migratePartsToShelf,
  };
})();
