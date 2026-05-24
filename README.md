# 货架管理 — OCR 零件管理系统

本地化 OCR 货架管理系统，纯前端 PWA，无需后端服务器。通过摄像头拍照 + OCR 识别零件编号，存入货架网格进行可视化管理。

## 快速开始

1. 用浏览器打开 `index.html`（需通过 HTTP 服务器运行，以启用 PWA 和 Service Worker）
2. 点击「扫描」拍照识别零件编号
3. 选择货架位置存入
4. 在「货架」标签页查看和管理所有零件

```bash
# 本地启动
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

## 项目结构

```
├── index.html          # 入口页面
├── manifest.json       # PWA 配置
├── sw.js               # Service Worker
├── AGENTS.md           # AI 协作规范
├── README.md           # 项目说明
├── src/                # 源代码
│   ├── css/style.css   # iOS 风格样式
│   ├── js/             # JS 模块
│   └── icons/          # PWA 图标
├── docs/               # 产品文档
├── assets/             # 设计素材 / 测试截图 / 参考图
└── notes/              # 学习笔记
```

## 技术栈

- **OCR**: Tesseract.js v5
- **存储**: IndexedDB
- **导出**: SheetJS
- **UI**: 原生 HTML/CSS/JS，iOS 风格
