#!/usr/bin/env python3
"""Project Owner -> WorkBuddy 面板专家 投影脚本

为什么存在：
    WorkBuddy 的「专家」面板只扫描静态市场目录（my-experts/plugins + 内置/云端），
    不会把项目本地 `.workbuddy/agents/` 下的 owner agent 当成面板专家。
    本脚本把当前项目的 owner 文件「投影」成 my-experts 下的专家包，
    运行后重启 WorkBuddy，这些 owner 就出现在「专家」面板，可单独选中。

投影形态：
    每个 owner 被包成一个「单成员 team」型专家（expertType=team,
    leadAgent=owner, memberAgents=[]）。自定义 team 型专家被选中时不会自动建队，
    只注入 lead（owner）指令作为主会话 —— 行为等价于单 agent 专家，但复用已验证
    的 team 包格式，确保面板一定识别。

用法：
    python3 owner_to_panel.py [--project <路径>] [--dry-run] [--clean [name]]
        --project   项目根（默认当前目录）。脚本扫描 <项目>/.workbuddy/agents/*.md
        --dry-run   只打印将要做的事，不写任何文件
        --clean     清理投影。无 name 时清理本机所有本脚本投影的专家；
                    有 name 时只清理该专家（并从 marketplace.json 移除）

owner 识别规则：
    扫描目录下所有 *.md；排除 `ghost-workflow-team-*` 前缀（团队自带 agent）。
    其余每个 .md 视为一个项目 owner，按其 frontmatter `name` 投影。
"""

import json
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

HOME = Path.home()
MY_EXPERTS = HOME / ".workbuddy/plugins/marketplaces/my-experts"
PLUGINS_DIR = MY_EXPERTS / "plugins"
MARKETPLACE_JSON = MY_EXPERTS / ".codebuddy-plugin" / "marketplace.json"
PROJ_FILE = MY_EXPERTS / ".gwf-owner-projections.json"  # 记录本脚本投影了哪些

AUTHOR = {"name": "Ghost233", "email": "only.yesc@gmail.com"}
CATEGORY = "02-Engineering"


def parse_frontmatter(text: str) -> dict:
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    fm = parts[1]
    data = {}
    cur_parent = None
    for line in fm.splitlines():
        if not line.strip():
            continue
        m = re.match(r"^([A-Za-z0-9_\-]+):\s*(.*)$", line)
        if m and not line.startswith((" ", "\t")):
            key, val = m.group(1), m.group(2).strip()
            if val == "":
                cur_parent = key
                data[key] = {}
            else:
                cur_parent = None
                data[key] = val.strip('"')
        else:
            # 缩进的嵌套值，如 displayName: 下的 en:/zh:
            nm = re.match(r"^\s+([A-Za-z0-9_\-]+):\s*(.*)$", line)
            if nm and cur_parent is not None:
                data[cur_parent][nm.group(1)] = nm.group(2).strip('"')
    return data


def load_projections() -> dict:
    if PROJ_FILE.exists():
        try:
            return json.loads(PROJ_FILE.read_text())
        except Exception:
            return {}
    return {}


def save_projections(data: dict):
    PROJ_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def build_plugin_json(name: str, fm: dict) -> dict:
    desc_en = str(fm.get("description", name))
    disp = fm.get("displayName", {}) or {}
    prof = fm.get("profession", {}) or {}
    zh_name = disp.get("zh") or prof.get("zh") or name
    en_name = disp.get("en") or prof.get("en") or name
    zh_desc = prof.get("zh") or desc_en
    return {
        "name": name,
        "version": "1.0.0",
        "description": desc_en,
        "author": AUTHOR,
        "expertType": "team",
        "agentName": name,
        "teamInfo": {"leadAgent": name, "memberAgents": []},
        "agents": [f"./agents/{name}.md"],
        "displayName": {"en": en_name, "zh": zh_name},
        "profession": {"en": en_name, "zh": zh_name},
        "displayDescription": {"en": desc_en, "zh": zh_desc},
        "categoryId": CATEGORY,
        "defaultInitPrompt": {
            "zh": f"以{zh_name}身份接手我当前的问题。",
            "en": f"Act as {en_name} and take over my current task.",
        },
        "tags": [{"en": "Project Owner", "zh": "项目专家"}],
        "members": [
            {
                "id": name,
                "displayName": {"en": en_name, "zh": zh_name},
                "profession": {"en": en_name, "zh": zh_name},
                "role": "lead",
                "name": {"en": en_name, "zh": zh_name},
            }
        ],
        "plugin": name,
    }


