# YGPT Local 下一阶段整体升级任务书
> **Chat-Only Isolation · Multi-Conversation Safety · Tool Consolidation · UIA Approval**
>
> 日期：2026-10-22
> 执行者：Claude（在本地 YGPT Local 项目中开发、复查、测试并交付）
> 状态：**待执行的升级规格，不代表改造已经实施**
> 仓库：`D:\AI\Projects\YGPT-Local`
> 当前接入生产服务：`1.0.0-rc.2`；本地已有 `release/1.0.0-rc.3` 候选源码与安装包，**不能混同生产已经升级**。

## 0. 一句话目标与不可违反原则

**ChatGPT Desktop Agent 做它擅长的完整自主工作；YGPT Local 专门为普通 ChatGPT 对话模式提供高效、完整而受控的 Windows 本地能力。两者并存，但互不接管，尊重各自的进程、窗口、浏览器、任务和文件操作所有权。**

**不可违反的用户决定：**

1. **YGPT 专属于普通 ChatGPT 对话模式。** Desktop Agent 必须继续调用 Agent 自己的原生工具，YGPT 不主动替 Agent 操作、抢占焦点、关闭其窗口/浏览器、终止进程、取消任务或重用其权限。
2. **Desktop UIA 必须保留、开放、可实际使用，不能关闭或删掉。** UIA 绑定和交互默认人工授权（至少“允许一次”）；窗口清单等不含敏感内容的纯只读元数据可自动允许。应用白名单/哈希校验 **不等于** 一次具体操作的人工同意。Agent 所有的窗口始终禁止 YGPT 接管。
3. **Browser 保留但懒启动、按需用。** 不必因近期低频而删除；不得接管个人 Chrome、ChatGPT Agent 浏览器、他人的 CDP/调试端口或浏览器 Profile。
4. **可直接淘汰重复/陈旧兼容接口及代码**，以一套最新、类型化的 `y_*` API 为准；但必须先核对引用与依赖、完成替代及测试，保证审批、状态恢复、备份、安装和生产连接不因删除而损坏。不要求为旧客户端无限维持兼容性。
5. **多个普通对话并行工作是正常功能。** 同一时间出现同名读工具调用，优先解释为并行任务；不得未经证据认定重试 BUG，更不得全局串行化把所有对话卡住。必须建立按对话与资源的隔离、写冲突保护和故障定位能力。
6. 普通可信项目操作继续便捷自动化；系统/凭据/高危操作严格走用户审批。**模型不能自行批准自己的请求，MCP 参数或 clientInfo 不能成为授权证明。**
7. 优先保证真实用户数据、当前生产 rc.2、独立 Agent 工作和相关隧道不受影响。**先隔离构建/测试，再由用户决定生产切换；未经明确授权不得停止生产连接或修改 Agent 环境。**
8. 本阶段是工程交付：Claude 应修改源码、补测试、输出报告、形成可安装候选；不可只写建议或将未通过的本机测试说成宿主实测。

## 1. 已核实的事实与证据边界

### 1.1 实际生产及工具使用

- 2026-10-22 对话中 `y_ping` 报告：`version=1.0.0-rc.2`、`engineReady=true`、`approvalReady=true`、`policyVersion=10`；`y_service_health` 报告 **94 工具**。
- 本轮模型可见 **92 项 `mcp__YGPT_Local__` 接口**，与服务报告数字不等，可能涉及动态广告、隐藏接口或目录差异。需要以真实 MCP 列表 + 服务目录逐一核对，不得凭此认定丢失两项功能。
- 之前对 `y_recent_calls(limit=100)` 的首次采样：**93 succeeded、6 failed、1 unknown**；常见调用包括 `y_file_read` 36、`y_file_edit` 15、`y_file_list` 14、`y_process_run` 11、`y_search_files` 4、`job_submit` 4 等。说明高价值集中在文件、搜索、开发进程/持久任务。
- 有大量毫秒级近邻同名调用。用户说明可能是多对话同时运行，**这是合理的首要假设**；日志暂不具有可靠的调用源/对话归属，不可断言重复执行。复查中有一项 `job_submit` 状态仍为 `unknown`，没有重放。
- `y_policy` 报告 `mode=autonomous`、`defaultAllow=true`、`noOsSandbox=true`。黑名单式高危识别和项目级权限不能替代操作系统沙箱，任意项目脚本的副作用仍需诚实说明。

