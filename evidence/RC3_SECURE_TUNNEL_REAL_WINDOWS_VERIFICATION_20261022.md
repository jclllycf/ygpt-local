# YGPT Local RC3 — Windows 隔离实机安装与 Secure Tunnel 修复验收

日期：2026-10-22（用户电脑本地时间）；项目：`D:\AI\Projects\YGPT-Local`。这是用户授权的现场测试与候选包修复记录，**不是 ChatGPT 个人插件已经通过远程首调的证明**。

## 1. 用户提供的材料和边界
- 测试目标：`dist\YGPTLocal-Setup-1.0.0-rc.3-win-x64.exe`。
- 凭据文件：`dist\api key.txt`、`dist\tunnel.txt`，只在独立 Windows 测试进程内读取；仅验证格式和实际 Tunnel Client 就绪，不记录明文、密钥、完整 Tunnel ID 或任何私人应用日志。
- 宿主生产实例保持原样：本轮最终 `y_ping` 返回 `1.0.0-rc.2` / `engineReady=true` / `approvalReady=true`；`y_service_health` 返回 94 tools。没有终止、更新或重新配置生产 Tunnel。
- 本次测试是**同一宿主 Windows 的独立安装目录、数据目录、Windows 任务身份、MCP 服务和凭据状态**，并非 Windows Sandbox 内远程操控。未动 ChatGPT Desktop Agent 的工具/浏览器/进程。
- 在启动测试 Tunnel 前，通过 Windows 进程参数比较确认正在运行的 Tunnel Client 没有使用测试 Tunnel ID；测试的独立 Watchdog 自动执行冲突检测。
- Git 工作区进入测试前已有 `runtime/secure-state.ps1`、`engine/src/workers/secure-state.ps1`、`setup/NativeWindows.cs` 和 `setup/Watchdog.cs` 的未提交修改；本轮没有重置或覆盖无关开发改动。

## 2. 发现的真正根因
旧 RC3 Secure Tunnel Watchdog 构造 `--mcp.command` 时直接嵌入 Windows 反斜杠路径。官方 Tunnel Client 对该字段执行类 POSIX 命令行分词，反斜杠被误认为转义，实际启动路径从 `D:\...\node.exe` 变成了 `D:...node.exe`，导致：
- `mcpclient: start stdio command`
- `The system cannot find the file specified`
- Tunnel Client 立即退出，Watchdog 反复重连，并被粗糙日志分类误判为 `TUNNEL_NETWORK_UNREACHABLE`。

**对照实验**：只把 `--mcp.command` 中 Node 与 bootstrap 两个绝对路径改成 `D:/...` 正斜杠格式，客户端便可成功启动、保持运行，并读取到控制平面的 Tunnel 元数据。失败不是用户漏下载 ZIP 或纯粹的 Sandbox 网络权限问题。

## 3. 本轮已修改的源码
- `setup/Watchdog.cs`：
  - 新增 `StdioMcpCommand`，将 Windows 绝对路径转换为斜杠并保留含空格路径的引号，避免被 Tunnel Client 命令行分词吞掉。
  - 区分 `TUNNEL_STDIO_PROCESS_PATH_INVALID` 与网络/TLS/权限/失效 Key 诊断。
  - Watchdog 重试时更新心跳、剩余重试秒数和最近退出码，避免 25 秒 UI 心跳阈值造成假 Stale（相关代码已存在于工作树，保留并回归）。
  - Tunnel 控制平面已 Ready、但尚未进行 ChatGPT 真实工具调用时，使用 `tunnel-ready-awaiting-first-mcp-call`；就绪后清除先前已恢复的过期错误。
- `setup/SetupWindow.cs`：Verify 页明确显示 `Tunnel: Ready (OpenAI Tunnel Client connected)`、以及“本地 Engine 等待 ChatGPT 首次真实工具调用”，不再让用户误以为所有 Not verified 都代表 Tunnel 故障。
- `tests/Rc3TunnelCommandRegression.cs`：覆盖含空格 Windows 路径转义及 stdio 子进程路径错误分类。
- `tests/Rc3SecureIsolatedProbe.cs`、`tests/diagnose-rc3-tunnel-client.mjs`：独立本机测试脚本，不含明文秘钥、不自动创建插件/同意 ChatGPT 风险提示，不接触生产用户文件。