def discover_owners(project: Path):
    agents_dir = project / ".workbuddy" / "agents"
    if not agents_dir.is_dir():
        return []
    owners = []
    for f in sorted(agents_dir.glob("*.md")):
        if f.name.startswith("ghost-workflow-team-"):
            continue
        fm = parse_frontmatter(f.read_text(encoding="utf-8"))
        name = fm.get("name")
        if not name:
            # 无 name 的 agent 文件跳过
            continue
        owners.append((name, f, fm))
    return owners


def update_marketplace(name: str, dry: bool) -> bool:
    if not MARKETPLACE_JSON.exists():
        print(f"[warn] marketplace.json 不存在: {MARKETPLACE_JSON}", file=sys.stderr)
        return False
    mk = json.loads(MARKETPLACE_JSON.read_text(encoding="utf-8"))
    plugins = mk.setdefault("plugins", [])
    if any(p.get("name") == name for p in plugins):
        return False
    plugins.append(
        {
            "name": name,
            "source": f"./plugins/{name}",
            "description": name,
        }
    )
    if not dry:
        MARKETPLACE_JSON.write_text(
            json.dumps(mk, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    return True


def remove_from_marketplace(name: str, dry: bool) -> bool:
    if not MARKETPLACE_JSON.exists():
        return False
    mk = json.loads(MARKETPLACE_JSON.read_text(encoding="utf-8"))
    plugins = mk.get("plugins", [])
    new = [p for p in plugins if p.get("name") != name]
    if len(new) == len(plugins):
        return False
    mk["plugins"] = new
    if not dry:
        MARKETPLACE_JSON.write_text(
            json.dumps(mk, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    return True


def project_owners(project: Path):
    return discover_owners(project)


def do_project(project: Path, dry: bool):
    owners = project_owners(project)
    if not owners:
        print(f"[info] 在 {project}/.workbuddy/agents/ 下未找到可投影的 owner（已排除 ghost-workflow-team-*）。")
        return
    projections = load_projections()
    for name, src, fm in owners:
        dst = PLUGINS_DIR / name
        print(f"\n→ 投影 owner: {name}")
        print(f"   源: {src}")
        print(f"   目标: {dst}")
        agent_dir = dst / "agents"
        if not dry:
            if dst.exists():
                bak = dst.with_suffix(".bak-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
                shutil.move(str(dst), str(bak))
            agent_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy(src, agent_dir / f"{name}.md")
            (dst / ".codebuddy-plugin").mkdir(parents=True, exist_ok=True)
            (dst / ".codebuddy-plugin" / "plugin.json").write_text(
                json.dumps(build_plugin_json(name, fm), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        added = update_marketplace(name, dry)
        print(f"   marketplace.json: {'将追加' if added else '已存在，跳过'}")
        projections[name] = str(src)
    if not dry:
        save_projections(projections)
        print(
            "\n✅ 投影完成。请【重启 WorkBuddy】让面板重建 manifest，"
            "之后这些 owner 会出现在「专家」面板，可单独选中。"
        )
    else:
        print("\n[dry-run] 以上为预览，未写入任何文件。")


def do_clean(target: str | None, dry: bool):
    projections = load_projections()
    if target:
        names = [target] if target in projections else []
        if not names:
            print(f"[info] 未找到投影记录: {target}")
            return
    else:
        names = list(projections.keys())
    if not names:
        print("[info] 没有本脚本投影的专家需要清理。")
        return
    for name in names:
        dst = PLUGINS_DIR / name
        print(f"\n→ 清理投影: {name}")
        if dst.exists():
            if dry:
                print(f"   将删除: {dst}")
            else:
                shutil.rmtree(dst)
        removed = remove_from_marketplace(name, dry)
        print(f"   marketplace.json: {'将移除' if removed else '未注册，跳过'}")
        projections.pop(name, None)
    if not dry:
        save_projections(projections)
        print("\n✅ 清理完成。重启 WorkBuddy 后面板不再显示这些 owner。")
    else:
        print("\n[dry-run] 以上为预览，未删除任何文件。")


def main():
    args = sys.argv[1:]
    project = Path.cwd()
    dry = False
    clean = False
    clean_target = None
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--project":
            i += 1
            project = Path(args[i]).expanduser().resolve()
        elif a == "--dry-run":
            dry = True
        elif a == "--clean":
            clean = True
            if i + 1 < len(args) and not args[i + 1].startswith("--"):
                clean_target = args[i + 1]
                i += 1
        else:
            print(f"[warn] 未知参数: {a}", file=sys.stderr)
        i += 1

    if clean:
        do_clean(clean_target, dry)
        return
    if not project.is_dir():
        print(f"[error] 项目路径不存在: {project}", file=sys.stderr)
        sys.exit(1)
    do_project(project, dry)


if __name__ == "__main__":
    main()
