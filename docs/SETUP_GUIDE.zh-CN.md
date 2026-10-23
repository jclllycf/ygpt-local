# Windows 安装指南

[English](SETUP_GUIDE.md) · [1.0.4 正式版](RELEASE_1.0.4_ZH.md)

界面全英文，共九步；版本信息固定左下角。使用 Setup 首次安装，已有安装使用同版本 Update。核对发行页的 SHA256SUMS.txt；程序目前未签名。

1. **Choose folders**：选择程序目录和现有工作目录。数据、缓存、更新位于所选程序目录内。图标与授权条选择区默认展开。自动清理及 Auto remove this exact downloaded Setup 默认勾选，显示准确路径和大小，可自行取消。
2. **Check this PC**：查看 Windows x64、空间和用户加密。已内置 Node、Python、Tunnel Client。登录自启默认开启，端口和代理属高级选项。
3. **Connection method**：默认专用 Secure MCP Tunnel。展开的 field by field 指引逐项解释名称、描述、组织和工作区；复制按钮就在对应字段旁。创建专用连接后粘贴完整 ID，不要复用其他实例的活动 Tunnel。
4. **Runtime key**：按默认展开的指引创建专用运行凭据，仅粘贴到本机遮罩框。DPAPI 加密保存；不调用生成模型。旧凭据默认保留。
5. **Review & install**：核对并安装。安装完成后 Back 再返回，不修改设置时显示 Continue to connection check，不会再次安装；改动后才显示 Apply changed settings。
6. **Check connection**：本机工具、Tunnel 和首次真实读取分别显示。Tunnel 已连接但引擎等待首次请求时，可继续创建插件；展开详情查看实测错误。
7. **Add to ChatGPT**：打开 Plugins → Add → Add custom MCP server，按序填写。Open plugin icons folder 只打开 assets/plugin-icons，五款 PNG 均为 256×256 且小于 10,000 字节；其他界面图标保留高清。专用私人 Tunnel 选择 No authentication；公网 HTTPS 使用 OAuth。官方风险提示由本人阅读、决定。
8. **Browser (optional)**：独立可跳过的日常浏览器配置。可选默认浏览器/Chrome/Edge；选用日常浏览器时有 Open Chrome extensions、Open Edge extensions 跳转按钮，加载 extension 文件夹后在同一浏览器完成配对。也可 Skip for now。
9. **Verify & finish**：Open ChatGPT with the check ready 在新聊天输入框预填英文安装检查、文件位置/大小与清理请求，由你自行发送。它不模拟键盘、不自动发送、不代点审批。核对 ChatGPT 返回的准确标记。

打开草稿后，若认证读取成功且保留默认清理勾选，Setup 会自行关闭并交由安装目录内经过哈希校验的短时助手清理，因此未点击 Finish setup 也可完成。只处理签名计划中登记的准确下载文件及验证标记，不扫 Downloads/Temp。已安装 Settings、运行时、凭据、私人数据、快照和可信回滚保留；被改动、占用、引用或未知文件记录保留原因。收据区分完成、等待和跳过，不将已排程当成已删除。

Windows 剪贴板被其他程序占用时自动重试；持续占用时提示关闭相关剪贴板或远程覆盖层后重试，保留安装进度。安装、验证和更新均有独立反馈；卸载明确报告删除、缺失、修改、受阻与主动保留项，并保存 data/uninstall-report.json。

Advanced maintenance → Review installation leftovers 可查看更新缓存和旧登记审计。验证完整性与健康状态后，仅保留一个可信回滚副本；旧登记备份后清理，开发目录及私人恢复资料不扫除。

2026 年 10 月 23 日，所有者报告在 ChatGPT Free 免费账户实测成功。这是用户实测证据，与本地自动化 fixture 分开记录，不代表所有账户/工作区均有相同入口或权限。1.0.4 的本机生产安装按用户要求暂缓。

[欢迎反馈](https://github.com/jclllycf/ygpt-local/issues/new)：请提供版本、复现步骤、期望与实际结果，可附脱敏截图，不要包含密钥、配对令牌或私人内容。
