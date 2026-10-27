# YGPT Local 1.0.20 — 候选版

Setup 新增 **Account connections**。第二个 ChatGPT 账号填写名称、专用 Tunnel ID
和 API Key 后，即可复用当前安装，无需重复下载或安装。

- 最多八个账号连接同时在线，共用程序、引擎、浏览器中继和 Update 更新。
- API Key 分别使用 Windows DPAPI 加密；原账号的连接和凭据保持原位。
- 会话、Full Access、授权决定和保留的调用结果绑定各自的连接。
- 单个隧道失败独立处理；修改或停止现有连接会等待任务和待授权操作结束。
- Setup 统一提供列表、状态、编辑、替换密钥、连接和停止入口。

在第二个 ChatGPT 账号中，仍需使用其专用 Tunnel ID 安装个人插件，并由本人完成
ChatGPT 的确认。API Key 只填在本机 Setup，不要发送到聊天。
隔离回归测试与真实账号验收分别记录，Connected 仅代表本机隧道就绪。
该版本也包含 1.0.19 的内嵌显示修正及其已记录的宿主限制。
