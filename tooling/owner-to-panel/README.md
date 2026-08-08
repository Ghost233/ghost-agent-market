# owner-to-panel — 项目 owner 投影到 WorkBuddy 面板

把当前项目 `<项目>/.workbuddy/agents/` 下的 owner agent「投影」成 WorkBuddy
「专家」面板里可单独选中的专家。

## 为什么需要它

WorkBuddy 的「专家」面板只扫描静态市场目录（`my-experts/plugins` + 内置/云端），
**不会把项目本地 `.workbuddy/agents/` 下的 owner 当成面板专家**。
因此项目 owner 无法自动出现在面板顶级。本脚本手动把 owner 包成专家包写进
`my-experts/plugins/`，运行后重启 WorkBuddy 即可在面板看到并单独选中。

> 性质：**半自动**。切换项目或改动 owner 后需再跑一次；owner 会被复制到全局
> `my-experts`（失去纯项目本地性），脚本按 owner 的 `name` 命名，天然按项目
> slug 前缀隔离（如 `myapp-payment-owner`），不会跨项目串扰。

## 投影形态

每个 owner 包成「单成员 team」型专家（`expertType: team`，
`leadAgent: owner`，`memberAgents: []`）。自定义 team 型专家被选中时**不会自动建队**，
只注入 lead（owner）指令作为主会话 —— 行为等价于单 agent 专家，但复用已验证的
team 包格式，确保面板一定识别。

## 用法

```bash
python3 owner_to_panel.py [--project <项目路径>] [--dry-run] [--clean [name]]
```

- 无 `--project` 时用当前目录；扫描 `<项目>/.workbuddy/agents/*.md`。
- 自动排除 `ghost-workflow-team-*` 前缀（团队自带 agent），其余每个 `.md` 视为一个 owner。
- `--dry-run`：只预览，不写文件。
- `--clean [name]`：清理投影。`name` 省略时清理本机所有本脚本投影的专家。

## 流程

1. `python3 owner_to_panel.py --project /path/to/myproject`
2. **重启 WorkBuddy**（让面板重建 manifest）。
3. 在「专家」面板即可看到并单独选中这些 owner。
4. 切走项目时：`python3 owner_to_panel.py --clean` 清理，避免面板堆积旧项目 owner。

## 与 Ghost工作流交付专家团的关系

专家团的 `EXTENDING.md` 已有「项目级 owner 扩展机制（方案 A）」：总监在团队内按
`name` 调度项目 owner（全自动、保持本地性）。本脚本是**另一条路**——把 owner 直接
投影成面板顶级专家，适合「想单独选中某个 owner、不进团队」的场景。两条路可共存。
