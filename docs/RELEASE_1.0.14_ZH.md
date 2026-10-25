# YGPT Local 1.0.14

授权卡必须使用原请求所属聊天的上下文。此前缺少或误用 contextToken 时，按钮被禁用，界面仍显示“等待授权”，模型还可能要求用户点击。

现在工具结构明确要求原 contextToken。缺失、不匹配或过期时，返回明确的恢复错误，approvalEnabled 与 continueWaiting 均为 false，不签发决定能力。卡片显示“Refresh approval”，隐藏不可点击的按钮。应从同一对话中找回原请求一起返回的 requestId、resultToken、contextToken，只刷新卡片；不能拿后来的浏览器上下文代替。原操作保持保存，不会重放。原上下文丢失时，由用户通过 Windows 授权中心处理。

普通授权组件采用新的版本化 URI，旧地址仍提供当前组件。补回原上下文后，同一请求可恢复正常卡片。桌面操控 Full Access 默认 100 分钟，仍需本人确认，仅对当前聊天有效，可撤销、到期；升级不延长旧授权。

已有安装使用 Update，欢迎在 GitHub Issues 反馈。
