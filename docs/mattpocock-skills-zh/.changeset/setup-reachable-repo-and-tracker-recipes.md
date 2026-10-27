---
"mattpocock-skills": patch
---

`setup-matt-pocock-skills` 在写入 GitHub/GitLab 跟踪器前配置可访问的 Git remote（#1201），并提议用 `git mv` 将旧的 `CONTEXT.md` / `CONTEXT-MAP.md` 改为对应的 `GLOSSARY` 名称（#1176）。GitHub 模板先评论再关闭（#873），同时读取 PR 正文和评论（#1138），把**阻塞**移入约定并使用原生 `gh` 参数（#855），列出统计开放阻塞项的命令（#1118）。GitLab 模板用 `-O json` 列出 MR，并写明前沿查询命令（#1143）。重新运行 `/setup-matt-pocock-skills`，更新 `docs/agents/`。
