/**
 * 货架模块 — 多货架渲染(固定8列)、滑动切换、长按移动/交换
 */
const Shelf = (() => {
  const ROWS = 4;
  const COLS = 8;

  let activeShelfId = null;
  let shelves = [];

  // 滑动切换
  let swipeStartX = 0, swipeStartY = 0, swipeMoved = false;

  // 长按移动
  let movePart = null;
  let longPressTimer = null;
  let longPressStartX = 0, longPressStartY = 0;
  let ignoreClickUntil = 0;

  function getCols() { return COLS; }
  function getActiveShelfId() { return activeShelfId; }

  // ---- 初始化 ----

  async function init() {
    shelves = await DB.getAllShelves();
    if (shelves.length === 0) {
      const id = await DB.createShelf('货架 1');
      await DB.migratePartsToShelf(id);
      shelves = await DB.getAllShelves();
    }
    const savedId = localStorage.getItem('activeShelfId');
    if (savedId && shelves.find(s => s.id === Number(savedId))) {
      activeShelfId = Number(savedId);
    } else if (shelves.length > 0) {
      activeShelfId = shelves[0].id;
    }
    return activeShelfId;
  }

  // ---- 货架管理 ----

  async function createShelf() {
    const name = prompt('请输入货架名称：', `货架 ${shelves.length + 1}`);
    if (!name || !name.trim()) return;
    await DB.createShelf(name.trim());
    shelves = await DB.getAllShelves();
    if (shelves.length > 0) await switchTo(shelves[shelves.length - 1].id);
    await render();
  }

  async function renameCurrent() {
    const current = shelves.find(s => s.id === activeShelfId);
    if (!current) return;
    const name = prompt('重命名货架：', current.name);
    if (!name || !name.trim() || name.trim() === current.name) return;
    await DB.updateShelf(activeShelfId, name.trim());
    shelves = await DataStore.getAllShelves();
    render();
  }

  async function deleteCurrent() {
    if (shelves.length <= 1) {
      showToast('至少保留一个货架');
      return;
    }
    const parts = await DataStore.getByShelf(activeShelfId);
    const msg = parts.length > 0
      ? `该货架有 ${parts.length} 个零件，删除货架将同时删除所有零件，确定吗？`
      : '确定要删除该货架吗？';
    if (!confirm(msg)) return;
    await DB.deleteShelf(activeShelfId);
    shelves = await DB.getAllShelves();
    activeShelfId = shelves[0].id;
    localStorage.setItem('activeShelfId', activeShelfId);
    await render();
    showToast('货架已删除');
  }

  async function switchTo(id, direction) {
    if (id === activeShelfId) return;
    cancelMoveMode();
    const grid = document.getElementById('shelfGrid');
    if (direction) {
      grid.classList.add(direction === 'prev' ? 'swipe-right' : 'swipe-left');
      await new Promise(r => setTimeout(r, 200));
    }
    activeShelfId = id;
    localStorage.setItem('activeShelfId', id);
    await render();
    if (direction) {
      grid.classList.remove('swipe-right', 'swipe-left');
    }
  }

  async function switchToPrev() {
    const idx = shelves.findIndex(s => s.id === activeShelfId);
    if (idx > 0) await switchTo(shelves[idx - 1].id, 'prev');
  }

  async function switchToNext() {
    const idx = shelves.findIndex(s => s.id === activeShelfId);
    if (idx < shelves.length - 1) await switchTo(shelves[idx + 1].id, 'next');
  }

  function updateNavButtons() {
    const idx = shelves.findIndex(s => s.id === activeShelfId);
    document.getElementById('btnShelfPrev').disabled = idx <= 0;
    document.getElementById('btnShelfNext').disabled = idx >= shelves.length - 1;
    const current = shelves.find(s => s.id === activeShelfId);
    document.getElementById('shelfName').textContent = current ? current.name : '';
    document.getElementById('shelfIndicator').textContent = shelves.length > 1 ? `${idx + 1} / ${shelves.length}` : '';
  }

  function updateStats(count) {
    document.getElementById('shelfStats').textContent = `共 ${count} 个零件`;
  }

  // ---- 渲染 ----

  async function render() {
    cancelMoveMode();
    const grid = document.getElementById('shelfGrid');
    grid.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;

    const parts = await DataStore.getByShelf(activeShelfId);
    const byPos = {};
    parts.forEach(p => {
      if (p.shelfRow != null && p.shelfCol != null) {
        const k = `${p.shelfRow}_${p.shelfCol}`;
        if (!byPos[k]) byPos[k] = [];
        byPos[k].push(p);
      }
    });

    grid.innerHTML = '';

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const key = `${row}_${col}`;
        const partsAtPos = byPos[key];
        const part = partsAtPos ? partsAtPos[0] : null;

        const cell = document.createElement('div');
        cell.className = 'shelf-cell' + (part ? ' occupied' : ' empty');
        cell.dataset.row = row;
        cell.dataset.col = col;

        if (part) {
          cell.innerHTML =
            `<span class="cell-position">${row+1}-${col+1}</span>` +
            (part.code ? `<span class="cell-code" title="${escapeHtml(part.code)}">${escapeHtml(part.code)}</span>` : '') +
            (part.name ? `<span class="cell-name">${escapeHtml(part.name)}</span>` : '') +
            (part.quantity > 1 ? `<span class="cell-quantity">×${part.quantity}</span>` : '') +
            (partsAtPos.length > 1 ? `<span class="cell-quantity cell-dup-warn">×${partsAtPos.length}</span>` : '');

          cell.addEventListener('click', () => {
            if (Date.now() < ignoreClickUntil) return;
            if (movePart) {
              handleMoveClick(row, col, part);
            } else {
              openDetail(part);
            }
          });

          cell.addEventListener('pointerdown', (e) => {
            if (movePart) return;
            longPressStartX = e.clientX;
            longPressStartY = e.clientY;
            longPressTimer = setTimeout(() => enterMoveMode(part, row, col), 500);
          });

          cell.addEventListener('pointerup', () => {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          });

          cell.addEventListener('pointerleave', () => {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          });
        } else {
          cell.innerHTML = `<span class="cell-add">+</span>`;
          cell.addEventListener('click', () => {
            if (Date.now() < ignoreClickUntil) return;
            if (movePart) {
              handleMoveClick(row, col, null);
            } else {
              openAddForm(row, col);
            }
          });
        }

        grid.appendChild(cell);
      }
    }

    updateNavButtons();
    updateStats(parts.length);
    if (parts.length > Object.keys(byPos).length) {
      console.warn(`[Shelf] 检测到同一位置有多个零件：共 ${parts.length} 条记录，仅 ${Object.keys(byPos).length} 个不同位置`);
    }
  }

  // 全局 pointer 事件 —— 长按过程中移动则取消
  function onGlobalPointerMove(e) {
    if (!longPressTimer) return;
    const dx = e.clientX - longPressStartX;
    const dy = e.clientY - longPressStartY;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function onGlobalPointerUp() {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  // ---- 长按移动/交换 ----

  function enterMoveMode(part, row, col) {
    movePart = part;
    longPressTimer = null;
    ignoreClickUntil = Date.now() + 350;

    document.querySelectorAll('.shelf-cell.empty').forEach(c => c.classList.add('drop-target'));
    document.querySelectorAll('.shelf-cell.occupied').forEach(c => {
      if (Number(c.dataset.row) === row && Number(c.dataset.col) === col) {
        c.classList.add('moving');
      } else {
        c.classList.add('swap-target');
      }
    });

    setTimeout(() => {
      document.addEventListener('click', onDocumentClickDuringMove);
    }, 0);

    showToast('请点击目标位置（再次点击原位取消）');
  }

  function cancelMoveMode() {
    movePart = null;
    ignoreClickUntil = 0;
    document.removeEventListener('click', onDocumentClickDuringMove);
    document.querySelectorAll('.shelf-cell').forEach(c => {
      c.classList.remove('moving', 'drop-target', 'swap-target');
    });
  }

  function onDocumentClickDuringMove(e) {
    if (e.target.closest('.shelf-cell')) return;
    cancelMoveMode();
    showToast('已取消移动');
  }

  function handleMoveClick(targetRow, targetCol, targetPart) {
    if (!movePart) return;

    if (targetPart && targetPart.id === movePart.id) {
      cancelMoveMode();
      showToast('已取消移动');
      return;
    }

    const srcRow = movePart.shelfRow;
    const srcCol = movePart.shelfCol;

    if (targetPart) {
      swapParts(movePart, targetPart);
    } else {
      movePart.shelfRow = targetRow;
      movePart.shelfCol = targetCol;
      DB.update(movePart.id, movePart);
    }

    cancelMoveMode();
    render();
    showToast(targetPart ? '已交换位置' : '已移动');
  }

  function swapParts(a, b) {
    const rowA = a.shelfRow, colA = a.shelfCol;
    a.shelfRow = b.shelfRow; a.shelfCol = b.shelfCol;
    b.shelfRow = rowA; b.shelfCol = colA;
    DB.update(a.id, a);
    DB.update(b.id, b);
  }

  // ---- 零件详情 ----

  function openAddForm(row, col) {
    const modal = document.getElementById('modalDetail');
    document.getElementById('detailId').value = '';
    document.getElementById('detailCode').value = '';
    document.getElementById('detailName').value = '';
    document.getElementById('detailSpecs').value = '';
    document.getElementById('detailQuantity').value = '1';
    document.getElementById('detailNote').value = '';
    document.getElementById('detailPosition').textContent = `位置: ${row + 1} 行 ${col + 1} 列`;
    modal.dataset.row = row;
    modal.dataset.col = col;
    modal.classList.remove('hidden');
    document.getElementById('btnDetailDelete').classList.add('hidden');
    document.getElementById('detailName').focus();
  }

  function openDetail(part) {
    const modal = document.getElementById('modalDetail');
    document.getElementById('detailId').value = part.id;
    document.getElementById('detailCode').value = part.code || '';
    document.getElementById('detailName').value = part.name || '';
    document.getElementById('detailSpecs').value = part.specs || '';
    document.getElementById('detailQuantity').value = part.quantity || 1;
    document.getElementById('detailNote').value = part.note || '';
    document.getElementById('detailPosition').textContent =
      `位置: ${(part.shelfRow||0) + 1} 行 ${(part.shelfCol||0) + 1} 列`;
    modal.dataset.row = part.shelfRow;
    modal.dataset.col = part.shelfCol;
    modal.classList.remove('hidden');
    document.getElementById('btnDetailDelete').classList.remove('hidden');
  }

  function closeDetail() {
    document.getElementById('modalDetail').classList.add('hidden');
  }

  async function saveDetail(e) {
    e.preventDefault();
    const modal = document.getElementById('modalDetail');
    const id = document.getElementById('detailId').value;
    const code = document.getElementById('detailCode').value.trim();
    const name = document.getElementById('detailName').value.trim();
    if (!code && !name) return showToast('请输入编号或名称');

    const base = {
      name,
      code,
      specs: document.getElementById('detailSpecs').value.trim(),
      quantity: parseInt(document.getElementById('detailQuantity').value) || 1,
      note: document.getElementById('detailNote').value.trim(),
      shelfRow: parseInt(modal.dataset.row),
      shelfCol: parseInt(modal.dataset.col),
      shelfId: activeShelfId,
    };

    if (id) {
      const existing = await DataStore.get(Number(id));
      await DataStore.updatePart(Number(id), { ...existing, ...base });
    } else {
      const dup = await DataStore.getByPosition(base.shelfRow, base.shelfCol, activeShelfId);
      if (dup) { showToast('该位置已被占用'); return; }
      await DataStore.addPart(base);
    }

    closeDetail();
    await render();
    showToast(id ? '零件已更新' : '零件已添加');
  }

  async function deleteDetail() {
    const id = document.getElementById('detailId').value;
    if (!id) return;
    if (!confirm('确定要删除该零件吗？')) return;
    await DataStore.removePart(Number(id));
    closeDetail();
    await render();
    showToast('零件已删除');
  }

  // ---- 滑动切换货架（导航栏区域） ----

  function setupSwipe() {
    const nav = document.querySelector('.shelf-nav');
    if (!nav) return;

    nav.addEventListener('touchstart', (e) => {
      swipeStartX = e.touches[0].clientX;
      swipeStartY = e.touches[0].clientY;
      swipeMoved = false;
    }, { passive: true });

    nav.addEventListener('touchmove', (e) => {
      if (swipeMoved) return;
      const dx = e.touches[0].clientX - swipeStartX;
      const dy = e.touches[0].clientY - swipeStartY;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swipeMoved = true;
      }
    }, { passive: true });

    nav.addEventListener('touchend', (e) => {
      if (!swipeMoved) return;
      const dx = e.changedTouches[0].clientX - swipeStartX;
      if (Math.abs(dx) > 50) {
        if (dx > 0) switchToPrev();
        else switchToNext();
      }
    });
  }

  // ---- 工具 ----

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  document.addEventListener('pointermove', onGlobalPointerMove);
  document.addEventListener('pointerup', onGlobalPointerUp);

  return {
    init,
    render,
    getCols,
    getRows: () => ROWS,
    getActiveShelfId,
    createShelf,
    renameCurrent,
    deleteCurrent,
    switchTo,
    switchToPrev,
    switchToNext,
    openDetail,
    closeDetail,
    saveDetail,
    deleteDetail,
    setupSwipe,
  };
})();
