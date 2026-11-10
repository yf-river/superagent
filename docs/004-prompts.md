# 004 Prompts

本地 Router 和 Worker 的固定说明位于 src/app/local-prompts.ts。Router 只准备目录和分派，Worker 读取原始需求、仓库指令及用户后续聊天。任务以标准预设创建，会话内模型、工具及用户选择沿用 DSH。

提示词设置提供 communication、scope、delivery 和自定义 skills。保存带 revision，历史版本可查看和回退。固定说明可通过明确的 part key 覆盖，生成模板必须保留其必需占位符。

技能列表只含用户配置的技能，没有 GitHub/飞书内置技能。模型可见的需求、附件和后续输入通过 DSH 的注入或消息接口进入持久化 Session。
