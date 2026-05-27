# 模块架构

需要了解架构时按需阅读本文件。

## 前端模块 (src/js/)

| 模块 | 文件 | 职责 |
|------|------|------|
| app | app.js | 主控制器：事件绑定、Tab 切换、OCR 流程、位置选择、连续导入状态机（batchState）、DataStore 抽象层 |
| Auth | auth.js | 本地认证：Web Crypto PBKDF2 + localStorage 会话 |
| DB | db.js | SQL.js + OPFS，Schema: users / shelves / parts |
| OCR | ocr.js | 图像预处理（灰度→高斯模糊→Sauvola 二值化→中值去噪）+ 多模式识别 + 编号混淆修正 |
| Shelf | shelf.js | 4×8 网格渲染、多货架切换、长按移动/交换，暴露 getRows/getCols/getActiveShelfId |
| Camera | camera.js | MediaDevices API，后置优先（facingMode: 'environment'），最高 1080p |
| Export | export.js | SheetJS 生成 .xlsx，字段：序号/编号/名称/规格/数量/行列/备注 |
| Import | import.js | Excel 导入：SheetJS 解析、分组/单货架导入、位置预览、覆盖策略 |

### 关键模式
- **DataStore**: app.js 中 DataStore 对象封装所有 DB 操作，上层不直接调 DB
- **Auth**: 本地 Web Crypto PBKDF2（salt:hash 存本地 SQLite）
- **货架渲染**: 行列 0-based 存储，UI 展示 +1
- **连续导入**: batchState 状态机，方向（先行后列/先列后行），策略（跳过/覆盖/遇占用停止）

