/**
 * 主入口 — 串联所有模块、事件绑定、Tab 切换
 */

// 全局 Toast
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => el.classList.add('hidden'), 2000);
}

// 当前识别结果暂存
let pendingOcrResult = null;
let selectedBatchCodeIdx = 0; // 批量模式下用户选择的编号索引

// 连续导入状态
let batchState = null; // { shelfId, startRow, startCol, currentRow, currentCol, direction, overwritePolicy, occupied, count, skipCount, overwriteCount, startTime, totalCells }
function isBatchMode() { return batchState !== null; }

// 应用模式: 'local' | 'connected'
let appMode = 'local';

// ===== DataStore 抽象层 =====
const DataStore = {
  async addPart(part) {
    if (appMode === 'connected' && TeamManager.isTeamSpace()) {
      const space = TeamManager.getCurrentSpace();
      try {
        const res = await API.post(`/api/teams/${space.server_id}/shelves/${part.shelfId}/parts`, {
          name: part.name, code: part.code, specs: part.specs,
          quantity: part.quantity, note: part.note,
          shelfRow: part.shelfRow, shelfCol: part.shelfCol,
        });
        // 同时缓存到本地
        const localPart = { ...part, updatedAt: Date.now() };
        await DB.add(localPart);
        return res.data.id;
      } catch (e) {
        showToast('网络异常，已保存到本地');
      }
    }
    return DB.add(part);
  },

  async updatePart(id, part) {
    if (appMode === 'connected' && TeamManager.isTeamSpace()) {
      const space = TeamManager.getCurrentSpace();
      try {
        await API.put(`/api/teams/${space.server_id}/shelves/${part.shelfId}/parts/${id}`, part);
      } catch (e) { showToast('网络异常，已保存到本地'); }
    }
    return DB.update(id, part);
  },

  async removePart(id) {
    if (appMode === 'connected' && TeamManager.isTeamSpace()) {
      const space = TeamManager.getCurrentSpace();
      try {
        const part = await DB.get(id);
        if (part) {
          await API.del(`/api/teams/${space.server_id}/shelves/${part.shelfId}/parts/${id}`);
        }
      } catch (e) { /* ignore */ }
    }
    return DB.remove(id);
  },

  async getByShelf(shelfId) {
    if (appMode === 'connected' && TeamManager.isTeamSpace()) {
      try {
        const space = TeamManager.getCurrentSpace();
        const res = await API.get(`/api/teams/${space.server_id}/shelves/${shelfId}/parts`);
        // 同时更新本地缓存
        return (res.data || []).map(p => ({ ...p, shelfId: p.shelf_id, shelfRow: p.shelf_row, shelfCol: p.shelf_col, updatedAt: p.updated_at }));
      } catch (e) { /* fallback to local */ }
    }
    return DB.getByShelf(shelfId);
  },

  async getByPosition(row, col, shelfId) {
    return DB.getByPosition(row, col, shelfId);
  },

  async get(id) {
    return DB.get(id);
  },

  async getAllShelves() {
    if (appMode === 'connected' && TeamManager.isTeamSpace()) {
      try {
        const space = TeamManager.getCurrentSpace();
        const res = await API.get(`/api/teams/${space.server_id}/shelves`);
        return (res.data || []).map(s => ({ id: s.id, name: s.name, createdAt: s.created_at }));
      } catch (e) { /* fallback */ }
    }
    const space = TeamManager.getCurrentSpace();
    if (space) {
      return DB.getShelvesBySpace(space.id);
    }
    return DB.getAllShelves();
  },
};

// ===== Tab 切换 =====
function switchTab(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  document.querySelector(`[data-view="${viewId}"]`).classList.add('active');

  if (viewId === 'viewShelf') {
    Shelf.render();
  } else {
    if (!Camera.isActive() && !isBatchMode()) {
      resetScanUI();
    }
    if (isBatchMode()) {
      updateBatchStatus();
    }
  }
}

// ===== 摄像头 =====
async function startCamera() {
  document.getElementById('scanPlaceholder').classList.add('hidden');
  const ok = await Camera.start();
  if (!ok) {
    document.getElementById('scanPlaceholder').classList.remove('hidden');
    showToast('无法访问摄像头，请检查权限');
    return;
  }
  document.getElementById('btnStartCamera').classList.add('hidden');
  document.getElementById('btnCapture').classList.remove('hidden');
  document.getElementById('btnStopCamera').classList.remove('hidden');
}

function stopCamera() {
  Camera.stop();
  resetScanUI();
}

function resetScanUI() {
  if (isBatchMode()) {
    document.getElementById('ocrProgress').classList.add('hidden');
    document.getElementById('ocrResult').classList.add('hidden');
    pendingOcrResult = null;
    if (Camera.isActive()) {
      // 摄像头工作中：恢复视频预览
      const video = document.getElementById('video');
      video.classList.remove('hidden');
      video.play();
    } else {
      // 摄像头已关闭：显示打开按钮，隐藏视频和拍照按钮
      document.getElementById('video').classList.add('hidden');
      document.getElementById('scanPlaceholder').classList.remove('hidden');
      document.getElementById('btnStartCamera').classList.remove('hidden');
      document.getElementById('btnCapture').classList.add('hidden');
      document.getElementById('btnStopCamera').classList.add('hidden');
    }
    return;
  }
  document.getElementById('btnStartCamera').classList.remove('hidden');
  document.getElementById('btnCapture').classList.add('hidden');
  document.getElementById('btnStopCamera').classList.add('hidden');
  document.getElementById('scanPlaceholder').classList.remove('hidden');
  document.getElementById('ocrProgress').classList.add('hidden');
  document.getElementById('ocrResult').classList.add('hidden');
  document.getElementById('video').classList.remove('hidden');
}

// ===== OCR 流程 =====
async function doCapture() {
  if (!Camera.isActive()) {
    showToast('请先打开摄像头');
    return;
  }

  const imageData = Camera.capture();
  if (!imageData) {
    showToast('拍照失败，请重试');
    return;
  }

  const video = document.getElementById('video');
  video.pause();
  video.classList.add('hidden');

  document.getElementById('ocrProgress').classList.remove('hidden');
  document.getElementById('ocrProgressText').textContent = '识别中...';

  try {
    const result = await OCR.recognize(imageData);
    document.getElementById('ocrProgress').classList.add('hidden');
    showOcrResult(result);
  } catch (err) {
    console.error('OCR error:', err);
    document.getElementById('ocrProgress').classList.add('hidden');
    showToast('识别失败，请重试');
    video.play();
    video.classList.remove('hidden');
  }
}

