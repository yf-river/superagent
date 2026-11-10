# 006 Deployment

需要 Node 24.9+、pnpm 和 DSH 0.2.2-rc.1。执行 pnpm install --frozen-lockfile、pnpm typecheck、pnpm test、pnpm build。在目标 DSH profile 中运行 dsh plugin --profile web add "link:$PWD"，随后重启对应 DSH 实例。

现有 Web profile 可以直接加载 bundle；无需外部账号或独立端口。stateDir 默认为 DSH_HOME/state/superagent。Router 的模型在诊断设置中配置；任务会话使用 DSH 的模型及用户选择。桌面远程模式要求宿主 Remote 允许 superagentTasks/request，客户端同时加载 bundle UI 并设置 clientOnly: true。

升级前备份 SQLite、附件及 bundle 构建产物。schema 13 在同一事务中升级 schema 12，删除旧外部渠道工单和 Outbox，清除优先级/日期属性，保留本地任务及已有 Worker Session 关联。迁移失败事务回滚。版本 12 以前的数据库拒绝启动；不支持降级。

本地任务协议使用独立的 Router 会话键 local-router-session。首次启动建立新的 Router 会话，避免把包含旧渠道工具的协调记录继续送给模型；旧 Router 会话日志保留，普通重启继续复用本地 Router 会话。

验收应使用独立测试任务：保存不调用模型；打开准备 shared 和 worktree 各一次、不执行；开始后收到真实 Worker 结果；确认和重开保留 Session 与目录；重启后恢复准备和执行。浏览器检查原生聊天、完全权限、看板滚动、窄屏与侧栏折叠。
