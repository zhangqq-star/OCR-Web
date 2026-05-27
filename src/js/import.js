/**
 * Excel 导入模块 v2.0 — 多 Sheet、多货架列、起始位置、溢出续架
 */
const Importer = (() => {
  const COLS = 8;
  let workbookData = null;
  let activeSheet = '';
  let parsedRows = [];
  let shelfGroups = null;
  let activeGroupShelf = '';
  let startRow = 0, startCol = 0;
  let targetRowCount = 4;

  function triggerFilePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.onchange = e => {
      const file = e.target.files[0];
      if (file) readFile(file);
    };
    input.click();
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const sheets = {};
        const validNames = [];
        wb.SheetNames.forEach(name => {
          const ws = wb.Sheets[name];
          const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
          const rows = parseRows(json);
          if (rows.length > 0) {
            sheets[name] = rows;
            validNames.push(name);
          }
        });
        if (validNames.length === 0) {
          showToast('未找到符合格式的数据（需包含"编号"或"名称"列）');
          return;
        }
        workbookData = { sheetNames: validNames, sheets };
        activeSheet = validNames[0];
        applySheet();
        showConfigModal();
      } catch (err) {
        console.error('Excel parse error:', err);
        showToast('文件解析失败，请检查文件格式');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function parseRows(json) {
    const rows = [];
    for (const row of json) {
      let code = String(row['编号'] || '').trim();
      const name = String(row['名称'] || '').trim();
      if (!code && !name) continue;

      // 编号不足10位，左边补0
      if (code && /^\d+$/.test(code) && code.length < 10) {
        code = code.padStart(10, '0');
      }

      let shelfRow = null, shelfCol = null;
      const excelRow = row['货架行'], excelCol = row['货架列'];
      if (excelRow !== '' && excelRow != null && excelCol !== '' && excelCol != null) {
        const r = parseInt(excelRow) - 1;
        const c = parseInt(excelCol) - 1;
        if (r >= 0 && c >= 0 && c < COLS) { shelfRow = r; shelfCol = c; }
      }

      rows.push({
        code, name,
        specs: String(row['规格'] || '').trim(),
        quantity: parseInt(row['数量']) || 1,
        note: String(row['备注'] || '').trim(),
        shelfRow, shelfCol,
        shelfName: String(row['货架'] || '').trim() || null,
      });
    }
    return rows;
  }

  function applySheet() {
    parsedRows = workbookData.sheets[activeSheet];
    shelfGroups = null;
    activeGroupShelf = '';
    startRow = 0; startCol = 0;

    const hasShelfCol = parsedRows.some(r => r.shelfName);
    if (hasShelfCol) {
      shelfGroups = {};
      for (const row of parsedRows) {
        const sn = row.shelfName || '(未指定)';
        if (!shelfGroups[sn]) shelfGroups[sn] = [];
        shelfGroups[sn].push(row);
      }
      activeGroupShelf = Object.keys(shelfGroups)[0];
    }
  }

  async function switchSheet(name) {
    activeSheet = name;
    applySheet();
    await resetTargetUI();
    updateImportSummary();
    await renderImportPreview();
  }

  // ===== 配置弹窗 =====

  async function showConfigModal() {
    // Sheet 选择器
    const sheetRow = document.getElementById('importSheetRow');
    const sheetSelect = document.getElementById('importSheetSelect');
    if (workbookData.sheetNames.length > 1) {
      sheetRow.classList.remove('hidden');
      sheetSelect.innerHTML = workbookData.sheetNames.map(n =>
        `<option value="${escapeHtml(n)}" ${n === activeSheet ? 'selected' : ''}>${escapeHtml(n)}</option>`
      ).join('');
    } else {
      sheetRow.classList.add('hidden');
    }

    await resetTargetUI();
    await refreshTargetRowCount();

    resetSegControl('#importDirection', 0);
    resetSegControl('#importPolicy', 0);

    updateImportSummary();
    await renderImportPreview();
    document.getElementById('modalImport').classList.remove('hidden');
  }

  function resetSegControl(selector, idx) {
    const ctrl = document.querySelector(selector);
    const btns = ctrl.querySelectorAll('.seg-btn');
    btns.forEach((b, i) => b.classList.toggle('active', i === idx));
    ctrl.setAttribute('data-active', idx + 1);
  }

  async function resetTargetUI(forceSingle = false) {
    const targetRow = document.getElementById('importTargetRow');
    const groupTargetRow = document.getElementById('importGroupTargetRow');
    const shelfRow = document.getElementById('importShelfRow');
    const newShelfRow = document.getElementById('importNewShelfRow');
    const groupInfoRow = document.getElementById('importGroupInfoRow');

    if (shelfGroups && !forceSingle) {
      targetRow.classList.add('hidden');
      groupTargetRow.classList.remove('hidden');
      groupInfoRow.classList.remove('hidden');
      shelfRow.classList.add('hidden');
      newShelfRow.classList.add('hidden');
      resetSegControl('#importGroupTarget', 0);
      renderGroupSelect();
    } else {
      targetRow.classList.remove('hidden');
      groupTargetRow.classList.add('hidden');
      groupInfoRow.classList.add('hidden');
      resetSegControl('#importTarget', 0);
      document.getElementById('importShelfRow').classList.remove('hidden');
      document.getElementById('importNewShelfRow').classList.add('hidden');
      await fillShelfSelect();
    }
  }

  async function fillShelfSelect() {
    const shelves = await DB.getAllShelves(Auth.getOwnerId());
    const select = document.getElementById('importShelfSelect');
    select.innerHTML = shelves.map(s =>
      `<option value="${s.id}" ${s.id === Shelf.getActiveShelfId() ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
    ).join('');
  }

  async function refreshTargetRowCount() {
    const config = getConfig();
    if (config.groupTarget === 'by-shelf' && shelfGroups) {
      // 按货架分组时，以当前预览货架为准
      const shelves = await DB.getAllShelves(Auth.getOwnerId());
      const existing = shelves.find(s => s.name === activeGroupShelf);
      targetRowCount = existing ? (existing.rowCount || 4) : 4;
    } else if (config.target === 'overwrite') {
      const shelfId = parseInt(document.getElementById('importShelfSelect').value);
      const shelves = await DB.getAllShelves(Auth.getOwnerId());
      const s = shelves.find(s => s.id === shelfId);
      targetRowCount = s ? (s.rowCount || 4) : 4;
    } else {
      targetRowCount = 4;
    }
    updateImportRowCountUI();
  }

  function updateImportRowCountUI() {
    const el = document.getElementById('importRowCount');
    if (el) el.textContent = `${targetRowCount} 行`;
    const btnMinus = document.getElementById('btnImportRowMinus');
    if (btnMinus) btnMinus.disabled = targetRowCount <= 1;
  }

  function adjustImportRowCount(delta) {
    const newCount = targetRowCount + delta;
    if (newCount < 1) return;
    targetRowCount = newCount;
    updateImportRowCountUI();
    renderImportPreview();
  }

  function renderGroupSelect() {
    const select = document.getElementById('importGroupShelfSelect');
    const names = Object.keys(shelfGroups);
    select.innerHTML = names.map(n =>
      `<option value="${escapeHtml(n)}" ${n === activeGroupShelf ? 'selected' : ''}>${escapeHtml(n)}（${shelfGroups[n].length} 行）</option>`
    ).join('');
    activeGroupShelf = select.value;
  }

  function switchGroupShelf(name) {
    activeGroupShelf = name;
    renderImportPreview();
  }

  function updateImportSummary() {
    const el = document.getElementById('importSummary');
    const withPos = parsedRows.filter(r => r.shelfRow != null).length;
    let text = `${activeSheet} · 共 ${parsedRows.length} 行，${withPos} 行有位置，${parsedRows.length - withPos} 行自动分配`;
    if (shelfGroups) {
      text += ` · ${Object.keys(shelfGroups).length} 个货架`;
    }
    el.textContent = text;

    // 溢出警告
    updateSpillWarning();
  }

  function updateSpillWarning() {
    const el = document.getElementById('importSpillWarning');
    const config = getConfig();
    const isByShelf = config.groupTarget === 'by-shelf' && shelfGroups;

    if (isByShelf) {
      el.classList.add('hidden');
      return;
    }

    const autoCount = parsedRows.filter(r => r.shelfRow == null).length;
    const occupiedCount = getOccupiedCount(config);
    const maxCells = targetRowCount * COLS;
    const available = maxCells - occupiedCount;

    if (autoCount > available && available >= 0) {
      const overflow = autoCount - available;
      const spillShelves = Math.ceil(overflow / maxCells);
      el.textContent = `当前货架仅剩 ${available} 空位，将自动创建 ${spillShelves} 个续架容纳剩余 ${overflow} 行`;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function getOccupiedCount(config) {
    // 估算占用数 — 预览时无法精确知道，使用粗略值
    if (config.target === 'new') return 0;
    // 对于 overwrite 目标我们不知道具体占用情况，这里返回 0 表示不触发溢出警告
    // 实际溢出在执行时处理
    return 0;
  }

  function getConfig() {
    const groupTarget = document.querySelector('#importGroupTarget .seg-btn.active')?.dataset.target || 'by-shelf';
    const target = document.querySelector('#importTarget .seg-btn.active')?.dataset.target || 'overwrite';
    const direction = document.querySelector('#importDirection .seg-btn.active')?.dataset.dir || 'row-first';
    const policy = document.querySelector('#importPolicy .seg-btn.active')?.dataset.policy || 'skip';
    return { target, groupTarget, direction, policy };
  }

  // ===== 核心算法 =====

  function computePlan(rows, occupiedMap, direction, policy, sRow, sCol) {
    const occupied = new Map(occupiedMap);
    const plan = [];
    let stopped = false;

    const fixedPos = rows.filter(r => r.shelfRow != null);
    const autoPool = [];

    for (const row of fixedPos) {
      if (stopped) break;
      const key = `${row.shelfRow}_${row.shelfCol}`;
      if (occupied.has(key)) {
        if (policy === 'overwrite') {
          plan.push({ row: row.shelfRow, col: row.shelfCol, src: row, type: 'overwrite', shelfOffset: 0 });
          occupied.set(key, { code: row.code, name: row.name });
        } else if (policy === 'skip') {
          autoPool.push(row);
        } else {
          stopped = true;
        }
      } else {
        plan.push({ row: row.shelfRow, col: row.shelfCol, src: row, type: 'new', shelfOffset: 0 });
        occupied.set(key, { code: row.code, name: row.name });
      }
    }

    if (!stopped) {
      const autoRows = [...autoPool, ...rows.filter(r => r.shelfRow == null)];
      const cursor = { r: sRow, c: sCol };
      let spillIdx = 0;
      const maxCells = targetRowCount * COLS;

      for (const row of autoRows) {
        if (stopped) break;
        let safety = 0;
        while (safety < maxCells * 20) {
          safety++;
          if (cursor.r >= targetRowCount || cursor.c >= COLS) {
            spillIdx++;
            cursor.r = 0; cursor.c = 0;
          }
          const key = `${cursor.r}_${cursor.c}`;

          if (spillIdx > 0) {
            plan.push({ row: cursor.r, col: cursor.c, src: row, type: 'new', shelfOffset: spillIdx });
            advance(cursor, direction);
            break;
          }

          if (!occupied.has(key)) {
            plan.push({ row: cursor.r, col: cursor.c, src: row, type: 'new', shelfOffset: 0 });
            occupied.set(key, { code: row.code, name: row.name });
            advance(cursor, direction);
            break;
          }

          if (policy === 'overwrite') {
            plan.push({ row: cursor.r, col: cursor.c, src: row, type: 'overwrite', shelfOffset: 0 });
            occupied.set(key, { code: row.code, name: row.name });
            advance(cursor, direction);
            break;
          }

          if (policy === 'stop') {
            stopped = true;
            break;
          }

          // skip: try next
          advance(cursor, direction);
        }
      }
    }

    const maxOffset = plan.reduce((m, p) => Math.max(m, p.shelfOffset || 0), 0);
    return { items: plan, spillShelves: maxOffset };
  }

  function advance(cur, dir) {
    if (dir === 'row-first') {
      cur.c++;
      if (cur.c >= COLS) { cur.c = 0; cur.r++; }
    } else {
      cur.r++;
      if (cur.r >= targetRowCount) { cur.r = 0; cur.c++; }
    }
  }

  function computePlansByGroup(direction, policy) {
    const plans = {};
    for (const [shelfName, rows] of Object.entries(shelfGroups)) {
      plans[shelfName] = computePlan(rows, new Map(), direction, policy, 0, 0);
    }
    return plans;
  }

  // ===== 预览 =====

  async function renderImportPreview() {
    const grid = document.getElementById('importPreviewGrid');
    const config = getConfig();

    if (config.groupTarget === 'by-shelf' && shelfGroups) {
      await renderGroupPreview(grid, config);
    } else {
      await renderSinglePreview(grid, config);
    }
  }

  async function renderSinglePreview(grid, config) {
    let occupiedMap = new Map();
    let targetShelfId = null;
    let targetShelfName = '';

    if (config.target === 'overwrite') {
      targetShelfId = parseInt(document.getElementById('importShelfSelect').value);
      const parts = await DB.getByShelf(targetShelfId);
      parts.forEach(p => {
        if (p.shelfRow != null && p.shelfCol != null) {
          occupiedMap.set(`${p.shelfRow}_${p.shelfCol}`, { code: p.code, name: p.name });
        }
      });
    }

    const { items: plan, spillShelves } = computePlan(parsedRows, occupiedMap, config.direction, config.policy, startRow, startCol);
    const planMap = new Map();
    plan.forEach(p => {
      if (p.shelfOffset === 0) planMap.set(`${p.row}_${p.col}`, p);
    });

    renderGrid(grid, occupiedMap, planMap, startRow, startCol, config.direction);

    // 溢出信息
    const spillEl = document.getElementById('importSpillWarning');
    if (spillShelves > 0) {
      const baseName = targetShelfName || document.getElementById('importShelfSelect')?.selectedOptions?.[0]?.text || '货架';
      spillEl.textContent = `当前货架已满，将自动创建 ${spillShelves} 个续架（${baseName}-续1 ~ ${baseName}-续${spillShelves}）`;
      spillEl.classList.remove('hidden');
    } else {
      spillEl.classList.add('hidden');
    }
  }

  async function renderGroupPreview(grid, config) {
    const rows = shelfGroups[activeGroupShelf] || [];
    const plans = computePlansByGroup(config.direction, config.policy);
    const plan = plans[activeGroupShelf] || { items: [], spillShelves: 0 };
    const planMap = new Map();
    plan.items.forEach(p => {
      if (p.shelfOffset === 0) planMap.set(`${p.row}_${p.col}`, p);
    });

    // 检查现有货架中同名货架的占用
    const shelves = await DB.getAllShelves(Auth.getOwnerId());
    const existingShelf = shelves.find(s => s.name === activeGroupShelf);
    let occupiedMap = new Map();
    if (existingShelf) {
      const parts = await DB.getByShelf(existingShelf.id);
      parts.forEach(p => {
        if (p.shelfRow != null && p.shelfCol != null) {
          occupiedMap.set(`${p.shelfRow}_${p.shelfCol}`, { code: p.code, name: p.name });
        }
      });
    }

    const gStartRow = 0, gStartCol = 0;
    renderGrid(grid, occupiedMap, planMap, gStartRow, gStartCol, config.direction);

    const spillEl = document.getElementById('importSpillWarning');
    if (plan.spillShelves > 0) {
      spillEl.textContent = `${activeGroupShelf} 已满，将自动创建 ${plan.spillShelves} 个续架`;
      spillEl.classList.remove('hidden');
    } else {
      spillEl.classList.add('hidden');
    }
  }

  function renderGrid(grid, occupiedMap, planMap, sRow, sCol, direction) {
    grid.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
    grid.innerHTML = '';
    const maxCells = targetRowCount * COLS;

    // 计算路径
    const pathCells = [];
    let pr = sRow, pc = sCol;
    for (let i = 0; i < maxCells && pathCells.length < maxCells; i++) {
      if (pr >= targetRowCount) break;
      const key = `${pr}_${pc}`;
      if (!planMap.has(key) && !occupiedMap.has(key)) {
        pathCells.push(key);
      }
      if (direction === 'row-first') { pc++; if (pc >= COLS) { pc = 0; pr++; } }
      else { pr++; if (pr >= targetRowCount) { pr = 0; pc++; } }
    }

    for (let row = 0; row < targetRowCount; row++) {
      for (let col = 0; col < COLS; col++) {
        const key = `${row}_${col}`;
        const planItem = planMap.get(key);
        const existing = occupiedMap.get(key);

        const cell = document.createElement('div');
        cell.className = 'import-preview-cell';

        const posEl = document.createElement('span');
        posEl.className = 'import-preview-pos';
        posEl.textContent = `${row + 1}-${col + 1}`;
        cell.appendChild(posEl);

        if (planItem) {
          const codeEl = document.createElement('span');
          codeEl.className = 'import-preview-code';
          codeEl.textContent = planItem.src.code || planItem.src.name || '(空)';
          cell.appendChild(codeEl);
          cell.classList.add(planItem.type === 'overwrite' ? 'preview-overwrite' : 'preview-new');
        } else if (existing) {
          const codeEl = document.createElement('span');
          codeEl.className = 'import-preview-code';
          codeEl.textContent = existing.code || existing.name || '(空)';
          cell.appendChild(codeEl);
          cell.classList.add('preview-existing');
        } else {
          cell.classList.add('preview-empty');
        }

        // 起始位置标记
        if (row === sRow && col === sCol && !planItem) {
          cell.classList.add('preview-start');
        }

        // 路径标记
        const pathIdx = pathCells.indexOf(key);
        if (pathIdx >= 0 && pathIdx < 8) {
          cell.classList.add('preview-path');
        }

        cell.addEventListener('click', () => {
          startRow = row; startCol = col;
          renderImportPreview();
        });

        grid.appendChild(cell);
      }
    }
  }

  // ===== 执行导入 =====

  async function executeImport() {
    const config = getConfig();
    const totalRows = parsedRows.length;

    if (config.groupTarget === 'by-shelf' && shelfGroups) {
      await executeByGroup(config);
      return;
    }

    let targetShelfId;
    let baseShelfName;
    if (config.target === 'new') {
      const name = document.getElementById('importNewShelfName').value.trim();
      if (!name) { showToast('请输入新货架名称'); return; }
      targetShelfId = await DB.createShelf(name, Auth.getOwnerId(), targetRowCount);
      baseShelfName = name;
    } else {
      targetShelfId = parseInt(document.getElementById('importShelfSelect').value);
      const shelves = await DB.getAllShelves(Auth.getOwnerId());
      baseShelfName = shelves.find(s => s.id === targetShelfId)?.name || '货架';
      await DB.updateShelfRowCount(targetShelfId, targetRowCount);
    }

    const parts = await DB.getByShelf(targetShelfId);
    const occupiedMap = new Map();
    parts.forEach(p => {
      if (p.shelfRow != null && p.shelfCol != null) {
        occupiedMap.set(`${p.shelfRow}_${p.shelfCol}`, { id: p.id, code: p.code, name: p.name });
      }
    });

    const { items: plan, spillShelves } = computePlan(parsedRows, occupiedMap, config.direction, config.policy, startRow, startCol);

    // 预创建续架
    const spillShelfIds = [targetShelfId];
    for (let i = 1; i <= spillShelves; i++) {
      const name = `${baseShelfName}-续${i}`;
      const id = await DB.createShelf(name, Auth.getOwnerId());
      spillShelfIds.push(id);
    }

    let success = 0, overwrite = 0, skipped = 0;
    for (const item of plan) {
      const shelfId = spillShelfIds[item.shelfOffset || 0];
      if (item.type === 'overwrite') {
        const existing = occupiedMap.get(`${item.row}_${item.col}`);
        if (existing?.id) await DataStore.removePart(existing.id);
        overwrite++;
      }
      await DataStore.addPart({
        code: item.src.code,
        name: item.src.name,
        specs: item.src.specs,
        quantity: item.src.quantity,
        note: item.src.note,
        shelfRow: item.row,
        shelfCol: item.col,
        shelfId,
      });
      success++;
    }

    skipped = totalRows - success;

    document.getElementById('modalImport').classList.add('hidden');
    parsedRows = [];
    shelfGroups = null;
    workbookData = null;

    await Shelf.init();

    document.getElementById('importSumSuccess').textContent = `${success} 个`;
    document.getElementById('importSumOverwrite').textContent = `${overwrite} 个`;
    document.getElementById('importSumSkip').textContent = `${skipped} 个`;
    document.getElementById('importSumShelves').textContent = spillShelves > 0 ? `${spillShelves} 个续架` : '0';
    document.getElementById('modalImportSummary').classList.remove('hidden');
  }

  async function executeByGroup(config) {
    const plans = computePlansByGroup(config.direction, config.policy);
    const shelves = await DB.getAllShelves(Auth.getOwnerId());
    const shelfNameToId = new Map(shelves.map(s => [s.name, s.id]));

    let success = 0, overwrite = 0, newShelves = 0, skipped = 0;

    for (const [shelfName, plan] of Object.entries(plans)) {
      let shelfId = shelfNameToId.get(shelfName);
      if (!shelfId) {
        shelfId = await DB.createShelf(shelfName, Auth.getOwnerId(), targetRowCount);
        shelfNameToId.set(shelfName, shelfId);
        newShelves++;
      } else {
        await DB.updateShelfRowCount(shelfId, targetRowCount);
      }

      const parts = await DB.getByShelf(shelfId);
      const occupiedMap = new Map();
      parts.forEach(p => {
        if (p.shelfRow != null && p.shelfCol != null) {
          occupiedMap.set(`${p.shelfRow}_${p.shelfCol}`, { id: p.id, code: p.code, name: p.name });
        }
      });

      // 为每个货架独立计算 plan（考虑现有占用）
      const rows = shelfGroups[shelfName];
      const { items } = computePlan(rows, occupiedMap, config.direction, config.policy, 0, 0);

      // 预创建续架
      const maxOffset = items.reduce((m, p) => Math.max(m, p.shelfOffset || 0), 0);
      const spillIds = [shelfId];
      for (let i = 1; i <= maxOffset; i++) {
        const spillName = `${shelfName}-续${i}`;
        let spillId = shelfNameToId.get(spillName);
        if (!spillId) {
          spillId = await DB.createShelf(spillName, Auth.getOwnerId());
          shelfNameToId.set(spillName, spillId);
          newShelves++;
        }
        spillIds.push(spillId);
      }

      for (const item of items) {
        const sid = spillIds[item.shelfOffset || 0];
        if (item.type === 'overwrite') {
          const key = `${item.row}_${item.col}`;
          const existing = occupiedMap.get(key);
          if (existing?.id) await DataStore.removePart(existing.id);
          overwrite++;
        }
        await DataStore.addPart({
          code: item.src.code,
          name: item.src.name,
          specs: item.src.specs,
          quantity: item.src.quantity,
          note: item.src.note,
          shelfRow: item.row,
          shelfCol: item.col,
          shelfId: sid,
        });
        success++;
      }
    }

    document.getElementById('modalImport').classList.add('hidden');
    parsedRows = [];
    shelfGroups = null;
    workbookData = null;

    await Shelf.init();

    document.getElementById('importSumSuccess').textContent = `${success} 个`;
    document.getElementById('importSumOverwrite').textContent = `${overwrite} 个`;
    document.getElementById('importSumSkip').textContent = `${skipped} 个`;
    document.getElementById('importSumShelves').textContent = `${newShelves} 个`;
    document.getElementById('modalImportSummary').classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('modalImport').classList.add('hidden');
    parsedRows = [];
    shelfGroups = null;
    workbookData = null;
  }

  function closeSummary() {
    document.getElementById('modalImportSummary').classList.add('hidden');
  }

  return {
    triggerFilePicker, closeModal, closeSummary,
    executeImport, renderImportPreview,
    switchSheet, switchGroupShelf, resetTargetUI,
    adjustImportRowCount, refreshTargetRowCount,
    get shelfGroups() { return shelfGroups; },
  };
})();
