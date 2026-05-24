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
5. **README 同步**: **每次修改项目内容（版本号、功能、技术栈、文件结构等），必须同步更新 `README.md`**。README.md 是本项目的"易变内容"集中地，CLAUDE.md 仅保留稳定的协作规范。

## 编码约定

- **IIFE 模块**：所有 JS 模块用 `const Module = (() => { ... return {...}; })()` 模式，通过全局变量通信
- **无构建工具**：所有脚本通过 `<script>` 标签加载，不引入 npm / webpack
- **CSS 变量**：主题色定义在 `:root` 中（`--accent`, `--bg-primary`, `--text-primary` 等）
- **货架位置**：行列从 0 开始存储，UI 展示时 +1
- **零件编号**：固定 10 位数字，输入框限制 `maxlength="10"` + `pattern="\d{10}"`

## 模块架构速览

**app.js** — 主控制器：事件绑定、Tab 切换、OCR 流程、位置选择、连续导入状态机（batchState）
**db.js** — 数据层：SQL.js + OPFS，Schema 含 shelves + parts 两表，外键 CASCADE
**ocr.js** — 识别引擎：图像预处理流水线 + 多模式识别 + 10 位编号提取与混淆修正
**shelf.js** — 货架 UI：4×8 网格渲染、多货架切换、长按移动/交换、暴露 getRows/getCols/getActiveShelfId
**camera.js** — 摄像头：MediaDevices API，后置优先（facingMode: 'environment'），最高 1080p
**export.js** — 导出：SheetJS 生成 .xlsx，字段含序号/编号/名称/规格/数量/行列/备注

## 修改注意事项

- CDN 资源（Tesseract.js、SQL.js、SheetJS）在 `index.html` 中以 `<script>` 标签引入，不可移除
- CSS 修改集中在 `src/css/style.css`，HTML 结构尽量不动
- SQLite Schema 变更需在 `db.js` 的 `createSchema()` 中使用 `ALTER TABLE` 或版本化迁移
- Service Worker 缓存版本号在 `sw.js` 顶部 `CACHE_NAME`，更新缓存内容时需同步更新版本号
- 货架网格宽度由 `min-width: 640px` 保证 8 列不挤压，窄屏可水平滚动
- **任何影响 README.md 内容的变更（版本号、功能增删、技术栈调整、文件结构变化），都必须同步更新 README.md**