### 1.2 浏览器是什么，不是什么

源码：`engine/src/browser-engine.mjs`、`engine/src/engine.mjs`、`runtime/native-extension.mjs`。

- **YGPT Browser = Playwright 调用 Chromium，明确选择 `channel:'msedge'`，即本机 Microsoft Edge。** 默认 `headless=true`；使用 `browser.newContext()`，不是用户平时的 Chrome Profile，也没有借用个人登录信息或公开调试端口。
- 浏览器启动是 **lazy launch**；`validateUrl` 使用 HTTP(S) + 可配置允许主机集合，源码默认主机为 `127.0.0.1` / `localhost` / `[::1]`，**实际生产允许列表必须核实配置，不能直接假设只有本地地址**。
- 当前 9 个能力为 `y_browser_open`、`tabs`、`snapshot`、`navigate`、`action`、`wait`、`screenshot`、`download`、`close`；可按 DOM/Role/Locator 操控 **YGPT 自己的页面**。页面内容一律不可信；下载需要边界和来源校验。
- **不是** ChatGPT 内置 Web Search，不是 Desktop Agent 的原生浏览器，也不是 Desktop UIA。UIA 是跨 Windows 原生应用窗口的 UI Automation；Browser 是隔离的网页自动化。两者功能局部相似，但使用边界不同、都有独立价值。
- 当前 `YBrowserEngine` 在同一引擎实例用 `this.tabs = new Map()` 管理全部页面，`y_browser_tabs` 返回引擎标签页；必须审计 **多对话是否共享/泄露 tabId 及页面内容**。应绑定可信请求会话或独立授权的浏览器工作区，不可单靠模型传入的字符串宣称所有权。
- 建议保留 Browser、保持懒启动、限制独立上下文与域名；不要为了“去重”把普通对话改为操控 Agent 自己的浏览器。

### 1.3 Desktop UIA 当前保护不足之处

源码：`engine/src/desktop-engine.mjs`、`engine/windows/YDesktop.cs`、`runtime/native-extension.mjs`。

- 当前 Native 策略对 `y_desktop_windows` 允许只读清单，对其他 `y_desktop_*` 的基线策略通常直接 `allow`，并依赖绑定阶段的应用可执行路径+SHA-256、PID/进程出生标识等白名单。
- **这些限制有价值，但并未建立“每次 UIA 控制默认经过真人授权”的可靠保证。** 这正是下一版 P0 修复。
- 新版必须保留 `y_desktop_bind / inspect / value / action / screenshot` 能力，并加真正的、基于可信审批事件的最小权限授权。**不可采取“默认关闭 Desktop UIA”来规避开发任务。**

### 1.4 旧兼容与版本

- `runtime/compat-catalog.mjs` 枚举 Desktop Commander 风格老接口；当前可见至少 21 个 `y_local_*` 历史接口，功能与 `y_file_*` / `y_search_*` / `y_process_*` 大量重叠。
- `runtime/compat-entry.mjs`、`runtime/compat-engine.mjs`、`compatibility/tool-names.mjs` 等承载老路由（包括 `yuki_` 到 `y_` 的别名）。
- `runtime/enhanced-server.mjs` 仍有旧显示用审批别名 `y_review_approval`；它不是用户批准本身。移除旧名之前确认 **最新审批卡片** `y_show_approval` / `y_approval_center` / `y_wait_approval` 的调用链、客户端资源和真实批准机制已完整可用。
- `engine/src/compat-adapter.mjs` 目前保留的适配器方法为报错占位，不等同必需核心能力；检查引用后可删。
- `docs/RC3_ARCHITECTURE_AUDIT_ZH.md`、`docs/RC3_HANDOFF.md`、`docs/RC3_DELIVERY_ZH.md`、`docs/VALIDATION.md` 记录了已有 rc.3 候选、风险与待测项。**rc.3 源码/候选包不代表当前 rc.2 已切换。**

