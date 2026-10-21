# RC3 清理清单与保留边界

这是隔离开发夹具记录，不是本机生产清理或 ChatGPT 验收。真实宿主首次调用由用户自行测试，未对生产下载目录执行清理。

| 对象 | 清理前 | 清理后 / 条件 |
| --- | --- | --- |
| 本 generation 登记的缓存 | 精确登记 | 两个文件累计删除 16 字节，重复执行不重复计数 |
| 后续改写文件 | 内容变化 | HASH_CHANGED，保留 |
| 后续替换文件 | 文件身份变化 | IDENTITY_CHANGED，保留 |
| 未逐文件授权 Setup | 缺少所有权授权 | NO_FILE_OWNERSHIP，保留 |
| 必需维护程序 | 存在引用 | REQUIRED_REFERENCE，保留 |
| 链接/不确定项 | 不可证明 | VALIDATION_FAILED，跳过 |
| 其他 generation | 不属于本次安装 | FOREIGN_GENERATION，保留 |
| 系统根对象 | 不在许可边界 | SYSTEM_ROOT，保留 |
| 已不存在对象 | 无文件 | ALREADY_ABSENT，不计本次删除 |
| Watchdog/Tunnel/Broker/Engine/运行时/管理程序 | 当前必需 | 保留 |
| 配置、DPAPI、账本、快照、回滚索引和用户文件 | 持久或用户数据 | 排除清理 |

脱敏逐项收据见 evidence/rc3-development.json。真正执行时，私有安装清理清单登记规范路径、文件 ID、大小、哈希、代际和授权；收据只记录条目编号、类别与原因。没有安全证据的重复组件不删除；不会递归清空目录，不调用卸载器。

开发用旧 payload、VM 夹具和历史安装包不属于消费者自动清理范围，本轮保留，未随意删除。
