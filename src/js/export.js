/**
 * Excel 导出模块 — SheetJS 生成 .xlsx 并下载
 */
const Exporter = (() => {
  let selectedShelfId = null;
  let currentRange = 'current';

  function buildSheet(data) {
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 14 },
      { wch: 18 },
      { wch: 16 },
      { wch: 8 },
      { wch: 8 },
      { wch: 8 },
      { wch: 24 },
    ];
    return ws;
  }

  function getDateStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }

  function partsToData(parts) {
    return parts.map((p, i) => ({
      '序号': i + 1,
      '编号': p.code || '',
      '名称': p.name || '',
      '规格': p.specs || '',
      '数量': p.quantity || 0,
      '货架行': (p.shelfRow ?? 0) + 1,
      '货架列': (p.shelfCol ?? 0) + 1,
      '备注': p.note || '',
    }));
  }

  async function exportShelfById(shelfId, shelfName) {
    const parts = await DB.getByShelf(shelfId);
    if (parts.length === 0) {
      showToast('该货架暂无数据可导出');
      return;
    }
    const data = partsToData(parts);
    const ws = buildSheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '货架清单');
    XLSX.writeFile(wb, `${shelfName}_${getDateStr()}.xlsx`);
    showToast('导出成功');
  }

  async function exportAllShelves() {
    const shelves = await DB.getAllShelves(Auth.getOwnerId());
    if (shelves.length === 0) {
      showToast('暂无货架数据可导出');
      return;
    }

    const wb = XLSX.utils.book_new();
    let totalParts = 0;

    for (const shelf of shelves) {
      const parts = await DB.getByShelf(shelf.id);
      if (parts.length === 0) continue;
      totalParts += parts.length;
      const data = partsToData(parts);
      const ws = buildSheet(data);
      const sheetName = shelf.name.length > 31 ? shelf.name.substring(0, 31) : shelf.name;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    if (totalParts === 0) {
      showToast('所有货架均无数据可导出');
      return;
    }

    XLSX.writeFile(wb, `全部货架清单_${getDateStr()}.xlsx`);
    showToast(`导出成功，共 ${shelves.length} 个货架，${totalParts} 个零件`);
  }

  async function openExportModal() {
    const shelves = await DB.getAllShelves(Auth.getOwnerId());
    selectedShelfId = Shelf.getActiveShelfId();
    currentRange = 'current';

    // 重置分段控件
    const ctrl = document.querySelector('#exportRange');
    const btns = ctrl.querySelectorAll('.seg-btn');
    btns.forEach((b, i) => b.classList.toggle('active', i === 0));
    ctrl.setAttribute('data-active', '1');
    document.getElementById('exportShelfRow').classList.add('hidden');

    // 渲染货架列表
    const list = document.getElementById('exportShelfList');
    list.innerHTML = shelves.map(s =>
      `<div class="export-shelf-item${s.id === selectedShelfId ? ' selected' : ''}" data-shelf-id="${s.id}">
        <span class="radio-dot"></span>
        <span>${escapeHtml(s.name)}</span>
      </div>`
    ).join('');

    list.querySelectorAll('.export-shelf-item').forEach(item => {
      item.addEventListener('click', () => {
        list.querySelectorAll('.export-shelf-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedShelfId = parseInt(item.dataset.shelfId);
      });
    });

    // 绑定分段控件事件
    btns.forEach((btn, i) => {
      btn.onclick = () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        ctrl.setAttribute('data-active', i + 1);
        currentRange = btn.dataset.range;
        document.getElementById('exportShelfRow').classList.toggle('hidden', currentRange !== 'select');
      };
    });

    document.getElementById('modalExport').classList.remove('hidden');
  }

  function closeExportModal() {
    document.getElementById('modalExport').classList.add('hidden');
  }

  async function doExport() {
    closeExportModal();

    if (currentRange === 'current') {
      const shelfId = Shelf.getActiveShelfId();
      const shelfName = Shelf.getActiveShelfName();
      await exportShelfById(shelfId, shelfName);
    } else if (currentRange === 'all') {
      await exportAllShelves();
    } else {
      if (!selectedShelfId) {
        showToast('请选择一个货架');
        return;
      }
      const list = document.getElementById('exportShelfList');
      const item = list.querySelector(`[data-shelf-id="${selectedShelfId}"]`);
      const shelfName = item ? item.querySelector('span:last-child').textContent : '';
      await exportShelfById(selectedShelfId, shelfName);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { openExportModal, closeExportModal, doExport };
})();