## 2. 目标系统架构

```text
普通 ChatGPT 对话 A ─┐
普通 ChatGPT 对话 B ─┼─> 受信任 Chat Connector / 专用身份与授权
普通 ChatGPT 对话 N ─┘             │
                                  ▼
             YGPT Local (Chat-only Broker)
          ┌─────────────────────────────────┐
          │ 验证入口/来源、按对话隔离权限     │
          │ Typed 文件/搜索/任务/SQLite      │
          │ UIA 每次人工审批 + Agent 禁区     │
          │ Playwright Edge 独立上下文       │
          │ 资源归属、审计、冲突检查、恢复    │
          └─────────────────────────────────┘
                         │
                         ▼
                  Windows 本地资源
                         ▲
                         │
ChatGPT Desktop Agent ─> Agent 原生执行器 / 原生浏览器 / 原生工具
  （不依赖 YGPT；YGPT 不介入其进程、窗口、浏览器、任务）
```

**安全实现限制：** 单凭 MCP `clientInfo`、请求体中的 `mode=chat`、模型发来的“我是普通对话”等，均不能证明宿主类型。优先使用单独授权、单独 Connector/服务身份与独立配置，让 Agent 环境不持有 YGPT 的 Chat-only 凭据；若平台不能给出可信会话来源，不能虚报“已准确区分 Agent 与 Chat”，至少应做到入口隔离、资源所有权保护、禁止 Agent 资源目标以及敏感操作 fail-closed。更不能通过读取/修改 Agent 私有配置来换取隔离。

## 3. 工程任务及优先级

### P0-A：先建立安全工作区、基线与可回退版本

1. 阅读 `AGENTS.md`（如果有）、README、现有 docs/RC3_*、SECURITY、VALIDATION、完整工具目录/源文件/测试；确定现用分支、未提交修改、构建与运行入口。
2. 记录当前生产进程/隧道/插件版本（只读），不要终止；在独立分支与隔离数据目录进行修改和测试，防止抢占生产隧道身份。
3. 做实际工具映射清单：`工具名 -> 源码实现 -> 类别 -> 是否可见 -> 使用频次 -> 替代名称 -> 是否删除`，解释 94/92 数字差异。
4. 建立测试前状态、回滚与可恢复方案：保留 DPAPI 密钥、OAuth/审批状态、快照索引、重要用户文件和生产配置；禁止粗暴递归删除。
5. 将本任务书作为开发的主验收依据；生成设计/测试证据，不能只改文档。

**验收：** 清楚知道哪些文件与服务正在被使用，独立环境测试不接触生产 Agent 及 Tunnel。

### P0-B：真正的 Chat-only 与资源所有权边界

1. 定义经过可信连接层验证的客户端/会话身份模型，以及能力票据的来源、TTL、撤销方式。不信任模型直接传来的 PID、clientType、sessionId 作为授权。
2. 为 YGPT 自有的 Browser Context、Tab、UIA Binding、Process/Job、文件变更和审批操作分别建立 **owner/session/operation** 归属与生命周期。不同普通对话不能拿另一个会话的 ID 就读取其页面、输入进程或取消任务。
3. 检测并保护 Desktop Agent 的进程及进程树、窗口和浏览器会话；基于确切系统身份（可执行路径签名/哈希、PID + 创建时间、进程树、可信所有权证据），避免名称字符串或裸 PID 误判。找不到可信归属时不执行敏感操作。保护名单不能误伤 YGPT 自己的工作。
4. 严禁 YGPT 将其浏览器绑定到 Agent 的 CDP、调试端口、个人 Profile；禁止通过 UIA 控制 Agent 的主窗口及其 owned children。
5. 普通脚本/终端无 OS Sandbox 的事实不能靠正则扫描完全补救。加入 Agent 资源硬拒绝、子进程所有权检查、有限任务组/Job Object、批准前目标明细；**如果用户授予任意代码执行，则必须明确标注无法证明绝对隔离，不得假装所有副作用可被隔离**。
6. 如果宿主无法可靠验证 Chat 与 Agent 来源，以凭据/连接分离作可执行方案；UIA/进程敏感目标仍强制所有权审查，不以来源推断替代目标校验。

