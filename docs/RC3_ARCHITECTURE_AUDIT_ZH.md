# RC3 基线审计与实施边界

2026-10-21；开发分支 release/1.0.0-rc.3，基线 745bb8f。原始进程与任务证据保存在忽略的本机 .local/rc3 中，不发布私有配置。

当前生产为 rc.2，94 项工具，官方 Tunnel 的宿主初始化与 Engine ready。无 YGPTLocal.exe，实际为计划任务 → PowerShell Watchdog → 官方 tunnel-client → Node Broker/Engine。另有消费版安装目录中的 Node Supervisor/HTTP gateway、Broker/Engine 和 Tunnel；该 Tunnel 身份与生产不同，不能误判成同一连接的重复进程并结束它。

当前存在 HKCU Run 的 GUI --background 注册及独立生产计划任务。任务仍在 Running，其最近启动结果非零，不能据此认定当前连通性失败。RC3 对新的安装身份只注册一个当前用户登录任务，迁移只修改能证明属于本安装的旧注册，不结束外部连接。

| 需求 | RC2 | RC3 实现方向 |
| --- | --- | --- |
| GUI 退出后连接 | 生产已实测；消费版与生产架构不同 | 独立无窗口 Watchdog，不驻留 GUI |
| 单连接所有者 | GUI Mutex 仅按数据目录；旧脚本另行守护 | 当前用户、数据目录、Tunnel 身份互斥；启动前检查外部持有者 |
| 恢复 | GUI 固定间隔重启消费版 Supervisor | Watchdog 指数退避，鉴权失败暂停；不重放工具 |
| Secure Tunnel | 默认已选，但与高级项平级 | 推荐独立卡片，逐字段官网帮助；高级模式折叠 |
| 凭据复用 | 空输入框提示保留 | 明确已保存/尚未验证，Keep / Replace / Test |
| 首次真实任务 | HTTP 客户端活动只作诊断 | 独立随机只读标记、受保护回执；不把本地自测当 ChatGPT |
| 清理 | 未实现 | 按安装 Generation 登记、知情授权、文件身份/哈希与引用校验，退出后执行 |
| UI / 品牌 | 七页基础 WPF、默认系统图标 | 八页纯英文、维护折叠、原创 SVG/ICO/PNG；遵循用户最新语言要求 |

## 实施前的保留 / 自动删除 / 不确定清单

| 三态 | 对象 | 引用证据及条件 |
| --- | --- | --- |
| 保留 | 当前 Watchdog、Tunnel、Broker、Engine、Node、Python、App 资源 | 活动进程命令、配置、包内清单引用 |
| 保留 | 按需 Settings / Repair / Upgrade / Uninstall 入口 | 开始菜单和卸载注册引用；不需要驻留 |
| 保留 | DPAPI、owner/OAuth 状态、SQLite、审批账本、快照、回滚索引、用户文件 | 持久数据排除根；任何安装清理均不进入 |
| 自动删除候选 | 本 Generation 创建的独立 staging/cache 文件 | 精确登记、授权、文件 ID/哈希/边界复核；真实首次调用后、向导退出后 |
| 自动删除候选 | 用户明确选中并授权的当前 Setup 文件 | 额外逐文件授权、身份/哈希未变、没有运行/维护引用 |
| 不确定，保留 | 用户自行下载但未逐文件授权的 EXE / ZIP | 同名、相同版本或位于 Downloads 均不构成所有权 |
| 不确定，保留 | 旧 release、原生产目录、其他安装、缓存及重复组件 | 未经完整运行/维护/回滚引用证明，不清理 |
| 不确定，跳过 | 重解析点、被改写/替换、使用中、未知 sibling | 不强制结束进程；不递归扫删 |

本文件是当前审计和实施设计，不是 RC3 完成、真实宿主通过或公开发布证明。生产未更改。
