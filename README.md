# 数镜

轻量级跨平台数据库桌面客户端,主打低资源占用和快速启动。Tauri 2(系统 WebView,不打包 Chromium)+ Vue 3 + Rust,macOS 暗色原生质感。

## 功能总览

### 连接与对象
- **多数据库**:SQLite / MySQL / PostgreSQL / Redis,统一界面与方言处理
- **Redis**:键空间浏览(db0-15)、SCAN 分页、五类型+Stream 详情、TTL、编辑 STRING、删除、类型徽标、命令行模式
- **连接管理**:新建/编辑/测试/着色标识,配置持久化,启动自动重连
- **对象树**:表 / 视图 / 触发器 / 函数 / 存储过程分组,右键菜单,表名搜索框
- **ER 图**:外键关系自动布局(分层),节点拖拽 / 滚轮缩放 / 平移 / 一键适配

### 数据浏览与编辑
- 分页浏览(50~1000 行/页)、点表头排序、列宽拖拽
- **筛选栏**:列 + 运算符(= ≠ > < ≥ ≤ LIKE IS NULL)+ 值,多条件 AND
- **行选中右侧详情面板**(可拖宽):全字段纵览、未保存变更高亮、大文本/JSON 查看器(格式化/复制)
- **单元格编辑回写**:双击改值、Tab 横向导航、删行、快速添加(顶部)/弹窗添加(表单/CSV/JSON)、多选批量(删除/复制/INSERT),统一"保存更改"(UPDATE/DELETE/INSERT 按主键生成)
- **全局数据搜索**(⌘⇧F):跨全部表全部列找关键词,点击命中直达并自动筛选

### SQL 工作台
- CodeMirror 6:语法高亮(自定义 Tokyo Night 配色)、表名/列名自动补全、方言感知
- **⌘↵ 运行**(有选区只执行选中)、**⌘/ 注释切换**、格式化、**EXPLAIN 执行计划**
- 查询历史(自动)/ SQL 片段(收藏)、标签自动命名(FROM 表名)
- **多结果集**切换、**结果二次加工**(内存筛选/排序,不重查库)
- 复制/导出:CSV / TSV / JSON / Markdown,导出 CSV 文件、整表转储 SQL

### 结构与数据迁移
- **可视化建表/改表设计器**:列编辑 + 实时 SQL 预览,三库 DDL/ALTER 方言(MySQL MODIFY / PG ALTER TYPE / SQLite 仅加列)
- **列控制**:列宽拖拽(按表记忆)、显示列选择、固定列、值转换(时间戳→日期)
- **导入导出**:表级 CSV/Excel/SQL(结构/结构+数据)、库级 SQL 导出、SQL 文件导入;CSV/Excel 导入(新建/追加)
- **CSV 导入**:类型推断建表 or 追加到已有表(同名列自动映射)
- 表结构查看:字段 / 索引 / DDL;对象 DDL 查看(触发器/函数/过程)

### 便捷入口
- **⌘P 快速查询**:表名找表、`表名 关键词` 直达筛选、直接输 SQL 执行
- 会话记忆:重启自动恢复全部标签页(SQL 内容/页码/筛选/设计器状态)
- 窗口标题跟随标签、连接着色、数据库品牌色标识

## 快捷键

| 键 | 功能 |
|---|---|
| ⌘↵ | 运行(选中部分优先) |
| ⌘/ | 注释切换 |
| ⌘P | 快速查询(找表/筛数据/跑 SQL) |
| ⌘⇧F | 全局数据搜索 |
| ⌘T / ⌘W | 新建 / 关闭标签(中键也可关闭) |
| F5 | 刷新当前表 / 重跑查询 |

> 浏览器预览模式下 ⌘T/⌘W/⌘P/⌘⇧F 会被浏览器宿主拦截,点击界面入口即可;真窗口全部可用。

## 开发

```bash
npm install
npm run tauri dev      # 开发模式
npm run tauri build    # 打包 dmg / msi / AppImage
cargo test             # 后端集成测试(真 SQLite 全链路)
```

纯前端预览(无需 Rust):`npm run dev` 后访问 http://localhost:1420 —— 内置 mock 数据层,全部 UI 可交互。

要求:Node 18+、Rust 1.75+。

## 架构

```
src/                    前端 (Vue 3 + TS + Naive UI + Pinia)
  components/           面板组件(查询/表数据/结构/设计器/ER/快速查询/全局搜索…)
  stores/app.ts         全局状态:连接、标签页体系、编辑回写、会话持久化
  csv.ts                CSV 解析/类型推断
src-tauri/src/
  backend.rs            三库连接建立 / 服务器信息
  exec.rs               SQL 执行、多结果集(语句安全拆分器)、值格式化
  schema.rs             表结构 / 索引 / 外键 / 对象 DDL
  search.rs             全局数据搜索
  edits.rs              编辑回写(UPDATE/DELETE/INSERT 生成)
  store.rs              连接配置持久化
  lib.rs                命令注册 + 集成测试
```

驱动:rusqlite(bundled)、mysql_async(rustls)、tokio-postgres(text 协议,天然返回多结果集)。

## 扩展指南:新增一种标签页面板

面板走 **Pane Registry**(`src/panes/registry.ts`),三步接入:

1. **类型**:`types.ts` 的 `Tab` 联合加新 kind + 数据接口(运行时字段如 loading/error 记得给默认值)
2. **组件**:写 `XxxPane.vue`(接收 `props: { tab: XxxTab }`),在注册表用 `defineAsyncComponent` 懒加载
3. **注册**:`PANE_DEFS` 添加一条 `{ kind, icon, component, serialize, revive }`

之后标签分发(EditorTab 动态组件)、图标、会话保存/恢复**自动生效**,零额外改动。现有 7 种面板(查询/表数据/结构/设计器/ER/DDL/Redis)全部走此机制,可作参考模板。

**纯逻辑模块**(与组件解耦,便于单测):`csv.ts`、`sqlAdvisor.ts`、`exportImport.ts`、`panes/registry.ts` 的 serialize/revive。测试位于 `tests/`(vitest,`npm run test`)。

## 已知限制

- 密码明文存储于应用配置目录(路线图:接入系统密钥库)
- SQLite 不支持修改已有列(引擎限制,设计器会明确提示)
- 全局搜索为逐表扫描,大库耗时(上限 50 命中)
- SSH 隧道未实现(等待测试环境)

## 路线图

亮色主题 · SSH 隧道 · 数据传输/同步 · Excel 导出 · 查询取消
