---
name: implement
description: "根据规格或一组工单实施工作。仅在用户明确调用时使用。"
disable-model-invocation: true
---

实施用户在规格或工单中描述的工作。

尽可能在预先约定的接缝处使用 `/tdd`。

定期运行类型检查和单个测试文件，并在最后运行一次完整测试套件。

完成后，使用 `/code-review` 审查本次工作。

将工作提交到当前分支。
