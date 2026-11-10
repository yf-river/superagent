# 008 Cookbook

## 修改任务行为

从 src/app/tasks.ts 的持久化状态与命令开始。task-api.ts 负责认证后输入，task-model.ts 定义记录和视图，task-tools.ts 提供聊天创建任务工具。修改字段必须同步 UI、模型工具、API 校验、迁移与 tests/tasks.spec.ts。

## 修改目录准备

Router 工具 orchestrator_prepare_task 接收 task_id、generation、execution_mode 和 execution_reason。目录创建在 executor/local-directory.ts，通过回调持久化分支及 base commit。准备完成前检查任务代次与取消状态，Session 创建失败保留可重试错误。

## 修改会话界面

src/client/index.tsx 注册看板与原生会话操作插槽，tasks.tsx 渲染任务控制。通过 DSH workspace.open 打开绑定 Session。不要新增独立聊天实现，也不要用会话名代替持久化 task/ticket/Session 映射。

## 验证

先 typecheck，再任务、迁移、真实 Git 目录与运行恢复测试。渲染检查使用真实 DSH 测试实例；使用真实模型确认 Router 选择和 Worker 执行。单元夹具只能证明状态机行为。部署仅重启指定 profile 对应实例。
