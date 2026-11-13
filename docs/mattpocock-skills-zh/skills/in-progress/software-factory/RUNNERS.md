# 运行器

> 调研时间为 2026 年 10 月，不保证仍然准确。先用它了解分类，再自行调研当前选项：产品、价格、限制和 beta 状态变化很快。

运行器是**可丢弃的**：每次运行从一台全新机器开始，结束后不留下内容。有五种类型可填充这个位置，主要区别在于谁拥有代理循环、谁拥有机器：

| 类型 | 代理循环 | 机器 | 还承担的位置 |
| --- | --- | --- | --- |
| CI 运行器 | 用户自己的循环，位于 CI job 内 | CI 厂商或用户所有 | 编排器、可观测性平台 |
| MicroVM API | 用户自己的循环，位于编排器或运行器中 | 提供商所有 | 无 |
| 集成代理平台 | 厂商所有 | 厂商所有 | 部分编排器、可观测性平台 |
| 自带 worker | 厂商所有 | 用户所有 | 部分编排器、可观测性平台 |
| 自有 VPS 或容器 | 用户所有 | 用户所有 | 无 |

运行器可以按每次运行选择：审查使用低价 CI 运行器，实施使用 microVM，是正常的设计。

## CI 运行器

Git 平台自己的 workflow 引擎为每个 CI job 启动一个新的 VM 或 pod，代理 CLI 是 job 中的一步。编排器通过 workflow 触发器（issue、PR、定时或手动派发）启动运行，并用并发组防止两次运行处理同一工单。托管运行器天然可丢弃；自托管运行器通过临时模式实现，每个 job 一个 pod，完成后删除。按分钟计费。

**适用时机**：Git 平台是 GitHub 或 GitLab，且触发器均来自 Git 平台事件或时钟。此时 workflow 文件承担编排器，运行页面承担可观测性平台，一个产品填充三个位置。

参考入口：

