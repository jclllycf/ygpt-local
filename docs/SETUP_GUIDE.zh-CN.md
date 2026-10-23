# Windows 安装说明

[English setup guide](SETUP_GUIDE.md) · [正式版说明](RELEASE_1.0.1_ZH.md)

界面全部使用英文，中文说明单独提供。首次安装用 Setup，已安装用 Update，核对同一 Release 的 `SHA256SUMS.txt`。安装包未签名。

1. **Choose folders**：首次安装选空程序目录，如 `D:\YGPTLocal`。数据、缓存和快照在其 `data` 内，更新资料在 `.updates` 内。Working folder 选项目或测试目录，阅读本机访问授权后继续。外观和清理选项按需展开。
2. **Check this PC**：查看系统、空间和 Windows 用户加密状态。Node、Python 和 Tunnel Client 已内置。默认登录 Windows 后静默连接；高级端口、代理按需展开。
3. **Connection method**：默认使用专用 Secure MCP Tunnel。打开官方 Tunnels 页面，在正确的 OpenAI 组织创建专用连接，关联实际使用的 ChatGPT 工作区，粘贴完整 `tunnel_…` ID；这不是 API Key。复制按钮可填名称和描述。其他方式在高级选项内；Local only 无法直接供远端 ChatGPT 使用。
4. **Runtime key**：在正确组织创建专用运行凭据，只粘贴到本机遮罩输入框，用当前 Windows 用户 DPAPI 加密。旧凭据默认保留，展开替换并填写新值才替换。不要把 Key 发到聊天或插件表单。
5. **Review & install**：核对程序目录、内部数据路径、工作目录和首选项，再点 Install YGPT Local。修复先等待本安装的工作完成，保留原连接身份。
6. **Check connection**：Local tools 是本机引擎，Private tunnel 是专用连接，First ChatGPT task 是首次远端文件读取，三者分别显示。Tunnel 已连接但引擎等待首次请求时，可继续创建插件。技术细节和恢复提示在 Connection details 内。
7. **Add to ChatGPT**：打开 Plugins → Add → Add custom MCP server。用 Copy name / Copy description；图标选 `plugin-icon-256.png`，小于 10 KB。专用私人连接选择 Tunnel，复制 ID，选择 No authentication；它只省略额外应用层 OAuth，不取消运行凭据与本机保护。公网 HTTPS 使用 OAuth。本人阅读官方风险提示后创建并安装个人插件。
8. **Try your first task**：在新聊天选 `@YGPT Local`，粘贴 Copy first-task prompt，核对随机标记原文，再点 Check first real tool result。复制后可关闭设置窗口，连接仍在后台维持；清理等待首次验证和窗口退出。

最后一页的 **Use your daily Chrome or Edge** 可选接入日常浏览器：在对应配置中启用开发者模式，加载程序目录的 `extension`，打开配对页，将令牌填入扩展。各配置单独配对，任务选择使用的配置。YGPT 只操作自己的标签分组，个人浏览器和原标签保留。

默认隔离读取在返回前关闭浏览器并删除临时 Profile。多步交互显式设置 `keepAlive=true`，保留 contextToken，结束后关闭标签；30 秒空闲租约兜底释放。rc.17 或更早的旧扩展仍已加载时，每个配置需手动 Reload 一次，保留原配对令牌。

实际 ChatGPT 展示、真人批准、所有登录账户任务、注销/重启恢复和干净 Windows 安装仍需使用者验收；本地 fixture 不能替代这些结果。

安装、首次文件读取验证和更新都有独立完成提示。文件已更新但连接仍在启动时，会明确显示仍在连接；失败可重试，替换文件期间禁止直接关闭窗口。卸载结果分别列出已删除、已不存在、被修改和无法删除的文件；私人数据、未知文件与 `.updates` 恢复资料主动保留，并可打开残余目录、复制详情。结果写入本机 `data/uninstall-report.json`。卸载辅助程序也位于内部 `.updates`，关闭结果窗口后没有辅助后台进程。

Advanced maintenance → Review installation leftovers 提供完整残留审计和清理结果。验证连接与当前程序完整性后，保留一个可信回滚点、淘汰多余的已验证程序副本；旧登记备份后再移除。未知、修改、联接、共享或被引用的文件逐项说明保留原因。私人数据、快照、迁移恢复资料和开发目录不动。
