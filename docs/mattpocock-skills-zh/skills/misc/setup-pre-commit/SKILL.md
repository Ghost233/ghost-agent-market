---
name: setup-pre-commit
description: 在当前仓库配置 Husky pre-commit hooks，包含 lint-staged（Prettier）、类型检查和测试。用户希望添加 pre-commit hooks、配置 Husky 或 lint-staged，或在提交时执行格式化、类型检查和测试时使用。
---

# 配置 Pre-Commit Hooks

## 配置内容

- **Husky** pre-commit hook。
- **lint-staged**，对全部已暂存文件运行 Prettier。
- **Prettier** 配置，缺少时创建。
- Pre-commit hook 中的 **typecheck** 和 **test** 脚本。

## 步骤

### 1. 检测包管理器

检查 `package-lock.json`（npm）、`pnpm-lock.yaml`（pnpm）、`yarn.lock`（yarn）和 `bun.lockb`（bun）。使用存在的那个。不明确时默认 npm。

### 2. 安装依赖

作为 devDependencies 安装：

```
husky lint-staged prettier
```

### 3. 初始化 Husky

```bash
npx husky init
```

它会创建 `.husky/` 目录，并在 package.json 中添加 `prepare: "husky"`。

### 4. 创建 `.husky/pre-commit`

编写此文件，Husky v9+ 无需 shebang：

```
npx lint-staged
npm run typecheck
npm run test
```

**适配**：将 `npm` 替换为检测到的包管理器。仓库 package.json 没有 `typecheck` 或 `test` 脚本时，省略对应行，并告诉用户。

### 5. 创建 `.lintstagedrc`

```json
{
  "*": "prettier --ignore-unknown --write"
}
```

### 6. 创建 `.prettierrc`，缺少时才创建

仅在没有 Prettier 配置时创建，采用这些默认值：

```json
{
  "useTabs": false,
  "tabWidth": 2,
  "printWidth": 80,
  "singleQuote": false,
  "trailingComma": "es5",
  "semi": true,
  "arrowParens": "always"
}
```

### 7. 验证

- [ ] `.husky/pre-commit` 存在且可执行。
- [ ] `.lintstagedrc` 存在。
- [ ] package.json 中的 `prepare` 脚本为 `"husky"`。
- [ ] `prettier` 配置存在。
- [ ] 运行 `npx lint-staged`，确认可用。

### 8. 提交

暂存所有修改和新增文件，并以消息 `Add pre-commit hooks (husky + lint-staged + prettier)` 提交。

这会执行新的 pre-commit hooks，可作为确认整体有效的冒烟测试。

## 说明

- Husky v9+ 的 hook 文件无需 shebang。
- `prettier --ignore-unknown` 跳过 Prettier 无法解析的文件，例如图片。
- Pre-commit 先运行 lint-staged，速度快、只检查已暂存文件，再运行完整 typecheck 和测试。
