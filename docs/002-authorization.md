# 002 Authorization

DSH 的权限预设管理工具操作权限。新建的普通会话和任务会话默认完全权限；应用默认值后用户的手动选择保留。子智能体遵循 DSH 的继承规则。

任务保存和目录准备不授予自动执行需求的权限。Router 收到 prepare_task_directory 时只能调用 orchestrator_prepare_task 选择目录。只有用户开始或拖到进行中，Task 才提交本地 Trigger，并由 Router 接受执行。

任务目录在会话创建前确定，绑定后不可编辑。shared 允许同目录并行，Worker 必须保留他人修改。worktree 隔离 Git 工作目录，但不复制未提交改动。取消、旧准备结果和过期命令通过状态、代次、revision 与 requestId 拒绝重复或迟到操作。