- [GitHub Actions](https://docs.github.com/en/actions/reference/limits)：全 GitHub 工厂的默认选择；另见[价格](https://docs.github.com/en/billing/reference/actions-runner-pricing)。
- [Claude Code GitHub Action](https://code.claude.com/docs/en/github-actions)：把 Claude Code 作为 workflow 的一个步骤。
- [GitLab 托管运行器](https://docs.gitlab.com/ci/runners/hosted_runners/linux/)：每个 job 一个临时 VM。
- [Actions Runner Controller](https://docs.github.com/en/actions/concepts/runners/actions-runner-controller)：自托管，在用户的 Kubernetes 上每个 job 使用一个临时 pod。

## MicroVM API

通过一次 SDK 调用，在约一秒内创建隔离的 microVM（厂商称为“sandbox”）；编排器在其中执行命令或启动代理 CLI。按 vCPU 和内存的使用秒数计费。编排器为每次运行创建一个 microVM，结束时销毁，并设置超时作为后备保护。提供商也销售暂停恢复、快照和驱动器等持久化能力；工厂将它们用作缓存，跨运行记忆仍保存在工单跟踪器、Git 托管平台和编排器中。

**适用时机**：工厂有自己的编排器（服务器或队列），需要大量短暂并行运行，又不想管理机器。比较最大运行时长、并发上限，以及等待模型时是否计费：截至 2026 年 10 月，Vercel 只对活跃 CPU 计费，等待模型几乎免费。

参考入口：[E2B](https://e2b.dev/pricing)、[Daytona](https://www.daytona.io/pricing)、[Modal Sandboxes](https://modal.com/docs/guide/sandboxes)、[Vercel Sandbox](https://vercel.com/docs/vercel-sandbox/pricing)。

## 集成代理平台

托管编码代理自带运行器：厂商为每次运行准备新的 VM 或容器，在其中运行自己的代理循环，再推送分支或 PR。只有分支持久保留。运行可由 Git 平台或工单跟踪器中的 @ 提及或分配、聊天消息、定时安排或 HTTP 调用启动，因此平台承担了编排器的大部分功能；会话记录视图承担可观测性平台。费用包含在席位或订阅中，或按运行计费。

**适用时机**：用户希望减少需要维护的组件，并接受该厂商的代理。确认触发方式覆盖用户的工单跟踪器。

参考入口：

- [Claude Code cloud](https://code.claude.com/docs/en/claude-code-on-the-web)，其[定期任务](https://code.claude.com/docs/en/routines)支持 cron、API 和 GitHub 事件触发。
- [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview)：API 优先；针对环境创建运行并流式读取事件。
- [Codex cloud](https://developers.openai.com/codex/cloud)：每项任务一个容器。
- [Copilot coding agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)：将 issue 分配给 Copilot，运行器是 GitHub Actions runner。

## 自带 worker

集成平台保留自己的代理循环和运行队列，工具调用则在用户托管的 worker 上执行。worker 向厂商发起出站轮询，领取运行并执行，然后退出，形式与自托管 CI 运行器相同。可丢弃性由用户负责：在 Kubernetes 或 microVM API 下运行 worker，让每次运行获得全新磁盘。成本是厂商席位或用量费用加用户的机器成本。

**适用时机**：用户希望使用集成代理，但运行需要访问私有网络、把数据留在用户机器上，或使用定制硬件。

参考入口：[Claude Code 自托管环境](https://code.claude.com/docs/en/self-hosted-environments)、[Cursor 自托管池](https://cursor.com/docs/cloud-agent/self-hosted-pool)、[基于 ARC 的 Copilot coding agent](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment)。

## 自有 VPS 或容器

用户租用或运行机器，每次运行使用一个新容器或新机器：机器可以存活数月，容器只存活一次运行。最大运行时间取决于编排器设置的期限。可丢弃性由 `docker run --rm`、带 `ttlSecondsAfterFinished: 0` 的 Kubernetes Job，或运行结束后销毁机器实现；所有缓存都位于下一次运行可视为可选的路径中。费用可以是固定月费，也可以按运行秒数计费。

**适用时机**：运行时间长、负载稳定或较重，小时成本是主要因素，或已有服务器承载编排器。

参考入口：[Fly Machines](https://docs.fly.io/machines/overview)（[价格](https://docs.fly.io/about/pricing)）、[Hetzner Cloud](https://www.hetzner.com/cloud/) 加 Docker、[Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)。

## 继续调研

### 决定该位置的问题

结合工厂需要的运行，逐项核查候选产品：

1. **编排器如何启动它？** 使用 workflow 触发器、SDK 调用、@ 提及、HTTP 调用，还是由 worker 领取的厂商队列？是否适合方案中已选的编排器？
2. **最大运行时长和并发上限是多少？** 按套餐查找默认超时和最高上限，以及达到上限后的行为；对照方案中最长运行和最繁忙的突发量。
3. **费用如何计算？** 按分钟、vCPU 与内存的秒数、活跃 CPU、运行次数、席位还是固定月费？等待模型是否计费？模型 token 包含在价格中还是另计？
4. **如何实现可丢弃性？** 默认全新、使用临时标志，还是由编排器自己清理？有哪些持久化能力，方案能否只把它们用作缓存？
5. **运行能访问什么？** 私有网络、出站防火墙或允许列表如何配置，密钥如何送到运行器，还有谁能读取？
6. **还填充哪些位置？** 把可读取的触发器计入编排器覆盖，把运行页面或会话记录计入可观测性平台覆盖。

### 查找答案的位置

- 优先查看厂商的**限制或配额页面**和**价格页面**，而非宣传页面。
- 查看创建调用的 **SDK 或 API 参考**，核对超时、生命周期和网络参数。
- 查看**安全或网络文档**，核对防火墙、允许列表和密钥处理。
- 查看**变更日志或发行说明**，核对 beta、预览和正式发布状态，以及 Team、Enterprise 等套餐限制。
- 对 CI 运行器，查看 Git 平台的**计费文档**。

### 最容易过时的内容

- **价格和免费额度。** 截至 2026 年 10 月，GitHub 曾宣布对自托管运行器收取每分钟费用，随后推迟。
- **Beta、预览和抢先体验状态**，以及解锁功能的套餐。截至 2026 年 10 月，Claude Managed Agents 和 Claude Code 自托管环境均处于 beta。
- 按套餐划分的**默认超时和最长运行时间**。
- 集成平台的**触发器集成**，即哪些工单跟踪器和聊天工具能启动运行。
- **启动时间**通常是厂商声称的数值；重要时自行测量。

上述类型特征（谁拥有代理循环、谁拥有机器、填充哪些位置）变化较慢，比这里的任何数值更可靠。
