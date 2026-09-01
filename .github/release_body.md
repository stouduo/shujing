## 数镜 v0.5.8

轻量级数据库桌面客户端(Tauri 2 + Vue 3 + Rust),冷启动约 1s,安装包 ~9MB(macOS Apple Silicon)。

### 超宽表支持
- **列虚拟滚动(方案二)**:接入 TanStack vue-virtual,>60 列自动启用,只渲染可视区 ±8 列
- 150 列大表横向滚动实测流畅,表头与数据恒定对齐,无黑屏/闪烁
- ☑ 复选框与 # 行号列 sticky 冻结,与虚拟列互不干扰
- 常规表(≤60 列)保持全渲染路径,行为不变

### 承袭
- 查询取消;MySQL/PG 双连接池;断线自愈;二次加工 Worker 化
- 结构页直接编辑;勾选行导出 CSV/Excel;DDL 语法着色
- zinc/Linear 风格 UI;Inter + JetBrains Mono 字体;侧栏底部状态区;筛选栏纵向重排
- 标签全家桶:溢出滚轮+列表、拖拽排序、去重定位、右键关闭(左/右/其他)

### 下载
- shujing_0.5.8_aarch64.dmg(macOS Apple Silicon,未签名,首次打开需右键 → 打开)
