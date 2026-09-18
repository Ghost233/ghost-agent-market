# Ghost Matt Skills for DSH

原生 DSH Bundle，包含仓库当前的 **26 个 `mattpocock-skills-zh` 中文技能 + 5 个 `ghost-matt-*` 定制技能**。使用 `package.json` 的 `dsh.bundle.patch` 和 Cordis provider 注册到 `ctx.skills`，没有复用 Codex plugin/marketplace 清单。

## 安装

从仓库根目录打包，命令不发布 npm：

```sh
node tooling/build-dsh-matt.mjs
mkdir -p dist
npm pack ./dsh-market/ghost-matt-skills --pack-destination ./dist
```

已有 DSH CLI 的用户在所用 profile 安装生成的包（路径替换为实际绝对路径）：

```sh
dsh plugin --profile web add /absolute/path/dsh-ghost-matt-skills-0.1.0.tgz
dsh --profile web --dump-config
dsh --profile web
```

安装后组合树应包含 `ghost-matt-skills`。更换已安装包版本后重新启动 DSH。Desktop 使用应用 Plugins 的 Bundle 安装入口，安装本地包；Desktop profile 由应用管理，不通过公共 CLI 修改。

卸载：`dsh plugin --profile web remove dsh-ghost-matt-skills`。仅影响所选 profile。插件卸载时 provider 注销，技能不再出现在目录中。

## 使用与行为边界

在 DSH 的技能选择器中选择技能；手动技能须由用户显式选择，不把 Codex 的 `$skill` 当作 DSH 命令。自动可用技能可通过宿主的 `skill({ name })` 加载。`catalog.json` 列出全部技能、来源分组和调用策略。

- `ghost-matt-spec`：规格规划；`ghost-matt-ticket`：拆工单。
- `ghost-matt-implement`：当前分支执行一轮开发、测试和反思审查，停下讨论，确认后再开始下一轮。
- `ghost-matt-run-test`：指定范围测试与分析，默认不修复；`ghost-matt-test-report`：只读汇总已有证据。
- Matt 中文版维持原始行为；例如 `implement-spec` 仍包含其原版 PR/worktree 流程，不与定制 `ghost-matt-implement` 混为一谈。

平台适配仅转换技能引用、调用策略和子代理接口。子代理通过实际可用的 DSH spawn 型工具委派，继承宿主模型设置；不强制安装 Codex、不假装 DSH 支持 Terra/xhigh 参数。配置缺少必要委派能力时明确报告限制。Bundle 不注册新模型、不开启额外权限、不执行技能内脚本。

保留全部 references、模板、脚本和 Matt 的 MIT 授权；`resourceBase` 指向安装包内每个技能目录，独立于启动目录。Codex 的 `agents/openai.yaml` 转成 DSH invocation policy，不装入 DSH。

## 维护与验证

源为仓库 `codex-market/plugins/mattpocock-skills-zh/skills` 的 26 项，以及 `codex-market/plugins/ghost-agent-skills/skills/ghost-matt-*` 的 5 项，不是网络上未审核的更新。生成文件在 `skills/` 与 `catalog.json`；修改源或平台映射后重新运行构建，增加此包版本。构建不会修改 Codex/Claude/ZCode 源文件；清单数量变化会停止构建，要求核对范围。

验证不需要 API key 或付费模型，使用 DSH `0.1.6-alpha.1`（Node 24）：

```sh
npm install --prefix /tmp/dsh-validation --ignore-scripts --no-audit --no-fund @deepseek-ai/dsh@0.1.6-alpha.1
node tests/test_dsh_matt_bundle.mjs /tmp/dsh-validation
```

测试覆盖实际 Cordis/DSH registry 注册、31 项完整加载、资源定位、手动/自动调用策略、卸载与重载。可传第三个参数为安装后的 Bundle 目录，对 tarball 安装副本执行同样测试。此验证证明打包和加载，不代表已运行 31 个技能的所有业务流程。

本次发布还使用 DSH-Workflow 固定的子模块 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`（CLI `0.1.6-alpha.1`）现有本地构建，在隔离 `DSH_HOME` 下完成 tarball 安装、`--dump-config` 组合及安装副本的上述 registry 测试；没有修改 DSH 源码或用户 profile，也没有重新构建该宿主。

官方格式依据：[Bundle 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)、[Skill registry 与调用策略](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)、[官方打包 provider 示例](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-badge/src/index.ts)。
