## 数镜 v0.5.7

轻量级数据库桌面客户端(Tauri 2 + Vue 3 + Rust),冷启动约 1s,安装包 ~9MB(macOS Apple Silicon)。

### 修复
- **表格渲染回归修复**:回退列虚拟滚动试验,恢复全列渲染 + sticky 冻结列(☑/#)的稳定基线
- 横向滚动时 ☑ 复选框与 # 行号列重新冻结在可视区左缘,不再消失
- 表头与数据列在任意滚动位置恒定对齐,无渲染缺失

### 保留 v0.5.6 全部能力
- 查询取消(MySQL KILL QUERY / PG pg_cancel_backend)
- MySQL / PostgreSQL 双连接池 + 断线自愈
- 二次加工 Worker 化;勾选行导出 CSV/Excel;DDL 语法着色
- 结构页直接编辑(字段/索引/DDL 三段 + 复制 DDL)
- zinc / Linear 风格 UI;标签全家桶;侧栏底部状态区

### 下载
- shujing_0.5.7_aarch64.dmg(macOS Apple Silicon,未签名,首次打开需右键 → 打开)
