# 可观测性平台

> 调研时间为 2026 年 10 月，不保证仍然准确。先用它了解分类，再自行调研当前选项：产品、价格、限制和 beta 状态变化很快。

本文帮助选择可观测性平台，或明确决定不使用。类型按**人需要看到运行内部的什么**划分：日志、代理追踪（每次模型调用和工具调用是一个 span），或与用户其他系统关联的追踪。后三种类型都可能是自托管或 SaaS。如果运行需要根据平台观察到的信息行动，应把平台作为工单来源：监控器创建工单，运行读取工单。

## 运行器如何接入

每种类型都通过以下五种接口之一接收数据。为位置选择产品时，同时说明使用哪种接口。

- **运行环境 OTel**：代理运行环境自行导出 OpenTelemetry。Claude Code 和 Claude Agent SDK 使用 `CLAUDE_CODE_ENABLE_TELEMETRY=1` 及 `OTEL_*` 变量；提示词和工具输出需要显式开启。Codex CLI 在 `config.toml` 中使用 `[otel]` 块。（[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/observability)、[Claude Code](https://code.claude.com/docs/en/monitoring-usage)、[Codex 配置](https://developers.openai.com/codex/config-advanced)）
- **平台推送**：模型平台代为发送追踪，例如 Claude Managed Agents 发送到 Claude Console 中设置的 OTLP 目标。（[Claude 文档](https://platform.claude.com/docs/en/manage-claude/opentelemetry/api)）
- **SDK 包装器**：在运行器代码中调用一次，例如 LangSmith 的 `configure_claude_agent_sdk()`。
- **Hook 插件**：Claude Code hook 在每次 Stop 时读取会话记录并发送，例如 Langfuse 的 Claude Code 插件。
- **网关**：运行器的模型基础 URL 指向记录日志的代理。无需改运行器代码，但只能看到模型调用，看不到运行环境内部的工具调用。

OpenTelemetry 是共同的传输方式：运行环境 OTel 和平台推送都可送到任何 OTLP 后端。GenAI 语义约定（`invoke_agent`、`chat`、`execute_tool` spans）仍在演进，应预期 span 名称会变化。（[OTel GenAI agent spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans)）

## 类型 1：不用额外平台

**是什么**：人直接在运行器或编排器已有界面中阅读运行，例如 CI 运行页面、沙箱仪表板或保存为运行产物的代理会话记录。无需接入额外接口；自托管程度随运行器而定，费用也包含在运行器中。

**适用时机**：每天运行次数少、只有一个人查看，问题只是“是否失败、打印了什么”。大多数工厂从这里起步；需要跨运行搜索、汇总每次运行的 token 或成本，或保留时间超过运行器提供的期限时再升级。

**参考入口**：[GitHub Actions 运行日志](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization)、[E2B 沙箱日志与指标](https://e2b.dev/docs)、[Daytona 沙箱遥测](https://www.daytona.io/docs/en/observability/otel-collection/)、[OpenAI Agents SDK 追踪](https://openai.github.io/openai-agents-python/tracing/)。沙箱产品通常也能通过 OTLP 转发相同数据，由此转向类型 2。

**需要核查**：各运行器产品的保留天数；有些沙箱保留很短（截至 2026 年 10 月，Daytona 为 3 天）。

## 类型 2：LLM 和代理追踪平台

**是什么**：围绕代理追踪设计的后端，每次运行表现为模型和工具调用树，包含 token 成本、提示词和会话，通常还提供评测与数据集。

**适用时机**：人需要跨多次运行了解“代理为什么这么做”，复盘运行或人员需要比较运行，或需要汇总单次运行的 token 花费。自托管开源产品可以把会话记录留在内部。

**类型特征**：接收运行环境 OTel、SDK 包装器或 hook 插件数据，通常也支持平台推送。按数据量计费；代理运行产生大量 span（每次工具调用一个），因此预算按每次运行而非每个请求估算。

**参考入口**：[Langfuse](https://langfuse.com/pricing) 和 [Arize Phoenix](https://phoenix.arize.com)（开源，可自托管）、[LangSmith](https://www.langchain.com/pricing-langsmith)、[Braintrust](https://www.braintrust.dev/pricing)。

**需要核查**：免费额度、计费单位（trace、span、unit 或 GB；Braintrust 于 2026 年 3 月改为 GB）、哪个套餐允许自托管，以及当前归属。

## 类型 3：通用 APM 和日志后端

**是什么**：用户已有的可观测性栈，涵盖所有服务的日志、指标和分布式追踪，并增加代理或 LLM 视图。

**适用时机**：团队已经为此付费；需要将运行与应用自身追踪关联（Agent SDK 传播 `TRACEPARENT`，运行可嵌入调用方追踪）；或已有监控工单来源从该平台读取数据。

**类型特征**：运行环境 OTel 直接发送到厂商 OTLP 端点。按 GB、事件或主机计费，工厂流量对已有账单可能微不足道，对新账单则可能超出预期。

**参考入口**：[Datadog Agent Observability](https://www.datadoghq.com/product/llm-observability/)、[Grafana Cloud](https://grafana.com/pricing/)、[Honeycomb](https://www.honeycomb.io/pricing)、[SigNoz](https://signoz.io/pricing/)（开源）。

**需要核查**：代理视图是正式发布还是预览，哪些运行环境提供配置指南，以及免费额度。

## 类型 4：带请求日志的 LLM 网关

**是什么**：位于运行器与模型提供商之间的代理，记录每次请求和响应，同时提供路由、密钥、预算和缓存。

**适用时机**：用户希望限制每次运行的花费，或为多个运行器使用统一的密钥库，并顺便获取日志；也适合运行环境没有自身导出能力时。它只能看到模型调用，需要结合类型 2 或 3 才能看到工具调用。

**参考入口**：[LiteLLM Proxy](https://docs.litellm.ai/docs/proxy/logging)（开源，可把日志转发到 Langfuse 或 OTel）、[Portkey](https://portkey.ai/pricing)。

**需要核查**：SaaS 的单请求价格，以及产品是否仍在积极开发（截至 2026 年 10 月，Helicone 被收购后进入维护模式）。

## 继续调研

逐项核查决定此位置的问题：

1. **运行器或编排器是否已经展示足够信息？** 比较人需要的跨运行搜索、每次运行成本和保留期，与运行页面或沙箱仪表板提供的功能。若已经足够，就明确选择不使用额外平台。
2. **代理运行环境如何导出追踪？** 先查运行环境支持哪几种接口，再查产品接受哪些接口。确认工具调用以 span 到达，以及提示词和工具输出是否需要显式开启。
3. **能否自托管？** 核对许可、允许自托管的套餐和运行环境。会话记录必须留在内部时，这一点具有决定性。
4. **费用如何计算？** 核对计费单位和免费额度；按每次工具调用一个 span 估算单次运行费用，再乘以每天运行次数。
5. **保留多久？** 比较各套餐保留天数与运行出错时人需要回溯的时间。

**查找答案的位置**：厂商价格页面（单位、套餐、保留期）；针对具体运行环境的集成文档；运行环境自己的监控文档（导出内容和 beta 标志）；OpenTelemetry GenAI 语义约定；产品仓库中的许可和发布活动；厂商变更日志或博客中的归属变化。

**最容易过时的内容**：免费额度和价格；beta 与预览标志（Claude Code 追踪导出、Console 平台推送、厂商代理视图）；归属和维护状态；计费单位；保留天数；GenAI span 名称。
