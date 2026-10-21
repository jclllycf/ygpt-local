# YGPT Local 1.0.0-rc.3 交付

按最新指令完成纯英文界面与安装包，剩余功能测试由用户自行完成。现有 RC2 生产 Tunnel、插件、密钥与数据未切换；RC3 是独立候选，不把源码交付或本地健康误称为真实 ChatGPT 上线。

## 已完成

- 八页英文 WPF 向导，无其他界面语言或切换按钮；原创 Y 连接图标，SVG/ICO/PNG 全套。
- 独立静默 Watchdog、当前用户登录任务、数据/Tunnel 单实例；Secure 模式直接管理官方客户端与 stdio Broker/Engine，无 GUI 常驻，无额外 HTTP Supervisor。
- 有界重连、认证失败停止重复启动，不重放未知结果写入；维护检查活跃任务/审批及自身所有权。
- 官网字段教程、私有 Tunnel 认证说明、遮罩 Key、DPAPI、Keep / Replace / Test。
- 首次随机文件读取回执与清理门槛；默认开启且可取消，下载 Setup 额外授权，文件身份/哈希/引用与链接检查，保留维护与快照数据。
- 解决干净 Windows Restricted 策略启动障碍：改用限功能 NativeWindows.exe，不改系统执行策略。修复后未再启动 VM 测试。
- 安装器、便携包、SHA256SUMS、README 与故障排查更新。

## 交付入口

- dist/YGPTLocal-Setup-1.0.0-rc.3-win-x64.exe
- dist/ygpt-local-portable-1.0.0-rc.3-win-x64.zip
- dist/SHA256SUMS.txt
- assets/brand/ygpt-local.ico 与 ygpt-local-256.png
- docs/SETUP_GUIDE.md、docs/VALIDATION.md、docs/RC3_CLEANUP_INVENTORY_ZH.md
- 私有仓库 https://github.com/jclllycf/ygpt-local ，分支 release/1.0.0-rc.3

双击 Setup 即可开始；现有生产 Tunnel 正在使用，独立安装不可重复占用其身份。凭据只填本机向导。官方步骤暂缓，未替用户创建 Tunnel / Key / 插件。源码保留公开发布门槛，尚未创建公开 Release。

## 测量与限制

此前开发阶段 12 项回归、2 项新增原生检查分别通过；更早安装器有 25 条本机生命周期断言。它们不等于最终安装包验收。最终任务所有权保护、纯英文 GUI 与原生 helper 组合完成编译打包。

此前高级 local-only 模式 15 秒采样：Watchdog 私有内存 22.7 MiB，四进程合计 193.0 MiB，32 逻辑处理器整机 CPU 约 0.062%。不是 Secure Tunnel 实机资源结论。清理夹具累计删除两个文件 16 字节，不是生产空间回收记录。

待用户验证：最终包安装/修复、真实 ChatGPT 首次读取与审批、登录自启/断网恢复、清理后维护和文件恢复、Win10/Win11/DPI。安装器未做代码签名。
