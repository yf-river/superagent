# 003 Execution

首次打开：Task 持久化 preparation.routing，向 Router 发送目录选择请求。Router 调用 orchestrator_prepare_task。宿主持久化选择，验证或创建目录，再创建标准预设的原生 Session，并注入原始需求与附件；注入不会启动模型。

开始：准备就绪则立即提交执行；尚未准备则记录 startRequested，准备成功才提交。准备失败保留待办及可见错误，用户重试沿用已选目录。Git worktree 提前记录分支及 base commit，恢复时验证仓库和分支，已有目录直接复用。

执行器遵循 maxWorkers，排队和运行都显示在进行中。Worker 的 orchestrator_report 直接更新 Ticket 和本地任务：progress、waiting、blocked、failed 或 ready。需要用户处理时同时在正常聊天中写出问题，恢复时清除 human_action。任务 Session 保留原生工具，用户可手动调整模型和模式。

运行过的任务重试会创建新的 Assignment，复用已有 Session 与目录。Router 和旧执行结果不能替换绑定。取消会终止相关 Worker 工作；会话、附件及 worktree 不自动删除。
