# 数镜

轻量级跨平台数据库桌面客户端,主打**低资源占用**和**快速启动**(冷启动约 1s,安装包 ~9MB)。Tauri 2(系统 WebView,不打包 Chromium)+ Vue 3 + Rust,macOS 原生质感,暗/亮双主题。

## 功能总览

### 连接与多库浏览
- **多数据库**:SQLite / MySQL / PostgreSQL / Redis,统一界面与方言处理
- **多库树**:不填默认库也能连——展开即浏览服务器上全部数据库(表/视图/程序对象分组),库级/表级右键均为**局部刷新**(刷库只刷库、刷表只刷表)
- **库上下文自动跟随**:切换库自动 `USE`/`SET search_path`,应用记住每个连接最近使用的库,重启回到原位;查询历史条目携带 `[库名]`,点击自动切回该库执行
- **连接池 + 断线自愈**:MySQL 走连接池(1-8 连接),慢查询不再阻塞其他标签页;空闲超时/网络中断自动重连并恢复会话库,全程无感
- Redis:键空间浏览(db0-15)、SCAN 分页、五类型+Stream 详情、TTL 编辑、命令行模式、大/热键分析

### 数据浏览与编辑
- 分页浏览、点表头排序、列宽拖拽(按表记忆)、列固定/隐藏、紧凑/舒适行高
- **筛选栏**:字段模式(列+运算符)与自由模式(WHERE 片段),多条件 AND;结果内二次筛选/排序不重查库
- **单元格编辑回写**:双击改值、Tab 导航、⌥↵ 多行编辑、快速添加/弹窗添加(表单/CSV/JSON)、勾选批量删除/复制 INSERT,统一"保存更改"按主键生成 UPDATE/DELETE/INSERT
- **同列多行批量编辑**(Excel 式):按住拖拽 / ⌘点选 / ⇧范围选 → 直接输入,所有选中行实时预览 → 回车自动保存落库
- 列头悬停显示数据库列注释;⌘F 结果内搜索
- **查询结果也可编辑**:识别单表 SELECT(支持注释/限定名),按主键回写
- **全局数据搜索**(⌘⇧F):跨全部表全部列找关键词,点击命中直达

### SQL 工作台
- CodeMirror 6:语法高亮、表/列名补全、方言感知;⌘↵ 运行(选区优先)、⌘/ 注释、格式化
- **EXPLAIN 执行计划**、SQL 优化建议(索引/写法诊断)
- **查询参数变量**:`:name` 占位符,运行时弹窗填值
- 查询历史(带库上下文)/ SQL 片段;多结果集切换;标签按 FROM 表名自动命名
- 复制为 CSV / TSV / JSON / Markdown / INSERT;导出 XLSX / CSV 文件、整表 SQL 转储;文件名统一(清洗 + 时间戳,重复导出不覆盖)

### 结构与数据迁移
- **可视化建表/改表设计器**:列编辑 + 实时 DDL 预览(MySQL / PG / SQLite 方言)
- 结构查看:字段 / 索引 / DDL;索引与外键管理;对象 DDL(触发器/函数/过程)查看与执行
- 表级导出 CSV / Excel / SQL(结构或结构+数据)、库级 SQL 导出;CSV/Excel 导入(类型推断建表或追加)
- 表统计信息、OPTIMIZE / ANALYZE 维护、重命名 / 清空 / 删除 / 复制表
- ER 图:外键自动布局,拖拽 / 缩放 / 适配

### 界面与效率
- ⌘P 快速查询:找表、`表名 关键词` 直达筛选、直接跑 SQL
- 会话记忆:重启恢复全部标签页(SQL / 页码 / 筛选 / 设计器状态 / 各连接当前库)
- 侧栏宽度可拖动、支持横向滚动;暗/亮主题(可跟随系统)

## 快捷键

| 键 | 功能 |
|---|---|
| ⌘↵ | 运行(选中部分优先) |
| ⌘/ | 注释切换 |
| ⌘P | 快速查询 |
| ⌘⇧F | 全局数据搜索 |
| ⌘F | 结果内搜索 |
| ⌥↵ | 单元格多行编辑 |
| ⌘T / ⌘W | 新建 / 关闭标签(中键可关) |
| F5 | 刷新当前表 / 重跑查询 |

## 开发

```bash
npm install
npm run tauri dev      # 开发模式
npm run tauri build    # 打包 dmg / msi / AppImage
cargo test             # 后端测试(真 SQLite 全链路)
npm run test           # 前端 vitest(共 66:Rust 11 + 前端 55)
```

纯前端预览(无需 Rust):`npm run dev` 后访问 http://localhost:1420 —— 内置 mock 数据层,全部 UI 可交互。

要求:Node 18+、Rust 1.75+。

## 架构

```
src/                    前端 (Vue 3 + TS + Naive UI + Pinia)
  components/           面板组件(查询/表数据/结构/设计器/ER/DDL/Redis/全局搜索…)
  composables/          useVirtualScroll / useColumnLayout / useCellEditing / useContextMenus
  panes/registry.ts     Pane Registry:标签类型注册表(懒加载 + 会话序列化)
  stores/               app.ts(主状态)+ tableActions.ts(表数据操作)+ helpers.ts
  filename.ts           导出文件名统一生成
src-tauri/src/
  backend.rs            连接建立(MySQL 连接池)、服务器信息
  exec.rs               SQL 执行、多结果集(BEGIN-END 感知语句拆分器)
  schema.rs             库/表/结构/索引/外键/对象 DDL(会话库自动解析)
  edits.rs              编辑回写(UPDATE/DELETE/INSERT 生成)
  search.rs             全局数据搜索
  store.rs              连接配置持久化
  lib.rs                命令注册、断线自动重连、集成测试
```

驱动:rusqlite(bundled)、mysql_async(rustls,连接池)、tokio-postgres(simple_query)。

## 扩展指南:新增一种标签页面板

面板走 **Pane Registry**(`src/panes/registry.ts`),三步接入:

1. **类型**:`types.ts` 的 `Tab` 联合加新 kind + 数据接口
2. **组件**:写 `XxxPane.vue`(接收 `props: { tab: XxxTab }`),注册表用 `defineAsyncComponent` 懒加载
3. **注册**:`PANE_DEFS` 添加 `{ kind, icon, component, serialize, revive }`

标签分发、图标、会话保存/恢复**自动生效**。现有 8 种面板全部走此机制,可作参考模板。

## 已知限制

- 密码明文存储于应用配置目录(路线图:系统密钥库)
- 连接池目前仅 MySQL;PG 仍为单连接
- SQLite 不支持修改已有列(引擎限制,设计器会明确提示)
- 全局搜索为逐表扫描,大库耗时(上限 50 命中)
- SSH 隧道未实现

## 路线图

SSH 隧道 · 查询取消 · 数据传输/同步 · 超宽表列虚拟滚动 · Windows/Linux 打包