**验收：** 普通对话的 YGPT 操作不会关闭、抢焦点、写入 Agent 独占状态、终止 Agent 任务或接管其浏览器；不能越权使用其他对话的任务 token。

### P0-C：Desktop UIA 持续可用 + 默认真正的人工审批

**必须保留且可调用**：`y_desktop_windows`、`y_desktop_bind`、`y_desktop_inspect`、`y_desktop_value`、`y_desktop_action`、`y_desktop_screenshot`。

- `windows` 只返回必要的公开窗口元数据时可自动允许；敏感窗口标题/文本/截图应有脱敏或审批。
- `bind` 默认需要真人“Allow once / Deny”。建议 UIA 树/值/截图在初次绑定时由精确窗口授权覆盖；`action` 中 focus、click、invoke、type、setValue 均须审批（默认逐操作）；可由用户明确选择小范围、限时、同窗口的授权，禁止默默全局放行。
- 审批 UI 给出应用、窗口、动作、控件、可能输入内容摘要、风险与范围；**批准必须来自可信 UI 事件**，不是模型调用决定接口；执行后原请求恢复，不重放。
- 精确绑定到 `exe path + exe SHA + pid + birth + hwnd + 绑定时窗口身份`，执行前再次检查；窗口消失、替换、归属变更则拒绝，要求重新绑定。
- 当目标与 ChatGPT Desktop Agent、其原生浏览器或其进程树匹配时：即使是已登记应用，也 **硬拒绝控制**；普通第三方应用在真人批准后可正常 UIA 操作。
- 做真实的审批通过、拒绝、超时、撤销、跨对话 token、重复执行防护测试，验证 UIA 并未被禁用。

**验收：** 无批准不发生 UIA 输入/点击/焦点修改；授权后能实际操作合法应用，拒绝后无副作用；不会操作 Agent。

### P0-D：多对话并行与安全恢复

1. 并发同名调用默认是合法场景；不要假定日志近邻为两次重放，更不允许全局互斥导致一个对话运行时另一个对话阻塞。
2. 允许不同文件读、独立作业和不同浏览器 Context 并行；同目标写操作采用短粒度锁 + `expectedSha256`/预期版本检查 + 原子提交；有外部进程改动就报冲突，不覆盖。
3. `requestKey` 的幂等作用域必须绑定服务器认可的调用所有者与精确参数；同名、相近时间或同一内容不代表相同操作。
4. Browser tabs 必须按对话/受权工作区隔离；`y_browser_tabs` 不应列出未经该会话授权的页面；取消 A 的标签页不影响 B。
5. Job/process 输出 token 必须绑定具体原调用者；浏览器/任务中的慢操作有独立超时与恢复，不占用另一个会话的调度资源。
6. `unknown` 任务仅允许只读查询、明确人工恢复或核对；不自动重放。复查历史 `job_submit` unknown 的具体证据，避免擅自重跑。

**验收：** 至少三路并行对话：A 长任务、B 文件读写、C Browser/UIA；所有权和吞吐稳定；同文件并发修改明确冲突，互不破坏。

### P1-A：Browser 保留、按需开放并加强会话隔离

