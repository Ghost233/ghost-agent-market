---
"mattpocock-skills": patch
---

`diagnosing-bugs` 第 5 阶段现在要求代理将强制突变后的副本与原始副本做 `diff`，再相信红色结果。这样，实际上没有改变任何内容的编辑，就不能算作失败测试（#955）。
