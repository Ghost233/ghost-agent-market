# ghost-workflow-team-sync

「Ghost工作流交付专家团」的远端同步 skill —— 把 GitHub 上最新的专家团定义拉到本地 WorkBuddy 安装。

> 本目录是 skill 的**版本化真源**；本地可用副本在 `~/.workbuddy/skills/ghost-workflow-team-sync/`。

## 背景
WorkBuddy 当前版本不会扫描自定义 marketplace，手动注册的市场也不会被加载，因此专家包走市场自动更新的路走不通。本 skill 直接从 GitHub `main` 分支拉取最新定义写入本地，作为「远端更新」的可用替代。

## 安装
把整个目录复制到用户级 skills 目录即可被 WorkBuddy 识别：

```bash
mkdir -p ~/.workbuddy/skills/ghost-workflow-team-sync
cp -R tooling/ghost-workflow-team-sync/. ~/.workbuddy/skills/ghost-workflow-team-sync/
```

## 用法
```bash
python3 ~/.workbuddy/skills/ghost-workflow-team-sync/sync.py
# 指定分支（默认 main）：
GWF_BRANCH=main python3 ~/.workbuddy/skills/ghost-workflow-team-sync/sync.py
```

## 同步内容
- 4 个成员定义 → `~/.workbuddy/agents/ghost-workflow-team-*.md`
- 团队实例元数据 → `~/.workbuddy/teams/ghost-workflow-team/config.json`（覆盖前先备份，且保留 `leadSessionId`/`createdAt` 等运行时字段）

## 维护约定
- 修改 skill 请在本目录进行（真源），然后重新复制到用户级目录。
- 仓库侧 Release/Action 仍作为 agent 真源；改完团队定义推 `main` 后，跑上述命令即完成「远端更新」。

详见 `SKILL.md`。