## 4. 真实测试证据
1. **原始安装包（修复前 SHA-256 `675ca15f798f91333bdbb75a8762d30a9b612f0485fbe30c57f2426ee4413ec4`）**：
   - 原生 GUI 一键安装及 8 步页面、Windows 登录自启计划任务、GUI 退出后本地 MCP 调用、重复启动防护、子进程崩溃恢复、按需设置、测试任务安全停止：`passed=true`（独立 local-only 传输）。
   - 切到用户提供的 Secure Tunnel 与 API Key：Watchdog 反复退出，最初错误被分类为 `TUNNEL_NETWORK_UNREACHABLE`。
   - 官方 Tunnel Client 的独立脱敏启动日志显示实际原因是 stdio Windows 路径未找到。
2. **仅修正 stdio 路径的对照测试**：Tunnel Client 成功启动且未立即退出，能够访问控制平面元数据。这里不是 ChatGPT 工具调用证明。
3. **更新后 Watchdog 独立 Secure Tunnel 实测**：`tunnel-ready-awaiting-first-mcp-call`、Tunnel `/readyz` 就绪、0 次重连、`lastError=""`、测试后安全停止。
4. **全自动 Node/MCP 回归**：15/15 passed、0 failed。覆盖审批、快照/冲突、HTTP/OAuth、12 并发初始化、浏览器、Windows Native、文件工具、第一读凭证等。
5. **新 C# Windows 路径/错误分类回归**：`STDIO_PATH_NORMALIZATION_PASS` 与 `ERROR_CLASSIFICATION_PASS`。
6. **修复后的重新打包 EXE 原生 GUI 测试**：`passed=true`、`exitCode=0`；覆盖安装后 local-only MCP 读文件与恢复、计划任务与独立程序管理。
7. **使用新打包 EXE 安装出的 Watchdog 再测 Secure Tunnel**：`result="secure-tunnel-ready"`、`maxRestarts=0`、`classifiedError=""`、`safeStop=true`、测试退出码 0。
8. **安全性**：打包清单 5825 项；EXE 不含用户 `api key.txt` 的明文 Key 和 `tunnel.txt` 的 Tunnel ID。公开源码扫描 `passed=true`，181 文件、106 依赖包、0 findings。注意这不是全部二进制依赖或仓库历史审计。
9. 生产 RC2 最终只读健康：`engineReady=true`、`approvalReady=true`、94 tools，未升级、未被测试实例抢占。

## 5. 最新修复候选
- 安装器：`D:\AI\Projects\YGPT-Local\dist\YGPTLocal-Setup-1.0.0-rc.3-win-x64.exe`
- SHA-256：`e1be4221831c0d6866a2581921bdfc8ed7a973fe4393427d3afb68f0ed547bcf`
- Portable ZIP：`dist\ygpt-local-portable-1.0.0-rc.3-win-x64.zip`，SHA-256 `a6c184c658e3a732376b5bd19ab03b6a9d2a3f08970d62fe8d3bda1f8f98761a`
- 原始 RC3 安装包与 ZIP 已独立备份至 `.local\backup-before-stdio-fix-20261022`（不包含用户凭据文件）。
- **未部署到当前生产连接，也未推送 GitHub / 建立 Release。**

## 6. 未完成或不能宣称完成
- 尚未用**该隔离实例在真实 ChatGPT Plugins 页面创建并确认个人插件**，也未完成用户真实对话中的第一次远程 MCP read；控制平面 Ready 不等于 ChatGPT 调用验证。
- 未在新建 Windows Sandbox 内远程 GUI 操作（当前 YGPT Desktop UIA 拒绝绑定未授予程序所有权的 Sandbox 窗口，不能绕过安全边界）。
- 尚未真实重启整台 Windows 或模拟宿主断网/恢复；仅做了 Watchdog 子进程级故障恢复与计划任务动作。
- 未修改现有生产 rc.2、第三方 ChatGPT Desktop Agent、原有 Tunnel 和用户私人数据。
- 测试所用加密凭据仍位于命名测试数据目录中；用户提供的两份明文源文件仍在 `dist`，被 gitignore 排除，**不要将它们提交、复制到 issue 或发布 ZIP**。如已向第三方暴露，需在官方平台撤销/轮换。
