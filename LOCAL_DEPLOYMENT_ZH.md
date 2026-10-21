# YGPT Local 本机上线与安装包交付

2026-10-21，本机已由旧产品切换为 YGPT Local。

- 生产核心：YGPT Local 1.0.0-rc.1；插件包：1.0.3。
- 活动程序：D:\AI\Tools\YGPT-Local；运行数据：D:\AI\Data\YGPT-Local。
- 原 OpenAI Secure MCP Tunnel 与现有个人插件身份保留，其他 Tunnel 未受影响。
- 计划任务：YGPT-Local-Watchdog；旧守护任务已注销，定义留作私有写前记录。
- 迁移并核对 13,401 个持久文件，两份 SQLite 数据库 integrity_check 均为 ok。历史快照、原数据和兼容入口保留。
- 公开工具名称使用 y_；实际目录 92 项公开工具及 2 项 App 内部工具。
- 插件名称、描述和 Skill 已更新；Skill 为 ygpt-local-work。

## 真实验证

当前电脑实际执行：7/7 集成测试通过，涵盖文件恢复与冲突、搜索分页、HTTP 鉴权、12 路并发初始化、DPAPI 重启/刷新、真实 Edge、Windows UIA、任务和本地审批语义。

在真实登录的 ChatGPT 新聊天中，YGPT Local 返回生产版本 1.0.0-rc.1，并读取测试文件得到 value=100。它不替代全部宿主审批或 20 条黄金提示词验收。

最终安装器在独立目录通过真实图形安装检查。安装后的 Node/Python 来自包内，无需依赖用户预装开发工具。安装器及便携包的 5,792 个清单文件与哈希核对通过，未发现私有运行凭据或状态数据库。

## 安装器

同目录 dist 下：

- YGPTLocal-Setup-1.0.0-rc.1-win-x64.exe
- ygpt-local-portable-1.0.0-rc.1-win-x64.zip
- SHA256SUMS.txt

安装器 SHA-256：
1cacc24c9695cb20999515ed4252978bab9b678f5bcfb428d7ed08a8aa4484e4

双击安装器后选择目录、连接方式，填写自己的凭据。OpenAI 路径使用内置官方 tunnel-client，要求有效 tunnel_id 和具备 Tunnels Read + Use 权限的运行时 API key。不要将凭据粘贴到聊天。新电脑应使用自己的连接；本机现有生产连接不需要再次安装或重复启动代理。

## 仍未完成的公开发布门槛

源码已在 https://github.com/jclllycf/ygpt-local 私有准备仓库，Windows CI 已通过。尚未转为公开，也未发布公开 Release；干净 Windows VM、全部真实宿主流程与其余发布门槛仍待完成。Windows Sandbox 在本机未能启动，未更改系统功能或安全设置。安装器目前未签名。

旧路径、旧名称只保留在历史证据、不可改写的快照及兼容入口中。未重命名其他 YUKI 项目、账号或用户数据；未对历史文件进行破坏性批量替换。
