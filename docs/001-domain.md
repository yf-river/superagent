# 001 Domain model

Task 保存需求、附件、版本及历史执行轮次。Preparation 保存 Router 选定的 shared/worktree 目录、准备状态和代次。Session 是任务的原生聊天记录，一个任务始终绑定同一个 Session。Ticket 是一次执行授权，Assignment 是该次执行的调度尝试。

保存的任务处于待办。首次打开进入 routing/preparing，但看板仍是待办。准备成功后 sessionId 与目录固定。开始进入进行中；没有空闲 Worker 时在卡片标注排队。问题、失败和阻塞进入待处理；ready 进入待确认；用户确认进入已完成。

后续聊天、重试和重新打开复用 Session 与目录。取消会使尚未完成的准备代次失效。Router 自己的 Session 独立于任务聊天。
