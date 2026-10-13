---
"mattpocock-skills": patch
---

`wizard` 模板修复：`ask` 使用 Readline，方向键可移动光标（#741）；`write_env` 用单引号包裹值，使空格、`#`、`$` 和引号在 `source` 及 dotenv 中保留（#770）；找不到浏览器打开器时，`open_url` 打印需自行打开的提醒（#774）；`write_env` 会穿过符号链接写入 `.env`，并保留已有文件的权限（#811）；`ask` 和 `ask_secret` 在 EOF 时失败退出，不再循环（#852）。
