---
"mattpocock-skills": patch
---

`wizard` 模板修复：`_existing` 解码双引号包裹的 `.env` 值，按回车保留当前值时不再把引号一并存入（#1220）；阶段在 `run_wizard` 内运行，执行途中编辑脚本不再导致退出（#1142）；`tput clear` 失败时 `_clear` 回退到 ANSI（#1081）；`write_env` 同时设置 shell 变量（#1041）；删除未使用的 `RED`（#1003）。