function showOcrResult(result) {
  const el = document.getElementById('ocrResult');
  const content = document.getElementById('ocrResultContent');
  const raw = result.raw || '';
  const codes = result.codes || [];

  let html = '';

  if (result.debugImage) {
    html += `<div style="margin-bottom:4px; font-size:0.75rem; color:var(--accent); font-weight:600;">▼ 送给 OCR 的图片</div>`;
    html += `<img src="${result.debugImage}" style="width:100%; max-height:160px; object-fit:contain; border-radius:8px; margin-bottom:10px; border:1px solid var(--glass-border);">`;
  }

  const mode = result.mode || '常规模式';
  html += `<div style="margin-bottom:8px; padding:6px 10px; background:rgba(108,140,255,0.15); border-radius:6px; font-size:0.78rem; color:var(--accent);">识别模式：${escapeHtml(mode)}</div>`;

  if (result.confidence != null) {
    html += `<div style="margin-bottom:8px; font-size:0.75rem; color:var(--text-secondary);">置信度: ${Math.round(result.confidence)}%</div>`;
  }

  selectedBatchCodeIdx = 0;
  if (codes.length > 0) {
    html += `<div style="margin-bottom:8px; padding:8px; background:rgba(108,140,255,0.2); border-radius:8px; text-align:center;">`;
    html += `<div style="font-size:0.7rem; color:var(--accent); margin-bottom:4px;">已提取零件编号${codes.length > 1 ? '（点击选择）' : ''}</div>`;
    html += codes.map((c, i) => {
      const isActive = i === 0 ? 'ocr-code-active' : '';
      return `<div class="ocr-code-select ${isActive}" data-ocr-idx="${i}" style="font-size:1.1rem; font-weight:700; letter-spacing:2px; font-variant-numeric:tabular-nums; cursor:pointer; padding:4px 8px; margin:2px 0; border-radius:6px; transition:background 0.15s;">${escapeHtml(c)}</div>`;
    }).join('');
    html += `</div>`;
  }

  html += `<div style="margin-bottom:4px; font-size:0.75rem; color:var(--accent); font-weight:600;">▼ OCR 原始输出</div>`;
  html += `<div style="padding:10px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); border-radius:8px; font-size:0.85rem; line-height:1.6; white-space:pre-wrap; word-break:break-all;">${raw ? escapeHtml(raw) : '<span style="opacity:0.4;">(空)</span>'}</div>`;

  content.innerHTML = html;

  // 批量模式 + 多编号：绑定点击选择事件
  if (isBatchMode() && codes.length > 1) {
    content.querySelectorAll('.ocr-code-select').forEach(el => {
      el.addEventListener('click', function () {
        content.querySelectorAll('.ocr-code-select').forEach(e => e.classList.remove('ocr-code-active'));
        this.classList.add('ocr-code-active');
        selectedBatchCodeIdx = parseInt(this.dataset.ocrIdx) || 0;
      });
    });
  }

  pendingOcrResult = { raw: result.raw, codes, confidence: result.confidence };
  el.classList.remove('hidden');

  if (isBatchMode()) {
    // 批量模式：显示批量操作按钮，不自动打开位置选择
    document.getElementById('ocrActionsNormal').classList.add('hidden');
    document.getElementById('ocrActionsBatch').classList.remove('hidden');
    updateBatchStatus();
  } else {
    // 正常模式：显示标准按钮
    document.getElementById('ocrActionsNormal').classList.remove('hidden');
    document.getElementById('ocrActionsBatch').classList.add('hidden');
    if (codes.length > 0) {
      setTimeout(() => {
        el.classList.add('hidden');
        openPositionPicker();
      }, 400);
    }
  }
}

function doOcrConfirm() {
  if (!pendingOcrResult) {
    showToast('没有可保存的识别结果');
    return;
  }
  document.getElementById('ocrResult').classList.add('hidden');
  openPositionPicker();
}

function doOcrRetry() {
  document.getElementById('ocrResult').classList.add('hidden');
  pendingOcrResult = null;
  const video = document.getElementById('video');
  video.classList.remove('hidden');
  video.play();
}

// ===== 位置选择 =====
async function openPositionPicker() {
  const grid = document.getElementById('positionGrid');
  const cols = Shelf.getCols();
  const rows = Shelf.getRows();

  const codes = (pendingOcrResult && pendingOcrResult.codes) ? pendingOcrResult.codes : [];
  document.getElementById('positionCode').value = codes[0] || '';

  const shelfId = Shelf.getActiveShelfId();
  const parts = await DataStore.getByShelf(shelfId);
  const occupied = new Set();
  parts.forEach(p => {
    if (p.shelfRow != null && p.shelfCol != null) {
      occupied.add(`${p.shelfRow}_${p.shelfCol}`);
    }
  });

  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.innerHTML = '';

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const key = `${row}_${col}`;
      const cell = document.createElement('div');
      cell.className = 'position-cell';
      cell.textContent = `${row + 1}-${col + 1}`;

      if (occupied.has(key)) {
        cell.classList.add('taken');
      } else {
        cell.addEventListener('click', () => {
          grid.querySelectorAll('.position-cell').forEach(c => c.classList.remove('selected'));
          cell.classList.add('selected');
          document.getElementById('modalPosition').dataset.row = row;
          document.getElementById('modalPosition').dataset.col = col;
          document.getElementById('modalPosition').dataset.ready = '1';
        });
      }

      grid.appendChild(cell);
    }
  }

  document.getElementById('modalPosition').dataset.ready = '0';
  document.getElementById('modalPosition').classList.remove('hidden');
}

async function confirmPosition() {
  const modal = document.getElementById('modalPosition');
  if (modal.dataset.ready !== '1') {
    showToast('请选择一个位置');
    return;
  }

  const row = parseInt(modal.dataset.row);
  const col = parseInt(modal.dataset.col);
  const shelfId = Shelf.getActiveShelfId();

  const code = document.getElementById('positionCode').value.trim();
  const codes = pendingOcrResult.codes || [];
  const finalCode = code || codes[0] || '';

  await DataStore.addPart({
    name: '',
    code: finalCode,
    specs: '',
    quantity: 1,
    note: pendingOcrResult.raw || '',
    shelfRow: row,
    shelfCol: col,
    shelfId,
  });

  modal.classList.add('hidden');
  document.getElementById('ocrResult').classList.add('hidden');
  pendingOcrResult = null;
  showToast(`已存入 ${row + 1} 行 ${col + 1} 列`);
  resetScanUI();
  stopCamera();
}

