---
"mattpocock-skills": patch
---

`setup-matt-pocock-skills` 生成的 GitHub issue 跟踪器模板要求代理只在用户自己的仓库提交 issue，不提交到 `mattpocock/skills`，并在首次执行 `gh issue create` 前检查目标仓库。此前在该仓库的 clone 或 fork 中工作的代理曾把自己的规格和工单提交到上游（#541 至 #550）。
