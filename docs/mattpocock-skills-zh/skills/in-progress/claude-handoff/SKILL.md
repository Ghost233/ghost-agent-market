---
name: claude-handoff
description: 将当前对话交接给新的后台代理，让它立即接续工作。
argument-hint: "下一个会话将用于什么？"
disable-model-invocation: true
---

为当前对话编写交接摘要，让新的代理继续工作。保存到用户操作系统的临时目录，再以摘要作为提示启动后台代理：`claude --bg --name "<descriptive name>" -- "$(cat <summary file>)"`。通过文件传入，可防止 shell 执行摘要中的反引号或展开 `$`。代理从当前工作目录启动，命令立即返回，用户通过 `claude agents` 管理它。

始终用 `-n`/`--name` 传入描述性名称，例如 `--name "Fix login bug"`。它设置任务列表、会话选择器和终端标题中的显示名称。

摘要中包含“建议使用的 skills”一节，写明下一位代理应通过 Skill 工具调用哪些 skills。

已在其他产物中记录的内容不重复写入，包括 specs、计划、ADR、issues、提交和 diffs。改为用路径或 URL 引用。

删去 API 密钥、密码、个人身份信息等敏感信息，因为摘要将成为代理的提示。

用户传入参数时，将其视为下个会话的工作重点，据此调整摘要。
