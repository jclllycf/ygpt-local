# YGPT Local 1.0.11

普通授权保持在对话内，不再自动打开右侧面板。只有主动申请 Full Access 才允许弹出独立面板，决定后返回内联显示；两种卡片使用独立的版本化组件资源。

新增可选的 **Full Access + Administrator**。在对话中要求启用 Full Access 和管理员权限，或调用 `y_chat_access`，参数为 `action: "request_full"`、`administrator: true` 和授权分钟数。先确认聊天卡片，再在电脑上确认 Windows UAC。普通 Full Access 不触发 UAC。

管理员命令由当前聊天专用的临时执行器通过 `y_admin_run` 运行；普通文件和桌面工具仍使用普通 Windows 令牌。每条管理员命令最长 25 秒，输出有大小上限，需显式指定程序和参数。管理员命令可以修改系统文件和设置，到期不会撤销已完成的修改。

授权到期、撤销、关闭上下文或桥接断开后，执行器及其 Job 管理的进程树会退出。执行后失去连接的命令标记为结果未知，不会假称未执行。管理员权限不跨桥接重启保留，重新启用需要再次确认卡片和 UAC。取消 UAC 会保留普通 Full Access，但明确报告管理员权限未启用。当前支持同一 Windows 账户提权，不支持切换为另一管理员身份。

用户已报告 1.0.10 手机端 Full Access 实测成功，与本版自动化手机/桌面测试分别记录。原生传输和清理测试不代表已实测真人 UAC 确认，本轮没有提升真实聊天权限。Windows UAC 仍需在电脑操作，模型或手机聊天卡片不能替代它。

已有安装请使用 Update。欢迎在 [GitHub Issues](https://github.com/jclllycf/ygpt-local/issues) 反馈，附件中请移除凭据及私人数据。
