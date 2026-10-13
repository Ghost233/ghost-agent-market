# 仓库映射与验证入口

这里记录 Matt 更新特有的路径和检查陷阱。每轮执行时读取当前文件确认入口，
以当前上游清单和仓库配置确定数量、版本、依赖与发布范围。

## 源与发布入口

| 用途 | 仓库相对路径 |
|---|---|
| 上游子模块 | `upstream/mattpocock-skills/` |
| 上游正式发布清单 | `upstream/mattpocock-skills/.claude-plugin/plugin.json` 的 `skills` 字段 |
| Claude Code 中文源 | `claude-code-market/plugins/mattpocock-skills-zh/skills/` |
| Claude Code 插件清单 | `claude-code-market/plugins/mattpocock-skills-zh/.claude-plugin/plugin.json` |
| Codex 中文源、DSH 构建来源 | `codex-market/plugins/mattpocock-skills-zh/skills/` |
| Codex 插件清单 | `codex-market/plugins/mattpocock-skills-zh/.codex-plugin/plugin.json` |
| DSH 派生产物 | `dsh-market/ghost-matt-skills/`，含 `skills/`、`catalog.json`、`package.json` 和 LICENSE |
| Claude Code marketplace | `.claude-plugin/marketplace.json`、`claude-code-market/.claude-plugin/marketplace.json` |
| Codex marketplace | `.agents/plugins/marketplace.json`、`codex-market/.agents/plugins/marketplace.json` |
| 本轮记录 | `docs/mattpocock-updates/` |
| 独立资料和未发布内容的中文译文 | `docs/mattpocock-skills-zh/`，保留上游相对路径 |

ZCode 使用 Claude 格式的 marketplace，仓库没有单独的 Matt ZCode 内容副本。
共享 skill 目录使用上游 skill 名称，将 `engineering/`、`productivity/` 分类压平；
新增名称冲突须先解决映射，避免覆盖另一 skill。
根目录 README 记录已同步的上游提交，读取旧记录可发现 gitlink 与翻译进度不同的情况。

## 差异证据与报告

先分别记录父仓库 gitlink、子模块实际 HEAD 和 README 记录的翻译基线。
gitlink 决定子模块更新差异，翻译基线决定译文待同步范围；两者不一致时都记录并比较。
没有可靠翻译基线时，逐文件对照目标内容，注明基线未知。
下面命令在仓库根目录运行，`OLD_SHA`、`NEW_SHA` 为已记录的完整 SHA：

```sh
git ls-tree HEAD -- upstream/mattpocock-skills
git -C upstream/mattpocock-skills log --format='%H %cs %s' "$OLD_SHA..$NEW_SHA"
git -C upstream/mattpocock-skills rev-list --count "$OLD_SHA..$NEW_SHA"
git -C upstream/mattpocock-skills diff --stat "$OLD_SHA" "$NEW_SHA"
git -C upstream/mattpocock-skills diff --name-status --find-renames "$OLD_SHA" "$NEW_SHA"
git -C upstream/mattpocock-skills show "$OLD_SHA:.claude-plugin/plugin.json"
git -C upstream/mattpocock-skills show "$NEW_SHA:.claude-plugin/plugin.json"
```

报告按本轮实际进展填写，完成前补全以下证据：

- 基线、固定目标、默认分支或用户指定 ref、上游版本、标签、比较链接。
- 提交和文件差异、正式发布清单增删、行为变化及平台适配影响。
- 每个源文件的译文与产物路径、处理状态、原文保留原因；区分未变、已翻译、退役和未发布。
- 各插件新旧版本、marketplace 路径校验、译文与生成内容同步结果。
- 子代理发现、证据、修复或不采纳理由，以及审查限制。
- 验证命令、运行时版本、被验证的源码状态、退出码与结论；记录已存在的用户改动。

## 本地检查

