---
name: git-merge-conflict
description: 用于用户明确要求处理严重、复杂或高风险的 merge、rebase 或 cherry-pick 冲突，需要在解决前考古两侧提交历史、理解各自修改意图并避免简单选择 ours/theirs；不用于空白、生成文件或只有 1–2 处的简单冲突。
---

# Git 合并冲突（基于历史考古的解决流程）

## 概述

手动调用的 skill。专门处理「非常严重」的分支合并冲突。

**核心原则：** 绝不简单选左（ours）或选右（theirs）。每一处冲突都必须先考古两条分支的提交历史，理解两侧修改各自的「为什么」，然后才能做综合判断。

**违反此原则的后果：** 静默丢失代码意图 → 合并后功能在某一侧悄悄失效，且很难在 review 阶段发现，往往在上线后才暴露。

**考古边界（关键）：** merge 以两侧的 merge-base 为上界；rebase/cherry-pick 重放普通提交时，以被重放提交的父提交为上界。只追溯 `base..ours` 和 `base..theirs` 两段，**不要无限回溯**到远古历史。脚本无法判断重放 merge commit 时选择的 mainline，遇到这种情况必须由用户或当前操作参数确认正确父提交，再通过 `--base` 显式传入。

- base 距今 < 30 天、两侧累计 < 50 提交 → 直接逐文件考古，几分钟搞定
- base 距今 > 180 天 或 两侧累计 > 300 提交 → 分支已显著漂移，警告并启用子代理并行（见 Step 1b）

**辅助脚本：** 本 skill 自带只读考古脚本 `scripts/archaeology.sh`，自动完成锁定 ref、计算分歧距离、逐文件列出 base 之后两侧提交。先把当前 `SKILL.md` 所在目录解析为绝对路径 `<skill-dir>`；Step 0 起从目标仓库中用 `bash "<skill-dir>/scripts/archaeology.sh"` 调用，不要假设当前目录就是 skill 目录。

**开始时声明：** "我正在使用 git-merge-conflict skill 来处理这次严重合并冲突。"

---

## 何时使用

✅ **适用：**
- 冲突涉及核心业务逻辑（非格式/空白/import 顺序）
- 两条分支对**同一处代码**有不同且**都有理由**的修改
- merge/rebase/cherry-pick 过程中产生大量冲突（10+ 文件）
- 上游分支引入破坏性重构，本地有长期积累的定制功能
- 用户明确说「这次合并很麻烦/很严重/要小心」

❌ **不适用（用更轻量的方法）：**
- 单纯的空白/格式冲突 → `git merge -Xignore-all-space` 或直接编辑
- 自动生成的文件（lock 文件、build 产物）→ 重新生成，不要手动合
- 一侧明显是另一侧的超集 → 直接取超集
- 只有 1-2 处 trivial 冲突 → 直接手动解决

---

## 核心铁律

```
没有历史考古，不得解决冲突
```

**在解决任何一处冲突之前，必须先完成历史考古。**

- 不读历史就选 ours/theirs？停下来，从头开始。
- 只看当前 diff 不看 commit message？不够。
- 凭"看起来新版更好"就选一侧？严禁。
- 声称"这个太简单不需要考古"？简单冲突也会藏 bug。

**这条规则没有例外。**

---

## 完整流程

### 步骤 0：评估冲突全貌（先侦察，不动手）

**不要急着改任何文件。** 先建立全局认识。

**优先用辅助脚本一次性拿到上下文 + 冲突清单 + 分歧距离：**

```bash
bash "<skill-dir>/scripts/archaeology.sh"            # 全量：上下文 + 标记位置 + 逐文件考古
bash "<skill-dir>/scripts/archaeology.sh" --context  # 仅冲突上下文（operation/ours/theirs/base）
bash "<skill-dir>/scripts/archaeology.sh" --markers  # 仅冲突标记位置
```

脚本会输出 `ours / theirs / base` 三个 SHA、两侧领先 base 的提交数、base 距今天数，并在 base 太老或累计提交过多时给出警告。

**手工复核（脚本基于同样的命令，理解原理）：**

```bash
# 确认合并状态
git status

# 列出所有冲突文件（三种方式交叉验证）
git diff --name-only --diff-filter=U          # 未合并的路径
git ls-files -u                                # 底层 unmerged 条目

# 锁定合并的两端 ref（关键！）
git rev-parse HEAD                             # ours
git rev-parse MERGE_HEAD                       # theirs（merge 时）
git rev-parse REBASE_HEAD                      # theirs（rebase 时）
git rev-parse CHERRY_PICK_HEAD                 # theirs（cherry-pick 时）
git merge-base HEAD MERGE_HEAD                 # 共同祖先 = 考古上界
```

