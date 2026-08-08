# Skill 机制

这是 [`writing-for-agents`](SKILL.md) 中专门针对 skill 的分支：说明文档作为 skill 时有哪些不同，包括 frontmatter、调用方式选择和路由 skill。其余写作原则均以 `SKILL.md` 中的通用参考为准。

## 调用方式

有两种选择，分别承担两类负载：

- **模型调用型** skill 保留 `description`，因此代理可以自主触发，其他 skill 也可以调用。用户仍然可以输入其名称：模型调用始终_包含_用户主动调用；description 只增加代理发现能力，不会移除人的调用能力。description 是 skill 的顶层上下文指针，始终加载，以永久上下文负载换取可发现性。内容完全是参考资料的模型调用型 skill 也可作为共享参考的唯一归属：其他 skill 能调用它，多个 skill 所需的资料因而只存一处。机制：省略 `disable-model-invocation`，并编写面向模型、覆盖各触发分支的 description；完整遵循 `SKILL.md` 中的指针写作规则。
- **用户调用型** skill 不让代理看到 description：只有人类输入名称才能调用，其他 skill 无法调用。它没有上下文负载，但会产生认知负载——人类必须记得它存在。机制：设置 `disable-model-invocation: true`；此时 `description` 面向人类，只写一行摘要，不列触发条件。

只有当代理必须自行触达该 skill，或其他 skill 必须调用它时，才选择模型调用。如果它始终由人手动触发，就设为用户调用型，避免上下文负载。

两个用户调用型 skill 共同需要的参考资料不能归属其中任何一方：没有 description，它们无法互相调用。将资料放到 skill 系统外的普通文件中，作为任何 skill 都可指向的外部参考。

## 按调用方式拆分

这是拆分中的“调用切口”（“顺序切口”见 `SKILL.md`）。当某个独特的引导词应当独立触发一套行为——且你确实会在提示中使用该触发词——或其他 skill 必须调用它时，拆出一个模型调用型 skill。新的 description 会始终加载并产生上下文负载，因此这种独立触达必须值得成本。

## 路由 skill

当用户调用型 skill 多到难以记住时，用**路由 skill**化解累积的认知负载：创建一个用户调用型 skill，列出其他 skill 及各自适用时机，让人只需记住一个入口。它只能提示，不能直接触发其他 skill；用户调用型 skill 没有对模型可见的 description，只有人类能够调用。
