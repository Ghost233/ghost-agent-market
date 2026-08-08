# CONTEXT.md 格式

## 结构

```md
# {上下文名称}

{用一两句话说明该上下文是什么，以及为何存在。}

## 语言

**Order**：
{用一两句话说明该术语}
_避免使用_：Purchase、transaction

**Invoice**：
交付后发送给客户的付款请求。
_避免使用_：Bill、payment request

**Customer**：
下订单的个人或组织。
_避免使用_：Client、buyer、account
```

## 规则

- **明确作出取舍。** 同一概念存在多个词时，选定最佳词，并把其余词列在 `_避免使用_` 下。
- **保持定义严谨简短。** 最多一两句话。定义它_是什么_，而不是它做什么。
- **只收录当前项目上下文特有的术语。** 通用编程概念（timeout、错误类型、工具模式）不属于这里，即使项目大量使用它们。添加术语前先问：这是此上下文独有的概念，还是通用编程概念？只收录前者。
- 自然形成类别时，**用子标题对术语分组**。若所有术语都属于一个紧密领域，保持扁平列表即可。

## 单上下文与多上下文仓库

**单上下文（大多数仓库）：** 根目录只有一个 `CONTEXT.md`。

**多上下文：** 根目录的 `CONTEXT-MAP.md` 会列出各个上下文、它们的位置，以及彼此之间的关系：

```md
# 上下文地图

## 上下文

- [Ordering](./src/ordering/CONTEXT.md) — 接收并跟踪客户订单
- [Billing](./src/billing/CONTEXT.md) — 生成发票并处理付款
- [Fulfillment](./src/fulfillment/CONTEXT.md) — 管理仓库拣货和发货

## 关系

- **Ordering → Fulfillment**：Ordering 发出 `OrderPlaced` 事件；Fulfillment 消费这些事件并开始拣货
- **Fulfillment → Billing**：Fulfillment 发出 `ShipmentDispatched` 事件；Billing 消费这些事件并生成发票
- **Ordering ↔ Billing**：共享 `CustomerId` 和 `Money` 类型
```

本 skill 会推断应使用哪种结构：

- 如果存在 `CONTEXT-MAP.md`，读取它以找到各个上下文；
- 如果只存在根目录 `CONTEXT.md`，则为单上下文；
- 如果两者都不存在，则在第一个术语确定时按需创建根目录 `CONTEXT.md`。

存在多个上下文时，推断当前主题属于哪一个。不明确时询问。

