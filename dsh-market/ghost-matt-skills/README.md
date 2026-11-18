# Ghost Matt Skills for DSH

原生 DSH Bundle，包含 **27 个 `mattpocock-skills-zh` 中文原版技能、Git 合并冲突 `git-merge-conflict`、工单粒度检查 `refine-issue` 和 DSH 专用 `spec-delivery`**，共 30 项。使用 `package.json` 的 `dsh.bundle.patch` 和 Cordis provider 注册到 `ctx.skills`，没有复用 Codex plugin/marketplace 清单。

## 安装

当前版本为 `0.2.1`。从 [GitHub Release](https://github.com/Ghost233/ghost-agent-market/releases/tag/dsh-ghost-matt-skills-v0.2.1) 安装：Desktop 在 Plugins 的 Bundle 安装入口使用以下安装包 URL；Web CLI 使用下方命令。已有同名 Bundle 时安装新版本，然后重启 DSH。

```text
https://github.com/Ghost233/ghost-agent-market/releases/download/dsh-ghost-matt-skills-v0.2.1/dsh-ghost-matt-skills-0.2.1.tgz
```

```sh
dsh plugin --profile web add https://github.com/Ghost233/ghost-agent-market/releases/download/dsh-ghost-matt-skills-v0.2.1/dsh-ghost-matt-skills-0.2.1.tgz
```

需要验证未发布源码时，在仓库根目录使用 `npm pack ./dsh-market/ghost-matt-skills --pack-destination /tmp`，再安装生成的本地包。

安装到所用 profile 后检查并启动：

```sh
dsh --profile web --dump-config
dsh --profile web
```

安装后组合树应包含 `ghost-matt-skills`。更换已安装包版本后重新启动 DSH。Desktop 使用应用 Plugins 的 Bundle 安装入口，安装 Release 包；Desktop profile 由应用管理，不通过公共 CLI 修改。

卸载：`dsh plugin --profile web remove dsh-ghost-matt-skills`。仅影响所选 profile。插件卸载时 provider 注销，技能不再出现在目录中。

## 使用与行为边界

在 DSH 的技能选择器中选择技能；手动技能须由用户显式选择，不把 Codex 的 `$skill` 当作 DSH 命令。自动可用技能可通过宿主的 `skill({ name })` 加载。`catalog.json` 列出全部技能、来源分组和调用策略。

Matt 中文版维持原始行为；例如 `implement-spec` 在独立 worktree 上并发构建并合入集成分支，PR 仅在跟踪器需要或用户要求时创建。

在技能选择器中显式选择 `git-merge-conflict`，处理复杂的 merge、rebase 或 cherry-pick 冲突。技能附带只读脚本，按两侧提交历史核对每块冲突。

`refine-issue` 从当前对话识别任务及关联工单，用子代理逐项检查粒度；需要细分时准备简报并衔接同包的 `to-tickets`。若 `to-tickets` 需要用户显式调用，通过 DSH 界面的技能选择器选择它。仅要求检查时止于判断和简报。面向用户的解释和回复使用中文。

`spec-delivery` 使用 DSH 原生 agent team：Lead 协调共享任务板，实现成员按文件归属并行开发，审查成员按 Standards 和 Spec 两个轴并行审查。成员共享 checkout，Git 与集成由 Lead 串行执行；逐阶段审查、复盘并清零 P0/P1/P2，合并阶段 PR 后总审查并提交总 PR。仅在用户明确要求时合并总 PR。

运行 `spec-delivery` 前，需在宿主 Plugins 中启用 [Agent Teams](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/agent-team-profile/README.md)，确认存在 `spawn_teammate` 和 `team_task_*` 工具。缺少能力时报告阻塞，不退回普通子代理或单代理实施。此 Bundle 只提供技能，不代替用户安装或启用 team 插件。

Matt 技能的平台适配仅转换技能引用、调用策略和子代理接口。子代理通过实际可用的 DSH spawn 型工具委派，继承宿主模型设置；不强制安装 Codex、不假装 DSH 支持 Terra/xhigh 参数。配置缺少必要委派能力时明确报告限制。Bundle 不注册新模型、不开启额外权限、不执行技能内脚本。

保留全部 references、模板、脚本和 Matt 的 MIT 授权；`resourceBase` 指向安装包内每个技能目录，独立于启动目录。Codex 的 `agents/openai.yaml` 转成 DSH invocation policy，不装入 DSH。

## 维护与验证

本轮内容同步至 Matt 上游 `5863806dd4e15c63174bee4e7515a4256792ecfa`（上游版本 `1.3.2`）。

Matt 源为仓库 `codex-market/plugins/mattpocock-skills-zh/skills` 的 27 项；`git-merge-conflict` 和 `refine-issue` 复用 `codex-market/plugins/ghost-agent-skills/skills` 中的同名目录。生成时保留 `git-merge-conflict` 的只读脚本，并将 `refine-issue` 的拆票入口适配为 DSH 技能选择器；DSH 专用源为 `dsh-market/skills/spec-delivery`，其平台差异在 skill 中说明。生成文件在 Bundle 的 `skills/` 与 `catalog.json`。修改源或平台映射后，运行 `node tooling/build-dsh-matt.mjs` 并增加此包版本；用 `--check` 只校验生成内容是否与源一致。构建不会修改 Codex/Claude/ZCode 源文件；Matt 清单数量变化会停止构建，要求核对范围。

验证不需要 API key 或付费模型，使用 DSH `0.1.6-alpha.1`（Node 24），验证依赖中包含 CLI 安装插件所需的固定 `pnpm 11.24.0`：

```sh
npm ci --prefix tests/dsh-runtime --ignore-scripts --no-audit --no-fund
node tooling/verify-dsh-release.mjs
```

测试覆盖实际 Cordis/DSH registry 注册、30 项完整加载、资源定位、手动/自动调用策略、卸载与重载。可向 `tests/test_dsh_matt_bundle.mjs` 传第三个参数作为安装后的 Bundle 目录，对 tarball 安装副本执行同样测试。此验证证明打包和加载，未运行付费模型、Agent Teams 开发或全部技能业务流程。

`0.1.1` 发布还使用 DSH-Workflow 固定的子模块 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`（CLI `0.1.6-alpha.1`）现有本地构建，在隔离 `DSH_HOME` 下完成 tarball 安装、`--dump-config` 组合及安装副本的 31 项 registry 测试；没有修改 DSH 源码或用户 profile，也没有重新构建该宿主。

官方格式依据：[Bundle 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)、[Skill registry 与调用策略](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)、[官方打包 provider 示例](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-badge/src/index.ts)。

## 自动发布

`.github/workflows/release-dsh-matt.yml` 在推送 `dsh-ghost-matt-skills-v<package.json 版本>` 标签时执行。先更新源、生成内容和版本并提交到 `main`，再推送相同提交的版本标签。标签与包版本不符、生成内容过期、安装或测试失败均阻止发布。PR 和手动 workflow_dispatch 只验证，不发布。

Actions 使用正式生成器构建 `.tgz`，验证包文件逐字节一致、隔离 profile 安装及 registry，再由独立最小写权限 job 创建新 Release、附完整包及 `SHA256SUMS`，回读公开下载进行字节比对。不替换同名 Release/资产，不修改既有 Latest 标记；重跑已发布标签会停止，后续变更须发布新版本。上传失败可能留下草稿，需人工检查，流程不自动删除或覆盖。

CI 不依赖开发机器的 DSH 子模块：`tests/dsh-runtime/package.json` 将 CLI 及 DSH 内部组件固定为 npm `0.1.6-alpha.1`，`package-lock.json` 锁定完整依赖树和 integrity。直接安装 CLI 的原始范围会混入 `alpha.2`，因此显式 overrides 保持本次验证版本。此可重复验证针对公开发行包，不声称从子模块 HEAD 重建了宿主；本地子模块现有构建的验证记录见上文。升级宿主时须同时审核 overrides、更新锁文件与版本断言并重新测试。