一次操作只会采用对应的 incoming ref。**记录 operation 和三个关键 SHA：** `ours`、`theirs`、`base`。后续所有考古只看 `base..ours` 和 `base..theirs` 两段，不向前回溯。

**不要把分支名称和 index side 混为一谈：** stage 1 是 base，stage 2 是 `HEAD`/current（ours），stage 3 是 incoming（theirs）。在 rebase 中，Git 官方定义的 ours 是“已经重放到 upstream 的当前序列”，theirs 才是正在重放的工作分支 commit，因此它们与日常按分支名称理解的两侧相反。

**看分歧距离判断难度（脚本已自动计算）：**
- 两侧累计 < 50 提交 → 逐文件考古即可
- 冲突文件 > 20 或跨多个子系统 → 跳到 Step 1b 用子代理并行分析

### 步骤 1：对每处冲突做历史考古

这是本 skill 的核心。对**每一个冲突文件**（或每一处冲突块），都要回答三个问题：

**先用脚本拿到逐文件概览（base 为上界，不无限回溯）：**

```bash
bash "<skill-dir>/scripts/archaeology.sh" <file> # 该文件的两侧 base 后提交 + 冲突块摘要

# 精确读取 index 中的三方内容；先看这三份，再判断冲突意图
git show :1:<file>                               # base
git show :2:<file>                               # 当前侧（ours）
git show :3:<file>                               # 传入侧（theirs）
```

然后对需要深挖的**单个冲突块**用精确命令：

#### 问题 A：ours 这段代码为什么是这个样子？

```bash
# 只列出 ours 在考古边界后的相关提交
git log --oneline <base>..<ours> -- <file>
# 按代码内容查引入点（pickaxe），仍然限制在 base..ours
git log -p -S "<关键代码片段>" <base>..<ours> -- <file>
# 需要按行定位时可辅助 blame；若落到 base 之前，说明该行是两侧共享历史
git blame <ours> -L <start>,<end> -- <file>
```

**要找到：** 改动的 commit hash、message、作者、原因。不是"改了什么"，而是"**为什么改**"。

#### 问题 B：theirs 这段代码为什么是另一个样子？

```bash
# theirs 侧同样的查询；使用已经锁定的 SHA，不要硬编码 MERGE_HEAD
git log --oneline <base>..<theirs> -- <file>
git log -p -S "<关键代码片段>" <base>..<theirs> -- <file>
git blame <theirs> -L <start>,<end> -- <file>
```

#### 问题 C：base 之后，两侧各自做了哪些相关改动？（考古上界 = base）

```bash
# 关键：只看 base 之后，不向前无限回溯
git log --oneline <base>..HEAD -- <file>         # ours 自分叉后的演进
git log --oneline <base>..<theirs> -- <file>     # theirs 自分叉/被重放提交的演进

# 三方对比，一眼看清谁动了哪里
git mergetool --tool=vimdiff                     # 或 meld / kdiff3 / VS Code
```

**考古边界提醒：** base 之前的改动两侧共享，通常不是冲突根因。若 `base..` 范围内找不到合理解释，再谨慎向前查一两层，但不要陷入远古历史。

**考古产出（每个冲突块必须有）：**

| 冲突位置 | ours 改动原因 | theirs 改动原因 | 两侧意图关系 |
|---------|--------------|----------------|-------------|
| `file.py:42-58` | commit abc：修复 race condition | commit xyz：添加新功能参数 | **正交**，需 union |
| `config.ts:10` | commit def：本地多 relay | commit ghi：上游单 socket | **冲突**，需设计取舍 |

### 步骤 1b：大型合并用子代理并行分析（强烈推荐）

**当冲突跨多个子系统或文件数 >20，且宿主环境及上层指令允许子代理时，用多个只读子代理并行考古。** 如果当前环境禁止代理委派，则按同样的子系统切分串行分析，不要因为无法并行而跳过考古。

按子系统/目录切分，每个子代理负责一块：

```
子代理 1：分析 iOS service/runtime 层冲突
  - 输入：相关冲突文件列表 + ours/theirs/base 的 SHA
  - 任务：对每处冲突产出「ours 原因 / theirs 原因 / 建议策略」
  - 约束：只读分析，不修改任何文件

子代理 2：分析 UI/project 层冲突
子代理 3：分析 bridge/relay 层冲突
```

**子代理提示要点：**
- 明确传入 `ours=<SHA> theirs=<SHA> base=<SHA>`，不要让子代理自己猜
- 要求引用具体 commit hash 作为证据，不能空泛说"看起来"
- 要求区分"文本冲突"和"语义冲突"（whole-tree intent conflict）