- 保留 Playwright + Edge，`chromium.launch({channel:'msedge', headless})`，独立 Context；启动只发生在实际 Browser 任务时，空闲释放。
- 不连接到 Desktop Agent/用户日常浏览器；分对话或授权工作区创建 Context，分隔 Cookie/Storage/Tab IDs。
- 继续验证 URL、请求、重定向、资源与下载路径；来源域名由用户配置，禁止 Cookie/Token 泄漏、跨站跳转绕过。
- `y_browser_tabs` 返回当前授权会话自身的 Tab，不公开所有任务的网页内容。
- 浏览器以网页语义交互为主；UIA 以 Windows 原生窗口交互为主；不要重新包装一套功能完全相同的“通用浏览器”接口来增加工具数量。
- Browser UI 交互/上传/下载的人工审批与不可逆动作识别需真实测试。

**验收：** 与个人 Chrome、Agent 浏览器并存且 Profile 隔离；可同时独立浏览多个授权站点，关闭本会话 Context 不影响其他会话。

### P1-B：直接清理旧兼容接口，保留一套最新版工具

**允许删除，而不是长期留一套 deprecated。** 但必须先完成代码引用清单和替代测试：

- 删除旧 `y_local_*` 兼容目录/发布接口（当前可见 21 项）及不再需要的 `get_config` / Desktop Commander 风格工具；转用 `y_file_*`、`y_search_*`、`y_process_*`、`y_job_*` 等新版类型化工具。
- 删除 `yuki_*` 的历史名称转换（若新接口和安装向导/文档/插件技能都已不再使用）。
- 审查 `runtime/compat-catalog.mjs`、`runtime/compat-entry.mjs`、`runtime/compat-engine.mjs`、`engine/src/compat-adapter.mjs`、`compatibility/tool-names.mjs`，删掉没有新路径依赖的真实无用代码；避免留下只会报错的旧适配器。
- 清理旧审批显示别名（如 `y_review_approval`）前先保证最新 UI 卡片及其 `show/wait/center/close` 主链可用；不要误删真实批准机制。
- `job_submit` 与 `y_job_submit`、`recent_calls` 与 `y_recent_calls` 等，逐项选定 **一个 canonical 公开名称**，迁移内部调用后删除不必要的多份入口，不得误删不同语义的功能（短生命周期 process 与 durable job 仍有各自必要性）。
- 老工具删掉后重新生成 MCP Catalog、Skill、README、安装包缓存和回归测试，确保 GPT 在新会话确实只看到最新 API。
- 只清理仓库/候选包中可证明废弃的部分，**不得在未经授权下直接删除当前生产 rc.2 安装目录、生产使用的旧组件、私人状态库、备份或另一安装身份**。待切换并验证不再被引用后再执行专门的清理。

**验收：** 无重复公开接口；新版工具全覆盖原有必要场景；新会话没有混用旧名称；审批、安装、恢复、备份都通过。

### P1-C：新增/增强工具——不是凑数量

| API | 设计需求 | 注意避免的重复 |
| --- | --- | --- |
| `y_usage_report` | 受限时间范围（如 24h/7d）统计真实调用量、成功/失败/unknown、时延分布、来源和会话维度（仅在来源可信时标注）；安全脱敏 | 不能仅重命名现有 `y_recent_calls` |
| `y_file_read_many` | 类型化批量读取，多路径上限与每文件字节限制、单文件局部失败、每项 SHA 与来源路径 | 用来**替换**旧 `y_local_read_multiple_files`，不并存两个同功能入口 |
| `y_file_patch` | 预期 SHA、统一补丁/精确 hunks、dry-run/差异预览、原子应用、结果 SHA、快照 ID、冲突错误；敏感文件审批 | 底层复用 `y_file_edit` 已有 `expectedSha256` 和备份能力，不另造易丢数据的写引擎 |
| `y_project_inspect` | 一次读项目结构、Git 状态/分支、包管理任务、最近变更摘要；严格限定目录与输出大小 | 编排现有 file/search/read-only Git，不允许借聚合接口绕过原审批 |
| `y_file_trash` | 受控软删除到 Windows 回收站、可追踪恢复 ID、目录边界、防符号链接/重解析点、默认人工授权；恢复前冲突检测 | 不等于任意 `rm -rf`，不得承诺所有文件都可完整恢复 |
| `y_resource_owner` | 只读查询本实例 Browser/UIA/Process/Job/Context 的可信所有权和可执行操作，不提供越权接管 | 不以模型输入的 PID 或名称直接授权控制 |

