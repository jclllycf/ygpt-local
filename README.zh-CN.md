<img src="assets/brand/ygpt-local-512.png" width="72" alt="YGPT Local 原创 Y 连接图标">

# YGPT Local

从你正在使用的 ChatGPT 账户调用自己的 Windows 文件、项目与授权工具，保留写前快照、恢复冲突保护和高风险审批。

**产品定位：** YGPT Local 是免费、开源、轻量的本地半自动化 Agent，让你在支持相关插件功能的 ChatGPT 网页端或桌面端对话中，用自然语言调用自己的 Windows 文件、浏览器任务与经授权的工具；敏感操作仍由你控制。YGPT 本身不要求付费会员；ChatGPT 插件入口、Platform Tunnel 和第三方服务各有账户、工作区及费用条件，不能保证所有免费账户都具备相同能力。参见 [OpenAI 插件可用性说明](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt)及[自定义 MCP 条件](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)。

**1.0.12 是当前正式版，界面仅英文。** 安装包见 [GitHub Releases](https://github.com/jclllycf/ygpt-local/releases/tag/v1.0.12)，源码和发行包均公开。实测范围见 [正式版说明](docs/RELEASE_1.0.12_ZH.md)。另见 [English README](README.md)、[CHANGELOG](CHANGELOG.md)、[中文升级指南](docs/UPGRADE_USER_GUIDE.zh-CN.md)、[中文安装教程](docs/SETUP_GUIDE.zh-CN.md)、[验收状态](docs/VALIDATION.md)、[安全边界](docs/SECURITY.md)。

**权限与开发模式：** 普通模式直接放行读取、普通修改和有快照保护的小规模清理。首次桌面操控仅申请一次当前聊天的 **10 分钟 Full Access**，期间桌面、文件和命令无需重复授权；其他聊天不继承。开发时也可用 `y_chat_access action=request_full` 直接在对话中申请 Full Access，默认两小时，点击本聊天卡片即可启用，无需 Windows 设置。可随时查询或撤销，详见 [权限指南](docs/CHAT_ACCESS.zh-CN.md)。

脚本和命令默认放行：未知代码、变量、循环、多行参数、动态或编码脚本，以及对受保护目录的单纯引用，均不会单独触发授权。只有识别出明确高危信号时才要求确认；这是一套用户指定的黑名单策略，不是操作系统沙箱或未知代码的安全证明。

**免费账户实测进展：** 2026 年 10 月 23 日，项目所有者报告已在 ChatGPT Free 账户中实际使用成功。这为产品可行性增加了用户实测证据；每个账户仍需具备相应入口、工作区权限和 Platform Tunnel 访问权限，不代表所有免费账户均保证可用。

普通授权保留在对话内，仅主动申请 Full Access 才弹出面板。可额外申请管理员命令权限，需在聊天卡片后确认 Windows UAC；普通文件和桌面工具仍使用普通令牌。用户也已报告 1.0.10 手机端 Full Access 实测成功。

## 图形安装流程

1. 获取 `YGPTLocal-Setup-1.0.12-win-x64.exe`，核对 `SHA256SUMS.txt`。安装包未签名。已经安装过？运行 `YGPTLocal-Update-1.0.12-win-x64.exe`：原地更新，保留数据、密钥、连接身份、快照和 ChatGPT 插件，并将旧版外部数据迁入程序目录（见 [升级指南](docs/UPGRADE_USER_GUIDE.zh-CN.md)）。
2. 按九步向导选择程序目录和授权工作目录。内置 Node、Python 和官方 Tunnel Client，普通安装不要求开发环境或管理员权限。
3. 保留默认 **OpenAI Secure MCP Tunnel**。在自己有资格的 Platform 组织中创建专用 Tunnel，并关联实际使用的 ChatGPT 工作区。不要抢用其他实例已连接的 Tunnel。
4. 在本机填写完整 Tunnel ID 和专用运行时 API Key。Key 使用遮罩输入和当前用户 DPAPI 加密，用于认证 Tunnel Client；安装器不调用 GPT 生成模型，也不代为创建 Key。
5. 核对本地引擎、Tunnel、凭据和真实调用的分别状态。私人 Tunnel 可能等首次远端握手才创建 Broker；不能据此反复重启。
6. ChatGPT **Plugins → Add → Add custom MCP server** 选择 **Tunnel**，填写 ID。仅专用私人 Tunnel 推荐 **No authentication**，表示不额外进行应用层 OAuth；不取消 Tunnel 运行凭据及本机保护。公网 HTTPS/Cloudflare 继续用 OAuth。官方风险确认由你本人阅读、勾选，再创建和安装个人插件。
7. **Browser (optional)** 可跳过，或通过 Chrome/Edge 扩展管理页跳转按钮安装日常浏览器扩展；可选择后续打开 ChatGPT 的浏览器。
8. 点击 **Open ChatGPT with the check ready**，在新聊天中打开预填好的英文安装检查、文件大小报告与清理请求。自行检查、选择 `@YGPT Local` 并发送。
9. 核对返回的随机标记。默认清理选项下，认证验证成功后，本次下载的 Setup 会关闭并清理登记过的下载文件及验证标记；即使未点击 Finish setup 也可完成。已安装 Settings 和后台连接保留。

这是同一套产品，不要求提交公共插件目录。官网各字段、组织权限和到期设置见 [安装教程](docs/SETUP_GUIDE.md)。程序不能代用户取得账户资格。**不要将 Key、配对密钥、审批 token、profile 和私有日志发到聊天或 GitHub。**

## 必要后台组件

```text
Windows 用户登录
  → 唯一的静默 YGPTWatchdog.exe
    → 官方 tunnel-client
      → Node Broker / Engine 及必要 worker

YGPTLocal.exe：设置、修复、卸载，按需打开
```

Secure Tunnel 默认走 stdio，不增加 HTTP Supervisor；高级 Cloudflare/本地模式保留必要 HTTP gateway。自启是当前用户、最低权限、忽略重复启动的独立计划任务。数据目录和 Tunnel 身份互斥，并检查旧 profile 启动的客户端，不为新实例结束旧连接。

自有进程退出后指数退避，网络重连交给官方客户端。Key 无效、到期或权限不足时保留配置，停止无意义重试并提示处理。不会创建新 Tunnel/Key，也不重放结果不明的写入、删除和命令。真实重新登录与断网验收单独报告。

## 安装后清理和管理

自动清理默认开启，可取消，安装前说明范围。仅处理本次 Generation 签名所有权清单，重新核对文件 ID、大小、SHA-256、祖先路径、链接、占用以及运行、自启、维护引用。不扫空 Downloads/Temp，不调用卸载器。

用户下载的 Setup 的准确文件清理选项默认勾选、可取消，安装前显示其路径与大小，同名和下载目录不构成所有权。未知、修改过、被替换、共享、使用中或仍有引用的文件保留并记录原因。收据仅含类别、数量、字节和结果。

保留 Watchdog、Tunnel、必要运行时、设置/升级/卸载、DPAPI、配置、OAuth、审批账本、数据库、快照和回滚索引。删除 Setup 下载包后，已安装 Settings 仍可配置自己的校验完整运行时；文件损坏或升级需要完整安装包。

默认程序目录为 `D:\YGPTLocal`，也可选择其他安装文件夹。全部产品数据位于所选目录的 `data` 子目录，更新暂存与回退副本位于 `.updates`。更新旧版本时自动迁移外部数据，保留密钥、连接身份、历史和快照，并更新启动任务及快捷方式；未知用户文件保留。见 [rc.18 实机修复说明](docs/RC18_FIELD_REPAIR_ZH.md)。

RC3 开发不停止当前正常生产 Tunnel，也不把其他 Tunnel 的安装当作垃圾删除。

## 使用和恢复

文件操作优先使用 `y_file_read`、`y_file_edit`、`y_search_text`、`y_sqlite_read`、`y_backup_diff`、`y_backup_restore`。只提供一套规范的 `y_` 工具目录；`y_ping` 按组列出，已移除的旧工具没有执行路由和别名解析器，返回 `NO_TOOL`，需刷新实时目录。真实 ChatGPT 目录仍需独立验收。

权限模型（所有者黑名单）：默认全部放行，读取和普通写入无需审批。破坏性、提权、系统或凭据相邻操作，批量/文件夹删除，以及写入 YGPT 自身状态或 G: 保险库，都会请你本人决定，而不是直接拒绝；没有硬拒绝的目标。卡片提供 Allow once、Always allow in this chat、Deny，会话复用限定在可审阅范围。`y_policy` 显示当前规则。

浏览器：默认用隔离浏览器（每个对话全新，默认 Chrome，可配置），或通过随附的 YGPT 扩展（`extension/`，以未打包方式加载）接管你日常的 Chrome/Edge，只在名为 "YGPT" 的标签组里工作。更新 YGPT 后，请在 `chrome://extensions` / `edge://extensions` 里对扩展点「重新加载」；未打包的扩展不会自己读取新文件。

恢复拒绝覆盖后续修改，返回 `CONFLICT / executed:false / filesRestored:0`，成功恢复产生撤销快照。批量操作不是原子事务，终端快照无法覆盖全部外部副作用。这些保护不是 Windows 沙箱。ChatGPT 外层 Opened/CSP 布局由宿主控制。

构建步骤和独立 Windows 测试见 [English README](README.md)。本地协议、原生 GUI 和清理测试均不冒充真实 ChatGPT 或干净 VM。原创图标、代码采用 MIT，第三方保留 [各自许可](THIRD_PARTY_NOTICES.md)。此项目独立开发，不是 OpenAI 官方产品。

## 欢迎反馈

[提交问题或建议](https://github.com/jclllycf/ygpt-local/issues/new)。请附 YGPT、Windows 和浏览器版本、复现步骤、期望与实际结果。欢迎免费及付费账户的实测反馈；截图请脱敏，不要包含 API Key、配对令牌或私人内容。