**为什么要用子代理：** 单线程读 20 个文件的 git log 会消耗巨量 token 和时间；并行能把时间从小时级压到分钟级，且每个子代理上下文更聚焦、考古更深。

### 步骤 2：制定综合判断策略（逐文件）

根据考古结果，对**每个冲突文件**选择策略。注意是「按文件按冲突块」，不是整个 merge 一刀切：

| 考古发现 | 策略 | 命令 |
|---------|------|------|
| 两侧修改正交（动的是不同逻辑） | **Union 合并**，保留双侧代码 | 手动编辑融合 |
| theirs 是 bug 修复，ours 未受影响 | **取 theirs** 该冲突块 | `git checkout --theirs <file>` 仅该段 |
| ours 是必要的本地定制 | **保留 ours**，吸收 theirs 的非冲突改进 | 手动融合 |
| 两侧解决同一问题但方案不同 | **设计取舍**，选更优方案并说明理由 | 手动融合 + 注释说明 |
| 文件被一方完全重写 | **以重写方为基础**，把另一方的新功能 port 过来 | 选基础 + 手动 port |
| `project.pbxproj` / `xcodeproj` | **语义合并或由项目工具重新生成**；不能盲目文本 union | 复核 target/build phase/object ID 后用 Xcode 验证 |
| `Package.resolved` / `yarn.lock` | **从已合并的依赖声明重新生成** | 使用仓库锁定的包管理器版本重新 resolve |
| 生成代码 / build 产物 | **重新生成**，绝不手动合 | 跑 codegen / build |

**Union 策略的判定标准（严）：** 只有当考古证明两侧改动作用于**不同的代码路径/变量/逻辑分支**时才能 union。如果两侧改了同一个函数体的同一行，那不是 union 场景，必须做语义判断。

### 步骤 3：执行解决

```bash
# 方式一：逐文件手动编辑（最可控，推荐用于严重合并）
# 用编辑器打开文件，根据 Step 2 策略逐个冲突块处理

# 方式二：对确认要整文件取一侧的（考古后确实成立的），按文件操作
git checkout --ours <file>     # 仅当考古确认 ours 是对的
git checkout --theirs <file>   # 仅当考古确认 theirs 是对的

# 方式三：用 3-way merge tool 辅助
git mergetool                   # 交互式，但每步仍需基于考古判断

# 每个文件解决后立即标记
git add <file>
```

**严禁的快捷方式：**
```bash
git checkout --ours .          # ❌ 批量取一侧 = 放弃考古
git checkout --theirs .        # ❌ 同上
git merge -Xours               # ❌ 整个 merge 跳过冲突
git merge -Xtheirs             # ❌ 同上
```
这些命令只有在 Step 2 考古**明确判定**某文件/某区块适用后，**精确到文件**地使用。

**rebase 特别警告：** rebase 的 ours/theirs 与按分支名称理解的两侧相反。执行 `checkout --ours/--theirs` 前必须再次对照脚本输出和 `git show :2:<file>` / `:3:<file>`，不能仅凭分支名选择。

### 步骤 4：验证（三层验证，缺一不可）

**第一层：冲突标记清零**

```bash
git diff --name-only --diff-filter=U          # 必须为空
rg -n '^<<<<<<<|^=======|^>>>>>>>' .          # 全仓扫残留标记，必须无输出
```

**第二层：语法 / 编译 / 类型检查**

```bash
# 按项目类型
npm run typecheck / tsc --noEmit               # TS
cargo check                                    # Rust
swift build / xcodebuild                       # Swift/iOS
python -m py_compile <files>                   # Python
go build ./...                                 # Go
node --check <file>                            # 单文件 JS 语法
```

**第三层：测试（最关键）**

```bash
npm test / cargo test / pytest / go test ./...
```

**若测试失败：** 不要急着"修"——重新考古失败点。可能是 union 策略漏了某一侧的依赖，或某个 side effect 被丢掉。回到 Step 1 重新分析失败的冲突块。

### 步骤 5：提交与记录

**commit message 必须记录考古结论**，方便未来 review 和回溯：

```
Merge <theirs-branch> into <ours-branch>: resolve <N> conflicts

冲突解决策略（基于历史考古）:

- <file1>: union。ours(commit abc) 修了 race condition，theirs(commit xyz)
  加了新参数，二者正交，合并保留双侧。
- <file2>: 取 theirs。ours 的旧实现是 bug(commit def 已记录)，theirs 重写修复。
- <file3>: 手动设计取舍。ours 多 relay 方案优于 theirs 单 socket，但吸收了
  theirs 的 keepalive 改进(commit ghi)。

验证: typecheck ✓ / 测试 142 passed / 冲突标记清零
```

