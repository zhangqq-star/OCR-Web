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

// ===== DataStore 抽象层 =====
const DataStore = {
  async addPart(part) { return DB.add(part); },
  async updatePart(id, part) { return DB.update(id, part); },
  async removePart(id) { return DB.remove(id); },
  async getByShelf(shelfId) { return DB.getByShelf(shelfId); },
  async getByPosition(row, col, shelfId) { return DB.getByPosition(row, col, shelfId); },
  async get(id) { return DB.get(id); },
  async getAllShelves() { return DB.getAllShelves(Auth.getOwnerId()); },
};

// ===== Tab 切换 =====
function switchTab(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  document.querySelector(`[data-view="${viewId}"]`).classList.add('active');

  if (viewId !== 'viewShelf') {
    Shelf.exitBatchMode();
  }

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
  const shelves = await DB.getAllShelves(Auth.getOwnerId());
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
  document.getElementById('btnShelfDelete').addEventListener('click', Shelf.deleteCurrent);
  document.getElementById('shelfName').addEventListener('click', Shelf.renameCurrent);
  document.getElementById('shelfName').addEventListener('dblclick', Shelf.renameCurrent);
  document.getElementById('btnShelfAddRow').addEventListener('click', Shelf.addRow);
  document.getElementById('btnShelfRemoveRow').addEventListener('click', Shelf.removeRow);

  // 批量管理
  document.getElementById('btnBatchManage').addEventListener('click', () => {
    if (document.getElementById('btnBatchManage').classList.contains('active')) {
      Shelf.exitBatchMode();
    } else {
      Shelf.enterBatchMode();
    }
  });
  document.getElementById('btnBatchSelectAll').addEventListener('click', Shelf.selectAll);
  document.getElementById('btnBatchDeleteSelected').addEventListener('click', Shelf.deleteSelected);
  document.getElementById('btnBatchExit').addEventListener('click', Shelf.exitBatchMode);

  // 货架滑动切换
  Shelf.setupSwipe();

  // 导出
  document.getElementById('btnExport').addEventListener('click', Exporter.exportToExcel);

  // 导入 Excel
  document.getElementById('btnImport').addEventListener('click', Importer.triggerFilePicker);
  document.getElementById('btnImportCancel').addEventListener('click', Importer.closeModal);
  document.getElementById('modalImport').querySelector('.modal-backdrop')
    .addEventListener('click', Importer.closeModal);
  document.getElementById('btnImportStart').addEventListener('click', Importer.executeImport);

  // 导入 Sheet 切换
  document.getElementById('importSheetSelect').addEventListener('change', function () {
    Importer.switchSheet(this.value);
  });

  // 导入配置变化 → 重新渲染预览
  document.querySelectorAll('#importTarget .seg-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#importTarget .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.target === 'new') {
        document.getElementById('importShelfRow').classList.add('hidden');
        document.getElementById('importNewShelfRow').classList.remove('hidden');
      } else {
        document.getElementById('importShelfRow').classList.remove('hidden');
        document.getElementById('importNewShelfRow').classList.add('hidden');
      }
      await Importer.refreshTargetRowCount();
      Importer.renderImportPreview();
    });
  });

  // 导入分组目标切换
  document.querySelectorAll('#importGroupTarget .seg-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#importGroupTarget .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const isByShelf = btn.dataset.target === 'by-shelf';
      document.getElementById('importGroupInfoRow').classList.toggle('hidden', !isByShelf);
      document.getElementById('importShelfRow').classList.toggle('hidden', isByShelf);
      document.getElementById('importNewShelfRow').classList.add('hidden');
      document.getElementById('importTargetRow').classList.toggle('hidden', isByShelf);
      if (!isByShelf) await Importer.resetTargetUI(true);
      await Importer.refreshTargetRowCount();
      Importer.renderImportPreview();
    });
  });

  // 导入分组货架预览切换
  document.getElementById('importGroupShelfSelect').addEventListener('change', function () {
    Importer.switchGroupShelf(this.value);
  });

  document.querySelectorAll('#importDirection .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#importDirection .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Importer.renderImportPreview();
    });
  });
  document.querySelectorAll('#importPolicy .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#importPolicy .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Importer.renderImportPreview();
    });
  });
  document.getElementById('importShelfSelect').addEventListener('change', async () => {
    await Importer.refreshTargetRowCount();
    Importer.renderImportPreview();
  });
  document.getElementById('importGroupShelfSelect').addEventListener('change', async () => {
    await Importer.refreshTargetRowCount();
    Importer.renderImportPreview();
  });
  document.getElementById('btnImportRowMinus').addEventListener('click', () => Importer.adjustImportRowCount(-1));
  document.getElementById('btnImportRowPlus').addEventListener('click', () => Importer.adjustImportRowCount(1));

  // 导入汇总
  document.getElementById('btnImportSummaryClose').addEventListener('click', Importer.closeSummary);
  document.getElementById('modalImportSummary').querySelector('.modal-backdrop')
    .addEventListener('click', Importer.closeSummary);

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

  // ---- 登录/注册 ----

  // Header 用户按钮
  document.getElementById('btnProfile').addEventListener('click', () => {
    if (Auth.isLoggedIn()) {
      doLogout();
    } else {
      showLogin();
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
    document.getElementById('modalLogin').classList.add('hidden');
    updateAuthUI();
    await Shelf.init();
    showToast('登录成功');
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
    await Auth.register(username, password);
    document.getElementById('modalRegister').classList.add('hidden');
    updateAuthUI();
    await Shelf.init();
    showToast('注册成功');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function doLogout() {
  Auth.logout();
  updateAuthUI();
  await Shelf.init();
  showToast('已退出登录，数据保留在本地');
}

function updateAuthUI() {
  const badge = document.getElementById('spaceBadge');
  const btn = document.getElementById('btnProfile');
  if (Auth.isLoggedIn()) {
    const user = Auth.getUser();
    badge.textContent = (user?.display_name || user?.username || '用户').slice(0, 6);
    btn.textContent = '🚪';
    btn.title = '退出登录';
  } else {
    badge.textContent = '本地';
    btn.textContent = '👤';
    btn.title = '登录';
  }
}

// ===== 初始化 =====
async function init() {
  bindEvents();
  await DB.open();
  await Auth.init();
  await Shelf.init();
  updateAuthUI();

  // 如果初始化期间用户已切换到货架视图，补一次渲染
  if (document.getElementById('viewShelf').classList.contains('active')) {
    Shelf.render();
  }

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.warn('SW 注册失败:', e);
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