先读 `tests/test_skill_packaging_contract.py`、`tooling/build-dsh-matt.mjs`、
`tests/test_dsh_matt_bundle.mjs`、`tooling/verify-dsh-release.mjs`、
`tests/dsh-runtime/package.json`、锁文件及 `.github/workflows/release-dsh-matt.yml`。
其他脚本发生变化时，补充它们对应的测试。

包装契约测试覆盖两端 skill 清单和 marketplace 路径、版本。
本仓库维护的 Python 测试使用 Python 3.9；选择真实的 3.9 解释器后运行：

```sh
python3.9 -m unittest discover -s tests -p 'test_skill_packaging_contract.py' -v
```

如果命令名不同，使用已核验版本的解释器绝对路径。
另外检查全部 Matt skill 的 frontmatter、本地链接和脚本语法，比较两端共享译文，
将允许的平台差异与实际内容逐项对应。既有包装测试不能证明这些翻译语义正确。

DSH 使用 CI 指定的 Node 版本与锁定 runtime，从 Codex 中文源生成：

```sh
node tooling/build-dsh-matt.mjs
npm ci --prefix tests/dsh-runtime --ignore-scripts --no-audit --no-fund
node tests/test_dsh_matt_bundle.mjs tests/dsh-runtime
```

验证生成器幂等性时，比较本轮生成后的内容快照与再次生成的内容，包含新增、删除和权限。
构建器没有清除退役文件的逻辑，须检查 DSH 目录与当前清单的精确一致性。

### 提交前与发布验证

`tooling/verify-dsh-release.mjs` 构建后执行 `git diff --exit-code`，比较工作区与索引。
已暂存的更新可以通过，未跟踪文件不参与该比较；通过不证明生成内容与 HEAD 一致。
先构建并核对最终清单，然后用临时索引保存本轮生成快照，运行完整验证器。
这样能验证再次生成的内容、包内文件、SHA-256、隔离安装及 registry 行为，
同时保留用户真实暂存区。若 npm 缓存或 Git 对象目录受保护，使用本轮临时缓存和对象目录，
通过 alternate objects 只读访问现有对象。pnpm 11 的 store 环境配置使用
`PNPM_CONFIG_STORE_DIR`；先用 `pnpm store path` 核对实际位置。
暂存前先核对仓库要求的 Git 身份：

```sh
(
  set -eu
  test "$(git config user.name)" = Ghost233
  test "$(git config user.email)" = only.yesc@gmail.com
  validation_dir=$(mktemp -d)
  trap 'rm -rf "$validation_dir"' EXIT
  validation_index="$validation_dir/index"
  GIT_INDEX_FILE="$validation_index" git read-tree HEAD
  GIT_INDEX_FILE="$validation_index" git add -- \
    dsh-market/ghost-matt-skills/skills \
    dsh-market/ghost-matt-skills/catalog.json \
    dsh-market/ghost-matt-skills/LICENSE
  GIT_INDEX_FILE="$validation_index" DSH_RELEASE_DIR="$validation_dir/release" \
    node tooling/verify-dsh-release.mjs
)
```

所有本轮新增和退役生成文件都须包含在快照中。临时索引比较之外，核对目录与
当前清单的精确一致性，并记录未跟踪文件，避免漏掉未进入比较的内容。
验证器在临时 `DSH_HOME` 下安装，不写用户实际 profile；按实际结果记录并清理本轮临时产物。

会话授权提交且本地门禁通过后，核对相关生成文件的工作区、真实索引和 HEAD 一致，
以及没有遗漏的未跟踪生成文件，再进行已授权的推送。提交后的复核入口：

```sh
node tooling/verify-dsh-release.mjs
git diff --check
git status --short --branch
```

本轮只更新源码时，记录临时索引下的完整验证结果即可。远端补验需要会话明确授权；
发布 tag 或 Release 按当前会话授权处理。
检查源码、生成包和版本变化时，不执行各 skill 的业务流程或付费模型调用。