function cancelPosition() {
  document.getElementById('modalPosition').classList.add('hidden');
}

// ===== 连续导入 =====

async function openBatchStartModal() {
  // 弹出货架选择
  const shelves = await DB.getAllShelves();
  const select = document.getElementById('batchShelfSelect');
  select.innerHTML = shelves.map(s =>
    `<option value="${s.id}" ${s.id === Shelf.getActiveShelfId() ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
  ).join('');

  // 重置分段控件
  document.querySelector('#batchDirection .seg-btn.active').classList.remove('active');
  document.querySelector('#batchDirection [data-dir="row-first"]').classList.add('active');
  document.querySelector('#batchPolicy .seg-btn.active').classList.remove('active');
  document.querySelector('#batchPolicy [data-policy="skip"]').classList.add('active');

  batchState = null; // 还没正式开始，先清空
  renderBatchPositionGrid();
  document.getElementById('modalBatchStart').classList.remove('hidden');
}

function closeBatchStartModal() {
  document.getElementById('modalBatchStart').classList.add('hidden');
}

function getBatchStartConfig() {
  const shelfId = parseInt(document.getElementById('batchShelfSelect').value);
  const direction = document.querySelector('#batchDirection .seg-btn.active').dataset.dir;
  const overwritePolicy = document.querySelector('#batchPolicy .seg-btn.active').dataset.policy;
  return { shelfId, direction, overwritePolicy };
}

async function renderBatchPositionGrid() {
  const grid = document.getElementById('batchPositionGrid');
  const { shelfId, direction, overwritePolicy } = getBatchStartConfig();
  const parts = await DB.getByShelf(shelfId);
  const occupied = new Set();
  parts.forEach(p => {
    if (p.shelfRow != null && p.shelfCol != null) {
      occupied.add(`${p.shelfRow}_${p.shelfCol}`);
    }
  });

  // 找第一个空格子作为默认起始位置
  let defaultRow = 0, defaultCol = 0;
  for (let r = 0; r < Shelf.getRows(); r++) {
    for (let c = 0; c < Shelf.getCols(); c++) {
      if (!occupied.has(`${r}_${c}`)) { defaultRow = r; defaultCol = c; break; }
    }
    if (!occupied.has(`${defaultRow}_${defaultCol}`)) break;
  }

  let selectedRow = defaultRow;
  let selectedCol = defaultCol;
  // 保留之前的选择（如果仍合法）
  if (grid.dataset.selRow != null && grid.dataset.selCol != null) {
    const prevKey = `${grid.dataset.selRow}_${grid.dataset.selCol}`;
    if (!occupied.has(prevKey) || overwritePolicy !== 'skip') {
      selectedRow = parseInt(grid.dataset.selRow);
      selectedCol = parseInt(grid.dataset.selCol);
    }
  }

  // 计算路径预览（从选中位置起始最多显示 8 个）
  const pathCells = [];
  let r = selectedRow, c = selectedCol;
  for (let i = 0; i < 32 && pathCells.length < 8; i++) {
    const key = `${r}_${c}`;
    const isOcc = occupied.has(key);
    if (!isOcc || overwritePolicy === 'overwrite') {
      pathCells.push(key);
    } else if (isOcc && overwritePolicy === 'stop') {
      break;
    }
    // skip: 不计入预览
    if (direction === 'row-first') { c++; if (c >= Shelf.getCols()) { c = 0; r++; } }
    else { r++; if (r >= Shelf.getRows()) { r = 0; c++; } }
    if (r >= Shelf.getRows() || c >= Shelf.getCols()) break;
  }

  grid.style.gridTemplateColumns = `repeat(${Shelf.getCols()}, 1fr)`;
  grid.dataset.selRow = selectedRow;
  grid.dataset.selCol = selectedCol;
  grid.innerHTML = '';

  for (let row = 0; row < Shelf.getRows(); row++) {
    for (let col = 0; col < Shelf.getCols(); col++) {
      const key = `${row}_${col}`;
      const cell = document.createElement('div');
      cell.className = 'position-cell';
      cell.textContent = `${row + 1}-${col + 1}`;

      if (occupied.has(key)) {
        cell.classList.add('taken');
      }

      const pathIdx = pathCells.indexOf(key);
      if (key === `${selectedRow}_${selectedCol}`) {
        cell.classList.add('start-point');
      } else if (pathIdx > 0) {
        cell.classList.add('path-member');
        cell.dataset.order = pathIdx + 1;
      }

      if (!occupied.has(key) || overwritePolicy !== 'skip') {
        cell.addEventListener('click', () => {
          grid.dataset.selRow = row;
          grid.dataset.selCol = col;
          renderBatchPositionGrid();
        });
      }

      grid.appendChild(cell);
    }
  }
}

function startBatchImport() {
  const grid = document.getElementById('batchPositionGrid');
  const selRow = parseInt(grid.dataset.selRow);
  const selCol = parseInt(grid.dataset.selCol);
  if (isNaN(selRow) || isNaN(selCol)) {
    showToast('请选择起始位置');
    return;
  }

  const { shelfId, direction, overwritePolicy } = getBatchStartConfig();
  const totalCells = countRemainingPositions(selRow, selCol, direction, shelfId, overwritePolicy);

  if (totalCells === 0) {
    showToast('货架已无可用位置');
    return;
  }

  // 加载当前占用情况
  DB.getByShelf(shelfId).then(parts => {
    const occupied = new Set();
    parts.forEach(p => {
      if (p.shelfRow != null && p.shelfCol != null) {
        occupied.add(`${p.shelfRow}_${p.shelfCol}`);
      }
    });

    batchState = {
      shelfId,
      startRow: selRow,
      startCol: selCol,
      currentRow: selRow,
      currentCol: selCol,
      direction,
      overwritePolicy,
      occupied,
      count: 0,
      skipCount: 0,
      overwriteCount: 0,
      startTime: Date.now(),
      totalCells,
    };

    closeBatchStartModal();

    // 显示批量状态栏
    document.getElementById('batchStatus').classList.remove('hidden');
    updateBatchStatus();

    // 启动摄像头（如果没启动）
    if (!Camera.isActive()) {
      startCamera().then(() => {
        // 确保批量按钮可见
        document.getElementById('btnBatchImport').classList.add('hidden');
      });
    } else {
      document.getElementById('btnBatchImport').classList.add('hidden');
    }

    showToast(`连续导入已开始，共 ${totalCells} 个可用位置`);
  });
}

function countRemainingPositions(startRow, startCol, direction, shelfId, overwritePolicy) {
  let count = 0;
  let r = startRow, c = startCol;
  const rows = Shelf.getRows(), cols = Shelf.getCols();

  // 这个函数不 await DB，用同步方式粗略估计
  for (let i = 0; i < rows * cols; i++) {
    if (r >= rows || c >= cols) break;
    count++;
    if (direction === 'row-first') { c++; if (c >= cols) { c = 0; r++; } }
    else { r++; if (r >= rows) { r = 0; c++; } }
  }
  return count;
}

function nextBatchPosition() {
  if (!batchState) return null;
  const bs = batchState;
  let row = bs.currentRow;
  let col = bs.currentCol;
  const rows = Shelf.getRows(), cols = Shelf.getCols();

  for (let i = 0; i < rows * cols; i++) {
    // 前进一格
    if (bs.direction === 'row-first') {
      col++;
      if (col >= cols) { col = 0; row++; }
    } else {
      row++;
      if (row >= rows) { row = 0; col++; }
    }

    if (row >= rows || col >= cols) return null;

    const key = `${row}_${col}`;
    const isOccupied = bs.occupied.has(key);

    if (!isOccupied) {
      return { row, col };
    }
    if (isOccupied && bs.overwritePolicy === 'overwrite') {
      return { row, col };
    }
    if (isOccupied && bs.overwritePolicy === 'stop') {
      return null;
    }
    // skip policy: continue looping
  }

  return null;
}

function updateBatchStatus() {
  if (!batchState) return;
  const bs = batchState;
  const text = document.getElementById('batchStatusText');
  const fill = document.getElementById('batchProgressFill');

  text.textContent = `当前：第 ${bs.currentRow + 1} 行 第 ${bs.currentCol + 1} 列 · 已存 ${bs.count} 个`;

  const done = bs.count + bs.skipCount;
  const pct = bs.totalCells > 0 ? Math.min(100, Math.round((done / bs.totalCells) * 100)) : 0;
  fill.style.width = pct + '%';
}

async function batchConfirm() {
  if (!batchState) return;
  const bs = batchState;

  const codes = pendingOcrResult?.codes || [];
  const finalCode = codes[selectedBatchCodeIdx] || codes[0] || '';

  // 检查是否是覆盖，若是则先删除旧零件
  const key = `${bs.currentRow}_${bs.currentCol}`;
  const isOverwrite = bs.occupied.has(key);

  if (isOverwrite) {
    const existing = await DataStore.getByPosition(bs.currentRow, bs.currentCol, bs.shelfId);
    if (existing) await DataStore.removePart(existing.id);
    bs.overwriteCount++;
  }

  await DataStore.addPart({
    name: '',
    code: finalCode,
    specs: '',
    quantity: 1,
    note: pendingOcrResult?.raw || '',
    shelfRow: bs.currentRow,
    shelfCol: bs.currentCol,
    shelfId: bs.shelfId,
  });

  bs.occupied.add(key);
  bs.count++;

  // 前进到下一个位置
  const next = nextBatchPosition();
  if (!next) {
    batchEnd();
    return;
  }

  bs.currentRow = next.row;
  bs.currentCol = next.col;
  resetScanUI();
  updateBatchStatus();
  showToast(`已存入 · 下一位置：${next.row + 1} 行 ${next.col + 1} 列`);
}

function batchSkip() {
  if (!batchState) return;
  const bs = batchState;
  bs.skipCount++;

  const next = nextBatchPosition();
  if (!next) {
    batchEnd();
    return;
  }

  bs.currentRow = next.row;
  bs.currentCol = next.col;
  resetScanUI();
  updateBatchStatus();
  showToast(`已跳过 · 下一位置：${next.row + 1} 行 ${next.col + 1} 列`);
}

function batchRetry() {
  // 隐藏结果，恢复视频，重新拍照
  document.getElementById('ocrResult').classList.add('hidden');
  pendingOcrResult = null;
  const video = document.getElementById('video');
  video.classList.remove('hidden');
  video.play();
}

async function batchManual() {
  if (!batchState) return;
  const bs = batchState;
  const defaultCode = (pendingOcrResult && pendingOcrResult.codes && pendingOcrResult.codes.length > 0)
    ? pendingOcrResult.codes[0]
    : '';
  const code = prompt('请输入 10 位零件编号：', defaultCode);
  if (!code || !code.trim()) return;

  const key = `${bs.currentRow}_${bs.currentCol}`;
  const isOverwrite = bs.occupied.has(key);

  if (isOverwrite) {
    const existing = await DataStore.getByPosition(bs.currentRow, bs.currentCol, bs.shelfId);
    if (existing) await DataStore.removePart(existing.id);
    bs.overwriteCount++;
  }

  await DataStore.addPart({
    name: '',
    code: code.trim(),
    specs: '',
    quantity: 1,
    note: '',
    shelfRow: bs.currentRow,
    shelfCol: bs.currentCol,
    shelfId: bs.shelfId,
  });

  bs.occupied.add(key);
  bs.count++;

  const next = nextBatchPosition();
  if (!next) {
    batchEnd();
    return;
  }

  bs.currentRow = next.row;
  bs.currentCol = next.col;
  resetScanUI();
  updateBatchStatus();
  showToast(`已手动录入 · 下一位置：${next.row + 1} 行 ${next.col + 1} 列`);
}

function batchEnd() {
  if (!batchState) return;
  const elapsed = Date.now() - batchState.startTime;
  const bs = batchState;

  // 清理 UI
  document.getElementById('batchStatus').classList.add('hidden');
  document.getElementById('btnBatchImport').classList.remove('hidden');
  document.getElementById('ocrResult').classList.add('hidden');
  pendingOcrResult = null;

  const video = document.getElementById('video');
  video.classList.remove('hidden');
  video.play();

  // 显示汇总
  document.getElementById('batchSummarySuccess').textContent = `${bs.count} 个`;
  document.getElementById('batchSummarySkipped').textContent = `${bs.skipCount} 个`;
  document.getElementById('batchSummaryOverwritten').textContent = `${bs.overwriteCount} 个`;
  const secs = Math.round(elapsed / 1000);
  document.getElementById('batchSummaryTime').textContent = secs < 60 ? `${secs} 秒` : `${Math.floor(secs / 60)} 分 ${secs % 60} 秒`;
  document.getElementById('modalBatchSummary').classList.remove('hidden');

  // 重新加载占用情况，刷新货架
  Shelf.render();

  batchState = null;
}

function closeBatchSummary() {
  document.getElementById('modalBatchSummary').classList.add('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== 事件绑定 =====
function bindEvents() {
  // Tab 切换
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.view));
  });

  // 摄像头
  document.getElementById('btnStartCamera').addEventListener('click', startCamera);
  document.getElementById('btnStopCamera').addEventListener('click', stopCamera);
  document.getElementById('btnCapture').addEventListener('click', doCapture);

  // OCR 结果
  document.getElementById('btnOcrConfirm').addEventListener('click', doOcrConfirm);
  document.getElementById('btnOcrRetry').addEventListener('click', doOcrRetry);

  // 位置选择
  document.getElementById('btnPositionCancel').addEventListener('click', cancelPosition);
  document.getElementById('modalPosition').querySelector('.modal-backdrop')
    .addEventListener('click', cancelPosition);

  // 位置确认按钮
  const posModal = document.getElementById('modalPosition');
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn-primary';
  confirmBtn.textContent = '确认位置';
  confirmBtn.style.marginTop = '12px';
  confirmBtn.style.width = '100%';
  confirmBtn.addEventListener('click', confirmPosition);
  posModal.querySelector('.modal-card').appendChild(confirmBtn);

  // 连续导入 — 打开起始位置弹窗
  document.getElementById('btnBatchImport').addEventListener('click', openBatchStartModal);

  // 连续导入 — 起始位置弹窗
  document.getElementById('btnBatchCancel').addEventListener('click', closeBatchStartModal);
  document.getElementById('modalBatchStart').querySelector('.modal-backdrop')
    .addEventListener('click', closeBatchStartModal);
  document.getElementById('btnBatchStart').addEventListener('click', startBatchImport);

  // 连续导入 — 方向/策略切换时重新渲染预览
  document.querySelectorAll('#batchDirection .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#batchDirection .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderBatchPositionGrid();
    });
  });
  document.querySelectorAll('#batchPolicy .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#batchPolicy .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderBatchPositionGrid();
    });
  });

  // 连续导入 — 货架切换时重新渲染预览
  document.getElementById('batchShelfSelect').addEventListener('change', renderBatchPositionGrid);

  // 连续导入 — 批量操作按钮
  document.getElementById('btnBatchConfirm').addEventListener('click', batchConfirm);
  document.getElementById('btnBatchSkip').addEventListener('click', batchSkip);
  document.getElementById('btnBatchRetry').addEventListener('click', batchRetry);
  document.getElementById('btnBatchManual').addEventListener('click', batchManual);
  document.getElementById('btnBatchEnd').addEventListener('click', batchEnd);
  document.getElementById('btnBatchExitTop').addEventListener('click', batchEnd);

  // 连续导入 — 汇总弹窗
  document.getElementById('btnBatchSummaryContinue').addEventListener('click', () => {
    closeBatchSummary();
    openBatchStartModal();
  });
  document.getElementById('btnBatchSummaryView').addEventListener('click', () => {
    closeBatchSummary();
    stopCamera();
    switchTab('viewShelf');
  });
  document.getElementById('modalBatchSummary').querySelector('.modal-backdrop')
    .addEventListener('click', closeBatchSummary);

  // 详情弹窗
  document.getElementById('formDetail').addEventListener('submit', Shelf.saveDetail);
  document.getElementById('btnDetailCancel').addEventListener('click', Shelf.closeDetail);
  document.getElementById('btnDetailDelete').addEventListener('click', Shelf.deleteDetail);
  document.getElementById('modalDetail').querySelector('.modal-backdrop')
    .addEventListener('click', Shelf.closeDetail);

  // 货架导航
  document.getElementById('btnShelfPrev').addEventListener('click', Shelf.switchToPrev);
  document.getElementById('btnShelfNext').addEventListener('click', Shelf.switchToNext);
  document.getElementById('btnShelfAdd').addEventListener('click', Shelf.createShelf);
  document.getElementById('shelfName').addEventListener('click', Shelf.renameCurrent);
  document.getElementById('shelfName').addEventListener('dblclick', Shelf.renameCurrent);

  // 货架滑动切换
  Shelf.setupSwipe();

  // 导出
  document.getElementById('btnExport').addEventListener('click', Exporter.exportToExcel);

  // 窗口大小改变时重新渲染货架
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (document.getElementById('viewShelf').classList.contains('active')) {
        Shelf.render();
      }
    }, 250);
  });

  // ---- 空间/账号相关 ----

  // Header 按钮
  document.getElementById('btnProfile').addEventListener('click', () => {
    renderSpaceModal();
    document.getElementById('modalSpace').classList.remove('hidden');
  });
  document.getElementById('spaceBadge').addEventListener('click', () => {
    renderSpaceModal();
    document.getElementById('modalSpace').classList.remove('hidden');
  });

  // 空间弹窗关闭
  document.getElementById('modalSpace').querySelector('.modal-backdrop').addEventListener('click', () => {
    document.getElementById('modalSpace').classList.add('hidden');
  });

  // 动态按钮（通过事件委托绑定到 modalSpace）
  document.getElementById('modalSpace').addEventListener('click', (e) => {
    if (e.target.id === 'btnSpaceLogin') {
      document.getElementById('modalSpace').classList.add('hidden');
      showLogin();
    }
    if (e.target.id === 'btnSpaceRegister') {
      document.getElementById('modalSpace').classList.add('hidden');
      showRegister();
    }
    if (e.target.id === 'btnCreateTeam') {
      document.getElementById('modalSpace').classList.add('hidden');
      resetCreateTeam();
      document.getElementById('modalCreateTeam').classList.remove('hidden');
    }
    if (e.target.id === 'btnJoinTeam') {
      document.getElementById('modalSpace').classList.add('hidden');
      document.getElementById('joinTeamId').value = '';
      document.getElementById('joinInviteCode').value = '';
      document.getElementById('joinTeamError').classList.add('hidden');
      document.getElementById('modalJoinTeam').classList.remove('hidden');
    }
    if (e.target.id === 'btnLogoutModal') {
      doLogout();
    }
  });

  // 空间视图内按钮
  document.getElementById('spaceContent').addEventListener('click', (e) => {
    if (e.target.id === 'btnShowLogin') showLogin();
    if (e.target.id === 'btnShowRegister') showRegister();
    if (e.target.id === 'btnCreateTeamInline') {
      resetCreateTeam();
      document.getElementById('modalCreateTeam').classList.remove('hidden');
    }
    if (e.target.id === 'btnJoinTeamInline') {
      document.getElementById('joinTeamId').value = '';
      document.getElementById('joinInviteCode').value = '';
      document.getElementById('joinTeamError').classList.add('hidden');
      document.getElementById('modalJoinTeam').classList.remove('hidden');
    }
  });

  // 登录弹窗
  document.getElementById('formLogin').addEventListener('submit', doLogin);
  document.getElementById('btnLoginCancel').addEventListener('click', () => {
    document.getElementById('modalLogin').classList.add('hidden');
  });
  document.getElementById('modalLogin').querySelector('.modal-backdrop').addEventListener('click', () => {
    document.getElementById('modalLogin').classList.add('hidden');
  });
  document.getElementById('btnGotoRegister').addEventListener('click', () => {
    document.getElementById('modalLogin').classList.add('hidden');
    showRegister();
  });

  // 注册弹窗
  document.getElementById('formRegister').addEventListener('submit', doRegister);
  document.getElementById('btnRegCancel').addEventListener('click', () => {
    document.getElementById('modalRegister').classList.add('hidden');
  });
  document.getElementById('modalRegister').querySelector('.modal-backdrop').addEventListener('click', () => {
    document.getElementById('modalRegister').classList.add('hidden');
  });
  document.getElementById('btnGotoLogin').addEventListener('click', () => {
    document.getElementById('modalRegister').classList.add('hidden');
    showLogin();
  });

  // 创建团队弹窗
  document.getElementById('formCreateTeam').addEventListener('submit', doCreateTeam);
  document.getElementById('btnCreateTeamCancel').addEventListener('click', () => {
    document.getElementById('modalCreateTeam').classList.add('hidden');
  });
  document.getElementById('modalCreateTeam').querySelector('.modal-backdrop').addEventListener('click', () => {
    document.getElementById('modalCreateTeam').classList.add('hidden');
  });
  document.getElementById('btnCreateTeamDone').addEventListener('click', () => {
    document.getElementById('modalCreateTeam').classList.add('hidden');
  });

  // 加入团队弹窗
  document.getElementById('formJoinTeam').addEventListener('submit', doJoinTeam);
  document.getElementById('btnJoinTeamCancel').addEventListener('click', () => {
    document.getElementById('modalJoinTeam').classList.add('hidden');
  });
  document.getElementById('modalJoinTeam').querySelector('.modal-backdrop').addEventListener('click', () => {
    document.getElementById('modalJoinTeam').classList.add('hidden');
  });

  // 数据迁移弹窗
  document.getElementById('modalMigration').querySelector('.modal-backdrop').addEventListener('click', () => {
    document.getElementById('modalMigration').classList.add('hidden');
  });
}

// ===== 空间管理 UI =====

async function loadSpaces() {
  const spaces = await DB.getSpaces();
  if (spaces.length === 0) {
    await DB.createSpace('personal', '个人空间', 'personal', null);
  }
}

function updateSpaceBadge() {
  const badge = document.getElementById('spaceBadge');
  const space = TeamManager.getCurrentSpace();
  if (space) {
    const name = space.name || '个人';
    badge.textContent = name.length > 6 ? name.slice(0, 6) + '...' : name;
  }
}

async function updateSyncBadge() {
  const count = await API.getQueueLength();
  const btn = document.getElementById('btnProfile');
  if (count > 0) {
    btn.textContent = '👤' + count;
  } else {
    btn.textContent = '👤';
  }
}

function renderSpaceView() {
  const prompt = document.getElementById('spaceLoginPrompt');
  const teamList = document.getElementById('spaceTeamList');

  if (!Auth.isLoggedIn()) {
    prompt.classList.remove('hidden');
    teamList.classList.add('hidden');
    return;
  }

  prompt.classList.add('hidden');
  teamList.classList.remove('hidden');

  const spaces = [];
  // 个人空间
  spaces.push({ id: 'personal', name: '个人空间', type: 'personal', member_count: 0, role: 'owner' });
  // 团队空间
  const teams = TeamManager.getTeams();
  teams.forEach(t => {
    spaces.push({ id: `team_${t.id}`, name: t.name, type: 'team', member_count: t.member_count, role: t.role });
  });

  const currentId = TeamManager.getCurrentSpace()?.id || 'personal';

  let html = '';
  spaces.forEach(s => {
    const isActive = s.id === currentId;
    const icon = s.type === 'personal' ? '🏠' : '👥';
    const meta = s.type === 'personal' ? '个人专属' : `${s.member_count || 0} 成员 · ${s.role || 'member'}`;
    html += `
      <div class="space-card ${isActive ? 'active' : ''}" data-space-id="${s.id}">
        <div class="space-card-icon">${icon}</div>
        <div class="space-card-info">
          <div class="space-card-name">${escapeHtml(s.name)}</div>
          <div class="space-card-meta">${meta}</div>
        </div>
      </div>`;
  });

  html += `
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button id="btnCreateTeamInline" class="btn-secondary" style="flex:1;">+ 创建团队</button>
      <button id="btnJoinTeamInline" class="btn-secondary" style="flex:1;">+ 加入团队</button>
    </div>`;

  teamList.innerHTML = html;

  // 绑定空间卡片点击
  teamList.querySelectorAll('.space-card').forEach(card => {
    card.addEventListener('click', async () => {
      const spaceId = card.dataset.spaceId;
      await TeamManager.switchSpace(spaceId);
      updateSpaceBadge();
      renderSpaceView();
      await Shelf.render();
    });
  });
}

function updateSpaceUI() {
  renderSpaceView();
  updateSpaceBadge();
}

function renderSpaceModal() {
  const list = document.getElementById('spaceList');
  const userInfo = document.getElementById('spaceUserInfo');
  const actions = document.getElementById('spaceActions');

  if (!Auth.isLoggedIn()) {
    list.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:20px;">请先登录</p>';
    actions.innerHTML = '<button id="btnSpaceLogin" class="btn-primary" style="width:100%;">登录</button><button id="btnSpaceRegister" class="btn-secondary" style="width:100%;margin-top:8px;">注册</button>';
    userInfo.classList.add('hidden');
  } else {
    const spaces = [];
    spaces.push({ id: 'personal', name: '个人空间', type: 'personal', meta: '个人专属' });
    const teams = TeamManager.getTeams();
    teams.forEach(t => {
      spaces.push({ id: `team_${t.id}`, name: t.name, type: 'team', meta: `${t.member_count || 0} 成员 · ${t.role || 'member'}` });
    });

    const currentId = TeamManager.getCurrentSpace()?.id || 'personal';
    list.innerHTML = spaces.map(s => {
      const icon = s.type === 'personal' ? '🏠' : '👥';
      const active = s.id === currentId ? 'active' : '';
      return `<div class="space-card ${active}" data-space-id="${s.id}" data-team-id="${s.type === 'team' ? s.id.replace('team_', '') : ''}">
        <div class="space-card-icon">${icon}</div>
        <div class="space-card-info">
          <div class="space-card-name">${escapeHtml(s.name)}</div>
          <div class="space-card-meta">${s.meta}</div>
        </div>
        ${s.type === 'team' ? '<button class="btn-secondary team-manage-btn" style="font-size:0.65rem;padding:3px 8px;flex-shrink:0;">管理</button>' : ''}
      </div>`;
    }).join('');

    userInfo.innerHTML = `
      <p style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px;">👤 ${escapeHtml(Auth.getUser()?.display_name || Auth.getUser()?.username || '')}</p>
      <button id="btnLogoutModal" class="btn-secondary" style="color:var(--danger);font-size:0.8rem;">退出登录</button>`;
    userInfo.classList.remove('hidden');

    // 空间切换
    list.querySelectorAll('.space-card').forEach(card => {
      card.addEventListener('click', async (e) => {
        if (e.target.closest('.team-manage-btn')) return;
        const spaceId = card.dataset.spaceId;
        await TeamManager.switchSpace(spaceId);
        updateSpaceBadge();
        await Shelf.render();
        document.getElementById('modalSpace').classList.add('hidden');
      });
    });

    // 团队管理按钮
    list.querySelectorAll('.team-manage-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = btn.closest('.space-card');
        const teamId = parseInt(card.dataset.teamId);
        openTeamManage(teamId);
        document.getElementById('modalSpace').classList.add('hidden');
      });
    });
  }
}

// ---- 登录/注册 ----

function showLogin() {
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('modalLogin').classList.remove('hidden');
}

function showRegister() {
  document.getElementById('regUsername').value = '';
  document.getElementById('regPassword').value = '';
  document.getElementById('regPassword2').value = '';
  document.getElementById('regError').classList.add('hidden');
  document.getElementById('modalRegister').classList.remove('hidden');
}

async function doLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');

  if (!username || !password) return;

  try {
    await Auth.login(username, password);
    appMode = 'connected';
    document.getElementById('modalLogin').classList.add('hidden');
    await TeamManager.loadTeams();
    updateSpaceUI();
    await Shelf.render();
    showToast('登录成功');
    // 检查是否有本地数据需要迁移
    checkMigration();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function doRegister(e) {
  e.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const password2 = document.getElementById('regPassword2').value;
  const errEl = document.getElementById('regError');

  if (!username || !password) return;
  if (password !== password2) {
    errEl.textContent = '两次密码不一致';
    errEl.classList.remove('hidden');
    return;
  }
  if (password.length < 6) {
    errEl.textContent = '密码至少 6 位';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    await Auth.register(username, '', password);
    appMode = 'connected';
    document.getElementById('modalRegister').classList.add('hidden');
    await TeamManager.loadTeams();
    updateSpaceUI();
    await Shelf.render();
    showToast('注册成功');
    checkMigration();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function doLogout() {
  Auth.logout();
  appMode = 'local';
  await TeamManager.switchSpace('personal');
  document.getElementById('modalSpace').classList.add('hidden');
  updateSpaceUI();
  await Shelf.render();
  showToast('已退出登录，数据保留在本地');
}

// ---- 团队管理 ----

async function doCreateTeam(e) {
  e.preventDefault();
  const name = document.getElementById('createTeamName').value.trim();
  const desc = document.getElementById('createTeamDesc').value.trim();
  const errEl = document.getElementById('createTeamError');

  if (!name) return;

  try {
    const team = await TeamManager.createTeam(name, desc);
    // 显示邀请码
    document.getElementById('formCreateTeam').classList.add('hidden');
    document.getElementById('createTeamResult').classList.remove('hidden');
    document.getElementById('inviteCodeDisplay').textContent = team.invite_code || 'N/A';
    updateSpaceUI();
    await Shelf.render();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

function resetCreateTeam() {
  document.getElementById('formCreateTeam').classList.remove('hidden');
  document.getElementById('createTeamResult').classList.add('hidden');
  document.getElementById('createTeamName').value = '';
  document.getElementById('createTeamDesc').value = '';
  document.getElementById('createTeamError').classList.add('hidden');
}

async function doJoinTeam(e) {
  e.preventDefault();
  const teamId = parseInt(document.getElementById('joinTeamId').value);
  const inviteCode = document.getElementById('joinInviteCode').value.trim();
  const errEl = document.getElementById('joinTeamError');

  if (!teamId || !inviteCode) return;

  try {
    await TeamManager.joinTeamById(teamId, inviteCode);
    document.getElementById('modalJoinTeam').classList.add('hidden');
    await TeamManager.loadTeams();
    await TeamManager.switchSpace(`team_${teamId}`);
    updateSpaceUI();
    await Shelf.render();
    showToast('成功加入团队');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function openTeamManage(teamId) {
  const modal = document.getElementById('modalTeamManage');
  const title = document.getElementById('teamManageTitle');
  const inviteEl = document.getElementById('teamManageInviteCode');
  const memberList = document.getElementById('teamMemberList');
  const btnLeave = document.getElementById('btnLeaveTeam');
  const btnDelete = document.getElementById('btnDeleteTeam');
  const btnManageClose = document.getElementById('btnTeamManageClose');

  try {
    const team = await API.get(`/api/teams/${teamId}`);
    title.textContent = `管理: ${team.data.name}`;
    inviteEl.textContent = team.data.invite_code || '无';

    const members = await TeamManager.getMembers(teamId);
    const currentUser = Auth.getUser();
    const isOwner = members.find(m => m.id === currentUser?.id)?.role === 'owner';

    memberList.innerHTML = members.map(m => `
      <div class="member-row">
        <div class="member-row-left">
          <span>👤 ${escapeHtml(m.display_name || m.username)}</span>
          <span class="member-role-tag ${m.role === 'owner' ? 'owner' : ''}">${m.role === 'owner' ? '创建者' : m.role === 'admin' ? '管理员' : '成员'}</span>
          ${m.id === currentUser?.id ? '<span style="font-size:0.6rem;color:var(--text-secondary);">你</span>' : ''}
        </div>
        ${isOwner && m.role !== 'owner' ? `
          <div class="member-actions">
            <button data-action="toggleRole" data-uid="${m.id}" data-role="${m.role}">${m.role === 'admin' ? '降为成员' : '升为管理员'}</button>
            <button data-action="remove" data-uid="${m.id}" style="color:var(--danger);">移除</button>
          </div>` : ''}
      </div>
    `).join('');

    // 成员操作
    memberList.querySelectorAll('[data-action="toggleRole"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = parseInt(btn.dataset.uid);
        const newRole = btn.dataset.role === 'admin' ? 'member' : 'admin';
        try {
          await TeamManager.updateMemberRole(teamId, uid, newRole);
          showToast('角色已更新');
          openTeamManage(teamId);
        } catch (err) { showToast(err.message); }
      });
    });
    memberList.querySelectorAll('[data-action="remove"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = parseInt(btn.dataset.uid);
        if (!confirm('确定移除该成员？')) return;
        try {
          await TeamManager.removeMember(teamId, uid);
          showToast('成员已移除');
          openTeamManage(teamId);
        } catch (err) { showToast(err.message); }
      });
    });

    // 重新生成邀请码
    document.getElementById('btnRegenInvite').onclick = async () => {
      try {
        const code = await TeamManager.regenerateInvite(teamId);
        inviteEl.textContent = code;
        showToast('邀请码已更新');
      } catch (err) { showToast(err.message); }
    };

    btnLeave.style.display = isOwner ? 'none' : '';
    btnDelete.style.display = isOwner ? '' : 'none';

    btnLeave.onclick = async () => {
      if (!confirm('确定离开该团队？')) return;
      try {
        await TeamManager.leaveTeam(teamId);
        modal.classList.add('hidden');
        updateSpaceUI();
        await Shelf.render();
        showToast('已离开团队');
      } catch (err) { showToast(err.message); }
    };

    btnDelete.onclick = async () => {
      if (!confirm('确定删除该团队？所有数据将被永久删除！')) return;
      try {
        await TeamManager.deleteTeam(teamId);
        modal.classList.add('hidden');
        updateSpaceUI();
        await Shelf.render();
        showToast('团队已删除');
      } catch (err) { showToast(err.message); }
    };

    btnManageClose.onclick = () => modal.classList.add('hidden');

    modal.classList.remove('hidden');
  } catch (err) {
    showToast('加载团队信息失败: ' + err.message);
  }
}

// ---- 数据迁移 ----

async function checkMigration() {
  if (!Auth.isLoggedIn()) return;
  // 检查是否有本地未上传的货架数据
  const shelves = await DB.getAllShelves();
  const localShelves = shelves.filter(s => !s.server_id || s.server_id === null);
  if (localShelves.length === 0) return;

  document.getElementById('migrationText').textContent =
    `检测到本地有 ${localShelves.length} 个货架的离线数据。是否上传到云端？`;
  document.getElementById('modalMigration').classList.remove('hidden');
  document.getElementById('migrationProgress').classList.add('hidden');
  document.querySelector('#modalMigration .modal-actions').classList.remove('hidden');

  document.getElementById('btnMigrationUpload').onclick = async () => {
    document.getElementById('migrationProgress').classList.remove('hidden');
    document.querySelector('#modalMigration .modal-actions').classList.add('hidden');

    for (const shelf of localShelves) {
      const parts = await DataStore.getByShelf(shelf.id);
      // 在个人空间创建货架
      const res = await API.post('/api/personal/shelves', { name: shelf.name });
      const serverShelf = res.data;
      await DB.updateShelfServerId(shelf.id, serverShelf.id);
      // 批量上传零件
      if (parts.length > 0) {
        const batches = [];
        for (let i = 0; i < parts.length; i += 50) {
          batches.push(parts.slice(i, i + 50));
        }
        for (const batch of batches) {
          await API.post(`/api/personal/shelves/${serverShelf.id}/parts/batch`, {
            parts: batch.map(p => ({
              name: p.name, code: p.code, specs: p.specs,
              quantity: p.quantity, note: p.note,
              shelfRow: p.shelfRow, shelfCol: p.shelfCol,
            })),
          });
        }
      }
    }

    document.getElementById('modalMigration').classList.add('hidden');
    showToast(`已上传 ${localShelves.length} 个货架的数据`);
    await Shelf.render();
  };

  document.getElementById('btnMigrationSkip').onclick = () => {
    document.getElementById('modalMigration').classList.add('hidden');
  };
}

// ===== 初始化 =====
async function init() {
  bindEvents();
  await DB.open();
  await Auth.init();
  appMode = Auth.isLoggedIn() ? 'connected' : 'local';
  await TeamManager.init();
  await loadSpaces();

  // 如果已登录，加载团队列表
  if (Auth.isLoggedIn()) {
    await TeamManager.loadTeams();
    updateSpaceUI();
  }

  await Shelf.init();
  updateSpaceBadge();

  // 在线/离线事件
  window.addEventListener('online', () => {
    document.getElementById('offlineIndicator').classList.add('hidden');
    API.flushQueue();
  });
  window.addEventListener('offline', () => {
    document.getElementById('offlineIndicator').classList.remove('hidden');
  });
  if (!navigator.onLine) {
    document.getElementById('offlineIndicator').classList.remove('hidden');
  }

  // 检查同步队列
  updateSyncBadge();

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.warn('SW 注册失败:', e);
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
