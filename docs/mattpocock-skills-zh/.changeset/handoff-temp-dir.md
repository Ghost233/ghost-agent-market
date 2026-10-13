---
"mattpocock-skills": patch
---

`handoff` 现在明确操作系统临时目录的位置：优先 `$TMPDIR`，否则 `/tmp`；Windows 使用 `%TEMP%`，让代理不再猜测（#272）。
