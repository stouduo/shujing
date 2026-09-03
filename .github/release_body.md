## 数镜 v0.5.10

轻量级数据库桌面客户端(Tauri 2 + Vue 3 + Rust),冷启动约 1s,安装包 ~9MB(macOS Apple Silicon)。

### 表格垂直滚动流畅度修复
- **表头强制合成层**:`transform: translateZ(0)` 将 sticky 表头提升为合成层,垂直滚动不再逐帧在主线程做粘性约束计算,消除滚动拖影
- **移除 # 列逐格阴影**:每行一个 box-shadow 是滚动时的逐帧重绘源,分隔改由列边框承担
- **滚动处理保持同步**:行虚拟窗口与滚动事件同帧更新(此前实验性的 rAF 合帧已回退,异步化会造成一帧滞后)

### 承袭
- 160 列宽表列虚拟滚动(TanStack);行/列双向虚拟滚动;查询取消;MySQL/PG 双连接池;断线自愈
- 搜索/筛选/排序 Worker 化;勾选行导出;结构页直接编辑;DDL 语法着色
- zinc/Linear 风格 UI;Inter + JetBrains Mono 本地字体;侧栏底部状态区;筛选栏纵向重排

### 下载
- shujing_0.5.10_aarch64.dmg(macOS Apple Silicon,未签名,首次打开需右键 → 打开)
