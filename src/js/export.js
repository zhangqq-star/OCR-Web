/**
 * Excel 导出模块 — SheetJS 生成 .xlsx 并下载
 */
const Exporter = (() => {
  async function exportToExcel() {
    let parts;
    if (typeof Shelf !== 'undefined' && Shelf.getActiveShelfId) {
      if (typeof DataStore !== 'undefined') {
        parts = await DataStore.getByShelf(Shelf.getActiveShelfId());
      } else {
        parts = await DB.getByShelf(Shelf.getActiveShelfId());
      }
    } else {
      parts = await DB.getAll();
    }

    if (parts.length === 0) {
      showToast('当前货架暂无数据可导出');
      return;
    }

    const shelfName = typeof Shelf !== 'undefined' && Shelf.getActiveShelfName
      ? Shelf.getActiveShelfName() : '';
    const data = parts.map((p, i) => ({
      '序号': i + 1,
      '编号': p.code || '',
      '名称': p.name || '',
      '规格': p.specs || '',
      '数量': p.quantity || 0,
      '货架': shelfName,
      '货架行': (p.shelfRow ?? 0) + 1,
      '货架列': (p.shelfCol ?? 0) + 1,
      '备注': p.note || '',
    }));

    const ws = XLSX.utils.json_to_sheet(data);

    ws['!cols'] = [
      { wch: 6 },
      { wch: 14 },
      { wch: 18 },
      { wch: 16 },
      { wch: 8 },
      { wch: 12 },
      { wch: 8 },
      { wch: 8 },
      { wch: 24 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '货架清单');

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    XLSX.writeFile(wb, `货架清单_${dateStr}.xlsx`);
    showToast('导出成功');
  }

  return { exportToExcel };
})();