可选：`y_capabilities` 返回按场景分组的可用工具/权限和真实运行版本（只读）。工具选择宜使用统一描述与清晰 Schema；底层工具少而准确，默认露出常用核心工具，Browser/UIA 始终可按需发现和调用（**不能把 UIA 隐藏到永远无法使用**）。

### P1-D：日志、性能、异常与状态管理

- 新增可靠、隐私安全的 `client/channel/session/operation/correlation` 归属记录；来源无法认证时标为 `unverified`，而不是猜测 Chat/Agent。
- 统计每类工具用量、耗时 p50/p95、错误类别、并发数、任务恢复率、资源占用。日志中不能包含 API Key、Tunnel 凭据、完整敏感文件内容、Auth Token 或个人浏览器信息。
- 统一错误码如 `TARGET_FOREIGN`、`APPROVAL_REQUIRED`、`STALE_PREIMAGE`、`SESSION_FOREIGN`、`RESULT_UNKNOWN`、`BROWSER_CONTEXT_CLOSED`。
- `y_recent_calls` 与 `y_engine_history` 若作用重复，整合内部存储和查询；清晰保留只读状态查看与 `call_status/call_result` 的恢复语义。
- 支持多对话并行、背压、队列限制和防饥饿，而非采用一个无界全局锁。

### P2：Installer、长期稳定性与上线

- 基于现有 rc.3 分支和候选安装器处理后续开发，保留现有英文 UI、独立 Watchdog、隧道与所有者身份检查、DPAPI 与首次读取验收；不要无证据重写已经验证的组件。
- 安装/修复/升级/卸载对共享组件的引用计数/身份检查必须严格，严禁误停另一个 YGPT、ChatGPT Desktop Agent 或其原生工具。
- 保持登录自启/断网恢复、Unknown 不重放、审批恢复、恢复/撤销能力；不改变系统 PowerShell 执行策略。
- 新候选在隔离 Profile、目录、Tunnel 身份下完成测试，再进行真实 ChatGPT Host 验收。**由用户决定是否切换生产**。RC3 旧开发测试不自动等于下一版通过。
- 实测用户现有单机多对话并发、不同 Claude/Codex 工作目录、受保护 Agent 环境、合法第三方应用 UIA、Playwright Browser、不含 secrets 的正式安装流程。

## 4. 必须执行的测试矩阵

| 测试 | 预期 |
| --- | --- |
| 同时 A/B/C 三个普通对话读取不同文件 | 可并行，响应无互相阻塞、无跨会话泄漏 |
| 多对话近乎同一时间调用相同读工具 | 各自收到合法结果，不误报重放 |
| A/B 同时写同一文件，且外部 Agent 已改动该文件 | SHA 不匹配的一方报冲突，不覆盖 |
| A 启动长任务，B 进行文件读取和 UIA 浏览 | B 不被 A 的任务整体阻塞 |
| A 使用 Browser Tab ID 尝试访问 B 的标签页 | 强制拒绝 |
| A 用 B 的 process/job token 取消任务 | 强制拒绝 |
| YGPT 试图绑定 Agent 的窗口/浏览器/进程 | 服务端拒绝，不改变焦点或状态 |
| 绑定白名单内的正常第三方窗口但未批准 | 不发生 UIA 控制，展示人工授权 |
| 点击 Allow once | 恰好执行所批准的目标动作一次 |
| 点击 Deny / 审批超时 | 不执行、不自动重试、不再次提交命令 |
| YGPT 启动 Playwright Edge | 不复用个人 Chrome/Agent Profile，不开启他人 CDP |
| UIA 和 Browser 同时运行 | 二者均可用，Browser 不冒充 Desktop UIA |
| 清理旧工具后开启全新 GPT 对话 | 工具列表只含最新 canonical API，无空缺 |
| 模拟作业提交响应丢失 | 查询/恢复状态，不自动重复执行 |
| 新安装、断网、恢复、卸载 | 只影响本安装自身资源，生产和 Agent 不受影响 |
| 高危操作审批与撤销 | 仍完整可靠，模型不能自行批准 |
| 工具使用报告生成 | 真实统计、会话可归因，未知来源如实标识 |