**如果仓库已有项目级决策记录机制，且用户授权记录这次复杂合并，追加一份合并决策记录：**
- 涉及的 ref 和 SHA
- 每种子系统/文件类型的有效策略
- 踩过的坑（如 `index.lock` 权限问题、生成的 pbxproj 必须 union）

---

## 快速参考

| 阶段 | 关键命令 | 目的 |
|------|---------|------|
| **一键考古** | `bash "<skill-dir>/scripts/archaeology.sh"` | 上下文 + 标记位置 + 逐文件两侧 base 后提交 |
| 单文件考古 | `bash "<skill-dir>/scripts/archaeology.sh" <file>` | 该文件冲突块 + 两侧 base..HEAD/incoming 提交 |
| 仅看上下文 | `bash "<skill-dir>/scripts/archaeology.sh" --context` | operation + ours/theirs/base + 分歧距离 |
| 侦察 | `git diff --name-only --diff-filter=U` | 列冲突文件 |
| 锁定 ref | `HEAD` + `MERGE_HEAD`/`REBASE_HEAD`/`CHERRY_PICK_HEAD` | 拿到 operation/ours/theirs/base |
| 三方内容 | `git show :1:<file>` / `:2:` / `:3:` | 直接读取 base/current/incoming |
| 内容考古 | `git log -p -S "<code>" <base>..<side> -- <file>` | 在有界范围内找引入点 |
| 分支差异 | `git log <base>..<branch> -- <file>` | 该分支 base 之后的演进（有界） |
| 三方对比 | `git mergetool` | 可视化 base/ours/theirs |
| 验证标记 | `rg -n '^<<<<<<<\|^=======\|^>>>>>>>'` | 扫残留 |
| 验证冲突 | `git diff --name-only --diff-filter=U`（空=干净） | 确认全解决 |

---

## 常见错误

**无限回溯远古历史**
- **问题：** 一路 `git log` 追到几年前，淹没在无关噪音里，反而看不清分叉后的真实原因
- **修复：** 以 merge-base 为上界，只看 `base..ours` / `base..theirs`。base 之前两侧共享，不是冲突根因。脚本已自动只列 base 之后的提交

**忽略 base 年龄 / 分歧距离**
- **问题：** base 太老（>180 天）或两侧累计提交过多（>300）时，仍按常规逐文件考古，时间和 token 爆炸
- **修复：** Step 0 先看脚本输出的分歧距离；超阈值直接启用 Step 1b 子代理并行

**未考古就批量取一侧**
- **问题：** `git checkout --ours .` 静默丢失 theirs 的所有意图
- **修复：** 删除已 stage 的，回 Step 1 逐文件考古

**只看 diff 不看 commit message**
- **问题：** 看到代码却不知道为什么这么改，导致误判
- **修复：** 必须读 `git log -p` 里的 commit message 和 PR/issue 引用

**把语义冲突当文本冲突**
- **问题：** 两边都改了，但没文字冲突（git 自动合并了），结果运行时一方破坏另一方
- **修复：** Step 0 用 `git diff HEAD...MERGE_HEAD` 看全树意图，不只看 `<` `>` 标记

**对 pbxproj 盲目 union / 对 lock 文件直接选一侧**
- **问题：** 重复或丢失 object ID、target、依赖边，导致项目配置或依赖图损坏
- **修复：** pbxproj 做语义合并或由项目工具生成并用 Xcode 验证；lock 文件从已合并的依赖声明重新生成

**合并后不跑测试就提交**
- **问题：** union 漏了某一侧的依赖/import，编译过但运行炸
- **修复：** Step 4 三层验证，测试失败重新考古

**忽视 `.git/index.lock` 权限**
- **问题：** 某些环境下 `git checkout --ours` 报 `Operation not permitted`
- **修复：** 请求权限提升后重试，仅在实际写 index 时

---

## 危险信号

**绝不：**
- 在 Step 1 考古完成前修改任何冲突文件
- 用 `git checkout --ours .` / `--theirs .` 批量操作
- 用 `git merge -Xours/-Xtheirs` 跳过整个 merge 的冲突
- 凭 diff 外观判断而不读 commit message
- 对生成代码 / lock 文件手动合并
- 合并后不验证就提交
- 忽略语义冲突（无标记但运行时冲突）

**总是：**
- 先锁定 ours / theirs / base 三个 SHA
- 对每个冲突块追溯两侧"为什么改"
- 大型合并在宿主环境允许时用多个只读子代理并行考古，否则按子系统串行
- 按文件/按冲突块选择不同策略
- 三层验证（标记清零 + 编译 + 测试）
- 在 commit message 记录考古结论
