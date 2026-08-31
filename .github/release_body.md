## 数镜 v0.5.4

轻量级数据库桌面客户端(Tauri 2 + Vue 3 + Rust),冷启动约 1s,安装包 ~9MB(macOS Apple Silicon)。

### UI 换装:zinc / Linear 风格
- 全新设计令牌:深邃 zinc 底色 + 靛蓝强调,暗色模式贴近 Linear/TablePlus 观感
- 亮色主题同步换为 shadcn zinc light 素净白
- Naive UI 组件主题同步迁移,全局旧配色一次性更新

### 性能
- 大结果集 markRaw 绕开深度代理,降低 Proxy 内存与访问开销
- 查询取消、双库连接池、二次加工 Worker 化(承袭 v0.5.3)

### 下载
- shujing_0.5.4_aarch64.dmg(macOS Apple Silicon,未签名,首次打开需右键 → 打开)
