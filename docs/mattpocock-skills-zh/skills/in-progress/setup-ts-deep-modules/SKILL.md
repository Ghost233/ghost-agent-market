---
name: setup-ts-deep-modules
description: 在 TypeScript 仓库配置 dependency-cruiser，使每个 package 成为深模块，实现隐藏在子目录中，只能通过入口文件访问。用户调用型。
disable-model-invocation: true
---

# 配置 TypeScript 深模块

让仓库中每个 package 都成为**深模块**：小接口背后包含大量行为。Package 的公开部分是**入口**，即 package 根目录中的文件，子目录中的内容全部隐藏。本 skill 安装 [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)，设置规则，让入口成为唯一访问方式，并证明规则确实生效。

调用 Skill 工具并指定 "codebase-design"，取得深模块、接口、接缝和深度的词汇，全程使用这套语言。

## 强制采用的结构

```
src/packages/
  <name>/
    index.ts        ← 入口（公开）。外部从这里导入。
    client.ts       ← 另一个入口。Package 可暴露多个入口。
    lib/            ← 实现：外部不可见，内部可互相导入。
    tests/          ← 共置的测试和 fixtures（子目录，因此私有）。
```

公开部分是 package 的**根文件**，而非指定的某个 `index.ts`。约定将实现放在 `lib/`，测试放在 `tests/`，让每个 package 都有相同的双目录结构。规则本身是通用的：**任意**子目录中的**任意**内容都私有，所以增加目录时无需扩展配置。

四条规则，全部为 `error`：

1. **入口边界**：package 外部的代码，包括应用代码和其他 package，只能导入该 package 的入口，即根文件，不能导入任何子目录内容。
2. **Package 内部自由**：同一 package 的文件可自由互相导入。
3. **通过入口测试**：`<pkg>/tests/` 下的文件，可导入任意 package 的入口，以及自身 `tests/` fixtures；不能导入任意 package 的子目录实现，包括自己所在的 package。允许跨 package 的集成测试，不允许深层导入。
4. **无循环**：不允许依赖循环。

**使用入口，而不是 barrel。** 公开部分包含**每个**根文件，所以 package 可提供多个小入口（`index.ts`、`client.ts`、`server.ts`），无需把所有内容集中到一个巨大 `index.ts`。不鼓励重导出整个子树的 barrel 文件。保持入口小，把实现隐藏在子目录。

分层，即哪些 packages 可依赖哪些 packages，是**另一项**考虑。配置中保留了注释掉的占位规则，由当前仓库填写。

## 步骤

### 1. 检测环境

- **包管理器**：`pnpm-lock.yaml` → pnpm，`yarn.lock` → yarn，`bun.lockb` → bun，否则 npm。下列所有命令均用它执行（`pnpm`/`yarn`/`npm run`/`bunx`）。
- **Packages 根目录**：存在 `src/` 时使用 `src/packages`，否则使用 `packages`。仓库已有其他明显约定时，与用户确认选择。
- **已有配置**：检查是否存在 `.dependency-cruiser.*`。若有，**不要**覆盖；将四条规则及选项合并进去，并告诉用户添加了什么。

**完成标准：** 已确定包管理器、packages 根目录和已有配置情况。

### 2. 安装 dependency-cruiser

用检测到的包管理器，将 `dependency-cruiser` 安装为 devDependency。

**完成标准：** `devDependencies` 包含 `dependency-cruiser`。

### 3. 编写配置

将 [`dependency-cruiser.config.cjs`](./dependency-cruiser.config.cjs) 复制到仓库根目录，命名为 `.dependency-cruiser.cjs`。将 `PACKAGES_ROOT` 设为步骤 1 检测到的根目录。规则按路径深度判断，不依赖扩展名，其他部分无需适配。

**完成标准：** `.dependency-cruiser.cjs` 存在，`PACKAGES_ROOT` 正确，且包含四条 forbidden 规则。

### 4. 接入检查

- 添加 `lint:boundaries` 脚本：`depcruise <packages-root>`，或 `depcruise src`。
- 将它纳入仓库总检查命令，即已有运行 typecheck 的命令，例如 `check` / `ci` / `validate`。**不要**修改 `tsconfig` 或添加路径别名。
- 没有总检查脚本时，添加 `lint:boundaries`，告诉用户把它纳入 CI。

**完成标准：** `lint:boundaries` 存在，并作为与 typecheck 相同命令的一部分运行。

### 5. 搭建示例 package

创建并提交 `<packages-root>/example/`，作为可复制模板：

- `index.ts` 是入口，导出一个委派给内部文件的函数，让 package 明确体现**深度**，而非单纯转发。
- `lib/impl.ts`：**子目录**中的内部文件，由 `index.ts` 导入，外部不可访问。
- `tests/example.test.ts` **仅**导入入口 `../index`，并对公开函数断言。

告诉用户这是可复制或删除的起始模板。

**完成标准：** 示例 package 存在，通过根入口暴露行为，将 `impl` 隐藏在子目录。

### 6. 证明规则生效

这是整个 skill 的完成标准：遇到违规却不失败的配置没有价值。

1. 运行 `lint:boundaries`，干净示例必须**通过**。
2. 在 `tests/example.test.ts` 临时添加深层导入，例如 `import { thing } from "../lib/impl"`。再次运行 `lint:boundaries`，必须因 `tests-through-entrypoints` **失败**。
3. 撤销深层导入，再运行一次，必须**通过**。

**完成标准：** 已观察到通过、深层导入导致失败、再通过。步骤 2 不失败，说明规则未正确接入，结束前先修复。

### 7. 记录约定

在 **packages 目录中**编写 `README.md`（`<packages-root>/README.md`），放在其管辖的 packages 旁。涵盖 `src/packages/<name>/` 布局：根目录为入口，`lib/` 为实现，`tests/` 为测试；“只能通过 package 的入口，即根文件导入”；以及如何运行 `lint:boundaries`。明确**不鼓励 barrel 文件**，采用多个小入口，不通过一个 index 重导出整个子树。内容只保留可复制的结构示例，以及每条规则各一段。

随后从仓库代理指引文件添加一个**上下文指针**。存在 `CLAUDE.md` 就用它，否则用 `AGENTS.md`；两者都没有则创建 `AGENTS.md`。一行即可，例如 `Packages are deep modules: see [src/packages/README.md](./src/packages/README.md) before adding or importing one.`。它让代理发现边界规则，而不是违规后才知道。

**完成标准：** `<packages-root>/README.md` 存在，明确不鼓励 barrels，仓库 `CLAUDE.md`/`AGENTS.md` 链接到它。

## 说明

- 配置中的 `$1` 反向引用，即 dependency-cruiser 的分组匹配，使 package 能访问自己的内部实现，而外部不能。不要改成每个 package 各一组独立规则。
- 公开或私有由**深度**决定：package 根文件是入口，子目录中的所有内容都私有。约定子目录是 `lib/`（实现）和 `tests/`，但规则不硬编码这些名称，任意子目录都私有，因此新目录无需修改配置。增加入口只需添加根文件，无需 barrel。
- Packages 为**扁平**结构，只允许根目录下一级直接子目录。Package 内部可任意嵌套，但一个 package 不能包含另一个 package。
- 使用 `.cjs`，不用 `.js`，使配置的 `module.exports` 在 `"type": "module"` 仓库中也能工作。
