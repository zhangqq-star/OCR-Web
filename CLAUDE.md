# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

需要了解模块架构时，阅读 [docs/architecture.md](docs/architecture.md)。

## 目录用途
- **docs/** — 新功能前先读此处的 PRD 和迭代记录
- **src/** — 所有逻辑实现和组件
- **assets/** — UI 风格参考和设计素材
- **notes/** — 已解决问题的记录，遇到报错先检索此处

## 开发准则
1. **文档优先**: 新功能先在 docs/ 写说明文档，确认后再写代码
2. **文档同步**: 重大功能迭代或逻辑变更，同步更新 docs/ 下记录
3. **模块化**: src/ 保持独立，不引用项目根目录外的临时文件
4. **简洁至上**: 优先本地化方案，不引入重型外部依赖
5. **README 同步**: 修改版本号、功能、技术栈、文件结构等，必须同步更新 README.md

## 编码约定
- **IIFE 模块**: `const Module = (() => { ... return {...}; })()`，全局变量通信
- **无构建工具**: `<script>` 标签加载，不引入 npm/webpack
- **CSS 变量**: 主题色在 `:root`（--accent, --bg-primary, --text-primary 等）
- **货架位置**: 行列从 0 存储，UI 展示 +1
- **零件编号**: 固定 10 位数字，`maxlength="10"` + `pattern="\d{10}"`

## 修改注意事项
- CDN 资源（Tesseract.js、SQL.js、SheetJS）在 index.html 以 `<script>` 引入，不可移除
- CSS 集中在 src/css/style.css，HTML 结构尽量不动
- SQLite Schema 变更在 db.js 的 createSchema() 中用 ALTER TABLE 或版本化迁移
- Service Worker 缓存版本号在 sw.js 顶部 CACHE_NAME，`/api/` 路径不缓存
- 货架网格 min-width: 640px 保证 8 列不挤压，窄屏可水平滚动
- 影响 README.md 的变更必须同步更新 README.md