**测试纪律：** 应在隔离桌面测试夹具或独立应用上验证 UIA，不能把真实 ChatGPT Desktop Agent 当成可试错的目标；可通过模拟受保护进程/窗口身份来测试拒绝规则。不得运行未获用户授权的真实破坏性操作。

## 5. 交付物与完成判定

**Claude 必须交付：**
1. **源码修改**：Chat-only 身份/入口隔离；资源所有权/并发保护；UIA 人工审批；Browser 会话隔离；新版 API；重复/旧接口清理。
2. **工具增删对照表**：每个删除的旧接口对应哪个新接口，何处已迁移；更新后的准确 MCP 工具数；新增工具 Schema 与样例。
3. **安全审计报告**：能保证什么、不能保证什么（尤其任意 Shell 执行、宿主来源识别、跨进程文件竞争）；Agent 保护的证据和边界。
4. **自动化与实测报告**：测试名称、通过/失败/跳过、环境、时间、构建版本和 SHA、复现方法；不能把模拟结果标成 ChatGPT Host 真正通过。
5. **最新候选构建**：隔离测试的可安装包/便携包、完整变更记录及回滚说明；保留生产 rc.2 直到用户批准切换。
6. **操作指南**：面向用户简短说明新 UIA 审批、Browser 启用、多对话并发、如何从错误中恢复。

**完成判定：**
- UIA **保留且真正可用**，默认可信人工审批；
- YGPT 对话能力强，但不碰 Desktop Agent 的独占工作；
- 多对话可并发，隔离、防冲突及 Unknown 恢复有实测；
- Browser 保留 Playwright Edge 独立机制，不错误接管别的浏览器；
- 重复和遗留 API 实际删除，唯一 canonical 新目录明确；
- 新增工具补的是具体缺口，而非重复包装；
- 生产环境和私有凭据完整保留，用户最后验收前不擅自切换。

## 6. 建议 Claude 执行顺序

1. 阅读项目、建立真实工具/调用/引用清单与独立测试环境。
2. 修正 Chat-only/Agent 资源边界及可信授权模型。
3. 实现 UIA 默认人工审批、跨会话资源所有权。
4. 补强 Browser per-chat Context 和多对话并发、写冲突、Unknown 恢复。
5. 实现新增 API，替代并清除旧兼容入口与无用代码。
6. 完整单测、集成、生产模拟与安装生命周期测试；修复失败项。
7. 构建新候选、交付差异/测试/剩余风险供用户验收，**不自动生产切换**。

---

**执行指令（交给 Claude）：**

> 请以本文件为主验收规格，直接在 YGPT Local 本地仓库中实施下一版整体升级。先读取实际代码和已有项目文档，不凭本任务书的采样数据断言最新状态。工作过程中优先保护运行中的 ChatGPT Desktop Agent 和 rc.2 生产隧道。允许在新候选中直接删除旧兼容接口与无用实现，不要求维持过时 API；必须完整迁移并验证替代路径。保持 Desktop UIA 始终开放且默认人工授权，Browser 保留隔离的 Playwright Edge。多对话并发是必须支持的正常状态。最终提交可核验的源代码、测试结果、工具映射、安装候选和风险报告；未经用户明确授权，不对现有生产环境执行切换、清理或破坏性改动。
