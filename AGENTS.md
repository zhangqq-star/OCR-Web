# AI 开发协作规范

## 目录用途指南
- **docs/**: AI 在开始新功能前，应优先阅读此处的 PRD 和迭代记录。
- **src/**: 所有的逻辑实现、组件编写均在此目录下。
- **assets/**: 当 AI 需要参考 UI 风格或排查 Bug 时，查看对应的子目录。
- **notes/**: 记录了已解决的特定问题，AI 在遇到类似报错时应先检索此处。

## 开发准则
1. **模块化原则**: 代码区（src）应保持独立，尽量不引用项目根目录外的临时文件。
2. **文档同步**: 每次重大功能迭代或逻辑变更，需同步更新 `docs/` 下的相关记录。
3. **资源引用**: UI 样式应参考 `assets/design/` 中的视觉要求，特别是毛玻璃特效的参数设置。
4. **简洁至上**: 优先使用本地化方案，避免引入不必要的外部重型依赖。

## AI 入职说明

### 项目概述

本地化 OCR 货架管理系统 v1.2，纯前端 PWA，无后端、无构建工具、无 npm 依赖。通过摄像头拍照 + Tesseract.js OCR 识别 10 位零件编号，存入货架网格进行可视化管理。数据存储在浏览器 SQLite 中（SQL.js + WASM，OPFS 持久化）。

### 技术栈

| 层 | 技术 |
|---|------|
| OCR | Tesseract.js v5（CDN） |
| 存储 | SQLite（SQL.js + WASM，OPFS / localStorage 持久化） |
| 导出 | SheetJS xlsx v0.18（CDN） |
| 离线 | Service Worker + Web App Manifest |
| UI | 原生 HTML/CSS/JS，iOS 风格 |
| 运行时 | 纯浏览器端，零依赖 |

### 文件结构

```
├── index.html          # 入口，所有 UI 结构
├── manifest.json       # PWA 配置
├── sw.js               # Service Worker 缓存策略
├── src/
│   ├── css/style.css   # 全部样式（iOS 风格）
│   ├── js/
│   │   ├── app.js      # 主入口：事件绑定、Tab 切换、OCR 流程、位置选择
│   │   ├── db.js       # SQLite 封装（SQL.js + OPFS，parts + shelves CRUD）
│   │   ├── ocr.js      # Tesseract 识别：图像预处理 + 多模式识别
│   │   ├── camera.js   # 摄像头：MediaDevices 封装
│   │   ├── shelf.js    # 货架模块：渲染网格、多货架切换、长按移动
│   │   └── export.js   # Excel 导出（SheetJS）
│   └── icons/          # PWA 图标
├── docs/               # 产品文档
├── assets/             # 设计素材 / 测试截图 / 参考图
└── notes/              # 学习笔记
```

### 核心模块职责

**app.js** — 主控制器
- 全局 `showToast(msg)` 提示
- `switchTab(viewId)` Tab 切换（`viewScan` / `viewShelf`）
- 摄像头生命周期：`startCamera()` → `doCapture()` → OCR 识别 → 位置选择
- OCR 结果展示、确认存入 / 重试
- 位置选择弹窗：读取 `Shelf.getCols()` / `Shelf.getRows()` 生成网格
- `confirmPosition()` 将零件写入 DB

**db.js** — 数据层（SQLite）
- `DB.open()` 加载 SQL.js WASM，从 OPFS 恢复数据库，首次运行自动建表
- 写操作后防抖 300ms 自动写回 OPFS（回退 localStorage）
- Shelves: `createShelf`, `getAllShelves`, `updateShelf`, `deleteShelf`
- Parts: `add`, `update`, `remove`, `get`, `getByPosition`, `getByShelf`, `getAll`
- `deleteShelf` 级联删除关联 parts（外键 CASCADE）
- Schema：shelves(id, name, createdAt) + parts(id, name, code, specs, quantity, note, shelfRow, shelfCol, shelfId, createdAt, updatedAt)

**ocr.js** — 识别引擎
- `preprocess(imageData)` — Canvas 图像预处理流水线：
  1. 灰度化（自适应通道权重：检测黄/红背景）
  2. 高斯模糊（可分离卷积）
  3. Sauvola 自适应二值化
  4. 中值去噪
- `recognize(imageData)` — 主入口，多模式识别：
  1. 预处理图 → 中英文混合识别
  2. 无结果 → 数字白名单模式（仅 0-9）
  3. 预处理无文本 → 原图回退
- `extractCode(text)` — 提取 10 位编号，修正常见 OCR 混淆（O→0, I→1, S→5, Z→2, B→8）

**shelf.js** — 货架 UI
- 固定 **4 行 × 8 列** 网格
- `render()` 渲染当前货架：从 DB 读取 parts → 按位置填充网格
- 点击空格子 → 手动添加；点击已占用 → 打开详情
- 长按 500ms → 进入移动模式（drop-target / swap-target）
- 多货架：创建、重命名、删除、左右切换（带滑动动画）
- 导航栏触摸滑动支持

**camera.js** — 摄像头
- 标准 MediaDevices API，后置摄像头优先（`facingMode: 'environment'`）
- 最高 1080p 分辨率

**export.js** — 导出
- `exportToExcel()` 导出当前货架数据为 `.xlsx`
- 字段：序号、编号、名称、规格、数量、货架行、货架列、备注

### 编码约定

- **IIFE 模块**：所有 JS 模块用 `const Module = (() => { ... return {...}; })()` 模式，通过全局变量通信
- **无构建工具**：所有脚本通过 `<script>` 标签加载，不引入 npm / webpack
- **CSS 变量**：主题色定义在 `:root` 中（`--accent`, `--bg-primary`, `--text-primary` 等）
- **货架位置**：行列从 0 开始存储，UI 展示时 +1
- **零件编号**：固定 10 位数字，输入框限制 `maxlength="10"` + `pattern="\d{10}"`

### 修改注意事项

- CDN 资源（Tesseract.js、SheetJS）在 `index.html` 中以 `<script>` 标签引入，不可移除
- CSS 修改集中在 `src/css/style.css`，HTML 结构尽量不动
- SQLite Schema 变更需在 `db.js` 的 `createSchema()` 中使用 `ALTER TABLE` 或版本化迁移
- Service Worker 缓存版本号在 `sw.js` 顶部 `CACHE_NAME`，更新缓存内容时需同步更新版本号
- 货架网格宽度由 `min-width: 640px` 保证 8 列不挤压，窄屏可水平滚动

### 产品形态演进路线

| 版本 | 阶段 | 核心能力 |
|------|------|---------|
| v1.0 | 基础 OCR | 拍照识别 + IndexedDB 存储 |
| v1.2 | 货架管理 | 4×8 网格、多货架、长按移动、Excel 导出、PWA |
| v1.3 | 识别增强 | 批量扫描、条码识别、模板匹配、搜索筛选、撤销 |
| v1.4 | 协作同步 | 局域网同步、Excel 导入、数据备份、标签打印 |
| v2.0 | 云端化 | 后端 + 账号 + 团队空间 + 权限 + 操作日志 |
| v2.5 | 智能化 | 库存预警、存取分析、语音录入、AI 辅助识别 |
| v3.0 | 硬件集成 | 蓝牙扫码枪、RFID、电子货架标签、IoT 传感器 |
