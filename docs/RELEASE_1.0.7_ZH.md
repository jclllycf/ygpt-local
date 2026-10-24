# YGPT Local 1.0.7

此版本修复日常浏览器 Profile 选择丢失，以及 YGPT 分组内旧标签页无响应时整个 Profile 接管超时的问题。

- 选择 Profile 时即建立聊天专用上下文，选择、打开网页及后续操作持续携带同一 `contextToken`。不同聊天可以并发使用不同 Profile。
- 显式切换 Profile 仅改变新标签页的目标；原标签页仍保留原 Profile 和聊天归属。标签列表标明所属 Profile，分离操作仅释放当前聊天在相关 Profile 中的控制权。
- 为旧分组标签页分别设置初始化时限。无响应页暂时跳过并保留，正常页和新建任务继续工作；接管结果报告跳过数量，并抑制重复的调试会话通知。

已有用户运行 **Update** 更新包。配对、凭据、Tunnel 身份、私人数据和快照保留；浏览器扩展维持 1.0.19，无需重新安装。

验证覆盖真实 broker 的上下文衔接、独立 Chrome 测试实例、跨聊天访问拒绝、保留标签页时显式切换，以及注入无响应帧树请求。发行验证记录分别标明隔离测试、实机 Chrome Profile 验证和 Tunnel 就绪状态；不代表重新完成了纯净虚拟机或 Android 验收。

欢迎通过 [GitHub Issues](https://github.com/jclllycf/ygpt-local/issues) 反馈问题。附件请去除密钥、配对 token、私人网址与个人数据。
