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

// ===== Tab 切换 =====
function switchTab(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  document.querySelector(`[data-view="${viewId}"]`).classList.add('active');

  if (viewId === 'viewShelf') {
    Shelf.render();
  } else {
    if (!Camera.isActive()) {
      resetScanUI();
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

  if (codes.length > 0) {
    html += `<div style="margin-bottom:8px; padding:8px; background:rgba(108,140,255,0.2); border-radius:8px; text-align:center;">`;
    html += `<div style="font-size:0.7rem; color:var(--accent); margin-bottom:4px;">已提取零件编号</div>`;
    html += codes.map(c => `<div style="font-size:1.1rem; font-weight:700; letter-spacing:2px; color:#fff; font-variant-numeric:tabular-nums;">${escapeHtml(c)}</div>`).join('');
    html += `</div>`;
  }

  html += `<div style="margin-bottom:4px; font-size:0.75rem; color:var(--accent); font-weight:600;">▼ OCR 原始输出</div>`;
  html += `<div style="padding:10px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); border-radius:8px; font-size:0.85rem; line-height:1.6; white-space:pre-wrap; word-break:break-all;">${raw ? escapeHtml(raw) : '<span style="opacity:0.4;">(空)</span>'}</div>`;

  content.innerHTML = html;

  pendingOcrResult = { raw: result.raw, codes, confidence: result.confidence };
  el.classList.remove('hidden');

  if (codes.length > 0) {
    setTimeout(() => openPositionPicker(), 400);
  }
}

function doOcrConfirm() {
  if (!pendingOcrResult) {
    showToast('没有可保存的识别结果');
    return;
  }
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
  const parts = await DB.getByShelf(shelfId);
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

  await DB.add({
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
}

// ===== 初始化 =====
async function init() {
  bindEvents();
  await DB.open();
  await Shelf.init();

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.warn('SW 注册失败:', e);
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
