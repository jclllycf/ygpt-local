# YGPT Local

让 ChatGPT 通过真实工具读取、搜索和修改你自己的 Windows 文件，支持写前快照、恢复冲突保护及高风险操作审批。

**当前为开发候选版，尚未确认公开 Release。安装包下载地址将在发布验收完成后提供；不会用占位链接冒充已发布。**

## 不用命令行的安装路径

1. 发布后，从本仓库 Releases 下载 `YGPTLocal-Setup-*.exe` 并核对 SHA-256。候选安装器未签名，不代表有经过验证的发行者证书。
2. 双击安装器，选择一个空的应用目录，以及允许本地工具操作的工作目录。完整安装包包含 Node、Python 与 cloudflared，不要求你安装开发环境。
3. 选择连接方式并填写相应凭据。已有 Cloudflare Tunnel 填 connector token 和稳定 HTTPS 地址；新建 Tunnel 填具有对应账户 Tunnel Edit、域名区域 DNS Edit 权限的 API Token。不要混用这两种 token。
4. 检查本机服务、目录、远端连接和认证各自的状态。本机安装成功不等于 ChatGPT 已连接。已有 Tunnel 需要原有路由指向向导显示的本机端口；仅 connector token 无权修改 DNS/远端配置。
5. 点击 Connect ChatGPT。在官方页面选择 Plugins → + → Add custom MCP server，名称填写 YGPT Local，输入带 `/mcp` 的 HTTPS 地址，选择 OAuth；在连接确认页面使用 Windows 向导提供的 owner pairing key。创建并安装个人插件，在新聊天选择 `@YGPT Local`，让它列出已授权测试目录，并观察真实工具结果。

这是一套产品的安装流程，不需要另外申请公共 OpenAI 插件目录，也不用部署额外 SaaS。Cloudflare 路径不要求 OpenAI API key。Secure MCP Tunnel 是另一个可选连接路径，需要账户支持、独立 tunnel_id、具有 Tunnels Read + Use 权限的运行时凭据，当前还需在向导选择官方客户端。

**不要把 API Token、Tunnel token、配对密钥、审批 token 或私有日志粘贴到聊天与 GitHub Issue。**

## 使用与安全

普通开发与 typed 读取按所有者规则自动执行。批量删除、系统/安全/磁盘及凭据修改仍需审批。卡片支持 Allow once、Always allow in this chat、Deny；会话授权只复用已经审阅的精确范围。

建议直接说：“读取这个本机文件”“修改指定文本，然后回读”“检查 SQLite 数据库，只读”“查看快照差异并恢复”。模型是否选择工具最终取决于宿主，不能保证每条消息都调用。必要时明确选择 `@YGPT Local`。

每次受保护文件编辑保留写前快照。恢复前检测是否出现后续修改；冲突返回 `CONFLICT / executed:false / filesRestored:0`，保留新内容。恢复操作也会产生可撤销快照。批量编辑不是原子事务。任意脚本的外部副作用、未覆盖文件及数据库不能仅靠快照完整回退。

默认应用目录为 `%LOCALAPPDATA%\Programs\YGPTLocal`，数据为 `%LOCALAPPDATA%\YGPTLocal`。凭据使用 Windows 当前用户 DPAPI 加密。托盘可暂停服务，开始菜单可再次打开设置。卸载默认保留数据与快照。

当前候选只安装至空目录，不自动覆盖旧安装；自动原位升级及完整旧状态迁移尚未发布。旧版继续运行，不能让两个代理使用同一 Tunnel 或状态目录。终端环境经过清理，不承诺使用日常桌面应用的登录 profile。

## 常见问题和验收

见 [故障排查](docs/TROUBLESHOOTING.md)、[文件迁移](docs/MIGRATION.md)、[安全边界](docs/SECURITY.md)、[当前验收状态](docs/VALIDATION.md)。本地协议测试不等于 ChatGPT 实机验收，未执行的项目保持待验，不会标绿。

ChatGPT 的 `Opened …` 和 `CSP off` 属于宿主外壳。项目只能控制内部审批卡及自身 CSP 声明，不能保证修改宿主的布局或删除其提示。

开发者构建步骤及许可证参见 [English README](README.md) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。普通用户应使用图形安装器，不需要复制 PowerShell 命令。
