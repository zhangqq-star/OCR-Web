# 模块架构

需要了解架构时按需阅读本文件。

## 前端模块 (src/js/)

| 模块 | 文件 | 职责 |
|------|------|------|
| app | app.js | 主控制器：事件绑定、Tab 切换、OCR 流程、位置选择、连续导入状态机（batchState）、DataStore 抽象层 |
| Auth | auth.js | 本地认证：Web Crypto PBKDF2 + localStorage 会话 |
| API | api.js | HTTP 封装：Bearer token 注入、15s 超时、离线检测、401 自动登出、离线队列 |
| DB | db.js | SQL.js + OPFS，Schema: users / shelves / parts / sync_queue |
| OCR | ocr.js | 图像预处理（灰度→高斯模糊→Sauvola 二值化→中值去噪）+ 多模式识别 + 编号混淆修正 |
| Shelf | shelf.js | 4×8 网格渲染、多货架切换、长按移动/交换，暴露 getRows/getCols/getActiveShelfId |
| Camera | camera.js | MediaDevices API，后置优先（facingMode: 'environment'），最高 1080p |
| Export | export.js | SheetJS 生成 .xlsx，字段：序号/编号/名称/规格/数量/行列/备注 |

### 关键模式
- **DataStore**: app.js 中 DataStore 对象封装所有 DB 操作，上层不直接调 DB
- **Auth 双模式**: 本地 Web Crypto PBKDF2（salt:hash 存本地 SQLite），在线通过 api.js 调后端 JWT
- **离线队列**: 写操作断网时入 sync_queue 表，恢复后 flushQueue() 顺序重放，冲突(409)丢弃
- **货架渲染**: 行列 0-based 存储，UI 展示 +1
- **连续导入**: batchState 状态机，方向（先行后列/先列后行），策略（跳过/覆盖/遇占用停止）

## 后端 (server/)

Express + sql.js（内存运行 + 脏标记 5s 持久化），无 ORM。

### 路由结构
- `/api/auth/*` — 注册/登录/个人信息（bcryptjs + JWT 7 天）
- `/api/personal/*` — 个人空间货架+零件 CRUD（requireAuth，自动匹配用户 owned team）
- `/api/*` — 未匹配返回 JSON 404
- 其他 — SPA 回退到 index.html

### 中间件
- `requireAuth` — Bearer token 必选验证，无/过期返回 401
- `softAuth` — 可选验证，有 token 就解析，没有也放行

### 数据层 (server/src/db.js)
- 方法: run / get / all / lastInsertRowid / transaction
- Schema: users / teams / team_members / shelves / parts / operation_logs
- 注册时事务创建: user → personal team (owner) → 默认货架
- 写操作自动标记 dirty，每 5 秒 + 进程退出时写文件

### 配置 (server/src/config.js)
PORT(3000) / JWT_SECRET / JWT_EXPIRES_IN(7d) / DB_PATH / STATIC_ROOT，均支持环境变量覆盖
