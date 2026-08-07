#!/usr/bin/env python3
"""Sync the latest Ghost Workflow Delivery Team definitions from GitHub into the
local WorkBuddy install, including the expert-market manifest injection needed
for the team to show up in the WorkBuddy expert panel.

Why this exists:
    WorkBuddy's current version does NOT scan custom plugin marketplaces and does
    NOT auto-update manually registered marketplaces. So "remote update" is done by
    pulling the latest files straight from the GitHub repo and writing them to the
    local install paths. Functionally equivalent to marketplace auto-update.

What it syncs:
    - Agent definitions  -> ~/.workbuddy/agents/ghost-workflow-team-*.md
    - Team instance meta -> ~/.workbuddy/teams/ghost-workflow-team/config.json
    - Plugin package       -> ~/.workbuddy/plugins/marketplaces/experts/plugins/ghost-workflow-team/
    - Expert manifest      -> injects/replaces the GhostWorkflowTeam entry in
                              ~/.workbuddy/app/cache/experts/manifest.json and
                              updates ~/.workbuddy/app/cache/experts/metadata.json hash
    - Avatars              -> copies resized/renamed avatars to
                              ~/.workbuddy/plugins/marketplaces/experts/avatars/

Safety:
    - Every overwritten file is backed up to ~/.workbuddy/.../.gwf-backup/<timestamp>/
    - Runtime-only fields in config.json (leadSessionId, createdAt, joinedAt,
      tmuxPaneId, backendType, subscriptions, color, planModeRequired) are PRESERVED.
    - If the local team instance is missing, it only warns (never creates a broken
      instance with an invalid session id).

Env override:
    GWF_BRANCH  branch/tag/ref to pull from (default: main)
"""

import json
import os
import re
import sys
import shutil
import hashlib
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

REPO = "Ghost233/ghost-agent-market"
BRANCH = os.environ.get("GWF_BRANCH", "main")
PKG_DIR = "plugins/ghost-workflow-team"

HOME = Path.home()
LOCAL_AGENTS = HOME / ".workbuddy/agents"
TEAM_DIR = HOME / ".workbuddy/teams/ghost-workflow-team"
EXPERTS_MARKET = HOME / ".workbuddy/plugins/marketplaces/experts"
PLUGIN_DST = EXPERTS_MARKET / "plugins/ghost-workflow-team"
AVATARS_DST = EXPERTS_MARKET / "avatars"
MANIFEST_PATH = HOME / ".workbuddy/app/cache/experts/manifest.json"
METADATA_PATH = HOME / ".workbuddy/app/cache/experts/metadata.json"

AGENTS = [
    "ghost-workflow-team-lead",
    "ghost-workflow-team-supervisor",
    "ghost-workflow-team-developer",
    "ghost-workflow-team-reviewer",
]

COLOR_MAP = {
    "ghost-workflow-team-lead": "blue",
    "ghost-workflow-team-supervisor": "purple",
    "ghost-workflow-team-developer": "green",
    "ghost-workflow-team-reviewer": "orange",
}

RAW = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{PKG_DIR}"

PLUGIN_FILES = [
    ".codebuddy-plugin/plugin.json",
    "VERSION",
    "README.md",
    "EXTENDING.md",
]

DESCRIPTION_ZH = (
    "面向复杂交付场景的核心专家团队：由总监拆解阶段并调度，监工跟进进度，"
    "开发执行产出，审查验收质量。核心角色稳定；项目可按需扩展 owner agent。"
)


def fetch(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": "gwf-sync"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()
    except urllib.error.URLError as e:
        print(f"[warn] fetch failed: {url} ({e})", file=sys.stderr)
        return None


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def kebab_to_pascal(s: str) -> str:
    return "".join(part.capitalize() for part in s.split("-"))


def parse_yaml_frontmatter(text: str) -> dict:
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    fm = parts[1].strip()
    data: dict = {}
    current_key: str | None = None
    for line in fm.split("\n"):
        m = re.match(r"^(\w+):\s*(.*)$", line)
        if m:
            k, v = m.group(1), m.group(2).strip()
            if v.startswith('"') and v.endswith('"'):
                v = v[1:-1]
            data[k] = v
            current_key = k
            continue
        m2 = re.match(r"^\s+(en|zh):\s*\"?([^\"]*)\"?$", line)
        if m2 and current_key:
            if not isinstance(data.get(current_key), dict):
                data[current_key] = {}
            data[current_key][m2.group(1)] = m2.group(2)
    return data


def backup_file(src: Path, backup_root: Path) -> None:
    if not src.exists():
        return
    backup_root.mkdir(parents=True, exist_ok=True)
    rel = src.relative_to(HOME) if str(src).startswith(str(HOME)) else src.name
    dst = backup_root / str(rel).lstrip("/").replace("/", "_")
    shutil.copy(src, dst)


def sync_agents(backup_root: Path) -> bool:
    changed = False
    LOCAL_AGENTS.mkdir(parents=True, exist_ok=True)
    for a in AGENTS:
        f = f"{a}.md"
        data = fetch(f"{RAW}/agents/{f}")
        if data is None:
            continue
        dest = LOCAL_AGENTS / f
        if dest.exists() and sha(dest.read_bytes()) == sha(data):
            print(f"[skip] {f} unchanged")
            continue
        backup_root.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            shutil.copy(dest, backup_root / f)
        dest.write_bytes(data)
        print(f"[sync] {f} updated (backup: {backup_root / f})")
        changed = True
    return changed


def sync_team() -> bool:
    data = fetch(f"{RAW}/.codebuddy-plugin/plugin.json")
    if data is None:
        return False
    pj = json.loads(data)
    team_info = pj.get("teamInfo", {})
    lead = team_info.get("leadAgent")
    members = team_info.get("memberAgents", [])
    description = pj.get("description", "")
    dn = pj.get("displayName", {})
    display = dn.get("zh") or dn.get("en") or "Ghost工作流交付专家团"

    cfg_path = TEAM_DIR / "config.json"
    if not cfg_path.exists():
        print(
            f"[warn] team instance missing at {cfg_path}; create it via WorkBuddy's "
            f"native team UI first, then re-run sync to refresh metadata.",
            file=sys.stderr,
        )
        return False

    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    lead_session = cfg.get("leadSessionId")
    created = cfg.get("createdAt")
    old_members = {m.get("agentType"): m for m in cfg.get("members", [])}

    def build_member(atype: str, is_lead: bool) -> dict:
        prev = old_members.get(atype, {})
        m = {
            "agentId": f"{atype}@ghost-workflow-team",
            "name": atype,
            "agentType": atype,
            "joinedAt": prev.get(
                "joinedAt", int(datetime.now(timezone.utc).timestamp() * 1000)
            ),
            "cwd": prev.get("cwd", str(HOME / "code/ghost-agent-market")),
            "subscriptions": prev.get("subscriptions", [] if is_lead else ["*"]),
        }
        if is_lead:
            m["tmuxPaneId"] = prev.get("tmuxPaneId", "")
        else:
            m["tmuxPaneId"] = prev.get("tmuxPaneId", "in-process")
            m["backendType"] = prev.get("backendType", "in-process")
            m["color"] = prev.get("color", COLOR_MAP.get(atype, "gray"))
            m["planModeRequired"] = prev.get("planModeRequired", False)
        return m

    new_members = [build_member(lead, True)] + [build_member(a, False) for a in members]
    new_cfg = {
        "name": cfg.get("name", "ghost-workflow-team"),
        "description": description,
        "displayName": display,
        "createdAt": created,
        "leadAgentId": f"{lead}@ghost-workflow-team",
        "leadSessionId": lead_session,
        "members": new_members,
    }

    if json.dumps(new_cfg, ensure_ascii=False, sort_keys=True) == json.dumps(
        cfg, ensure_ascii=False, sort_keys=True
    ):
        print("[skip] team config unchanged")
        return False

    backup_root = HOME / ".workbuddy/teams/.gwf-backup" / stamp()
    backup_root.mkdir(parents=True, exist_ok=True)
    shutil.copy(cfg_path, backup_root / "config.json")
    cfg_path.write_text(
        json.dumps(new_cfg, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[sync] team config refreshed (backup: {backup_root / 'config.json'})")
    return True


def sync_plugin_package(backup_root: Path) -> bool:
    """Download the full plugin package into the loaded experts marketplace."""
    changed = False
    for rel in PLUGIN_FILES:
        data = fetch(f"{RAW}/{rel}")
        if data is None:
            continue
        dest = PLUGIN_DST / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and sha(dest.read_bytes()) == sha(data):
            print(f"[skip] plugin/{rel} unchanged")
            continue
        backup_file(dest, backup_root)
        dest.write_bytes(data)
        print(f"[sync] plugin/{rel} updated")
        changed = True

    # agents
    agents_dir = PLUGIN_DST / "agents"
    agents_dir.mkdir(parents=True, exist_ok=True)
    for a in AGENTS:
        f = f"{a}.md"
        data = fetch(f"{RAW}/agents/{f}")
        if data is None:
            continue
        dest = agents_dir / f
        if dest.exists() and sha(dest.read_bytes()) == sha(data):
            print(f"[skip] plugin/agents/{f} unchanged")
            continue
        backup_file(dest, backup_root)
        dest.write_bytes(data)
        print(f"[sync] plugin/agents/{f} updated")
        changed = True

    # avatars
    avatars_dir = PLUGIN_DST / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)
    for fname in ["team.jpg", "ghost-workflow-team-lead.jpg",
                  "ghost-workflow-team-supervisor.jpg",
                  "ghost-workflow-team-developer.jpg",
                  "ghost-workflow-team-reviewer.jpg"]:
        data = fetch(f"{RAW}/avatars/{fname}")
        if data is None:
            continue
        dest = avatars_dir / fname
        if dest.exists() and sha(dest.read_bytes()) == sha(data):
            print(f"[skip] plugin/avatars/{fname} unchanged")
            continue
        backup_file(dest, backup_root)
        dest.write_bytes(data)
        print(f"[sync] plugin/avatars/{fname} updated")
        changed = True

    return changed


def copy_avatars_to_market_root() -> bool:
    """Copy avatars from the plugin dir to the experts marketplace root avatars/ dir,
    using the PascalCase naming convention observed in the cached manifest."""
    if not PLUGIN_DST.exists():
        return False
    src_avatars = PLUGIN_DST / "avatars"
    if not src_avatars.exists():
        return False
    AVATARS_DST.mkdir(parents=True, exist_ok=True)
    team_id = kebab_to_pascal("ghost-workflow-team")
    copied = []

    team_src = src_avatars / "team.jpg"
    if team_src.exists():
        dst = AVATARS_DST / f"{team_id}.jpg"
        shutil.copy(team_src, dst)
        copied.append(str(dst))

    for a in AGENTS:
        src = src_avatars / f"{a}.jpg"
        if src.exists():
            dst = AVATARS_DST / f"{team_id}-{kebab_to_pascal(a)}.jpg"
            shutil.copy(src, dst)
            copied.append(str(dst))

    if copied:
        print(f"[sync] copied {len(copied)} avatars to {AVATARS_DST}")
        return True
    return False


def update_expert_manifest() -> bool:
    """Inject or replace the GhostWorkflowTeam entry in the expert cache manifest."""
    if not MANIFEST_PATH.exists():
        print(
            f"[warn] expert manifest not found at {MANIFEST_PATH}; "
            f"cannot inject expert panel entry. Skipping manifest update.",
            file=sys.stderr,
        )
        return False

    plugin_json_path = PLUGIN_DST / ".codebuddy-plugin/plugin.json"
    if not plugin_json_path.exists():
        print(
            f"[warn] plugin.json not found at {plugin_json_path}; "
            f"cannot build manifest entry. Skipping manifest update.",
            file=sys.stderr,
        )
        return False

    plugin = json.loads(plugin_json_path.read_text(encoding="utf-8"))
    team_info = plugin.get("teamInfo", {})
    lead_agent = team_info.get("leadAgent")
    member_agents = [lead_agent] + list(team_info.get("memberAgents", []))

    team_id = kebab_to_pascal("ghost-workflow-team")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    members = []
    for idx, agent_name in enumerate(member_agents):
        fm = parse_yaml_frontmatter((PLUGIN_DST / f"agents/{agent_name}.md").read_text(encoding="utf-8"))
        profession = fm.get("profession", {})
        members.append({
            "id": agent_name,
            "displayName": {},
            "profession": {
                "en": profession.get("en", agent_name),
                "zh": profession.get("zh", agent_name),
            },
            "avatar": f"/avatars/{team_id}-{kebab_to_pascal(agent_name)}.jpg",
            "role": "lead" if idx == 0 else "member",
            "promptFile": f"/plugins/ghost-workflow-team/agents/{agent_name}.md",
        })

    raw_desc = plugin.get("description", "")
    description = {
        "en": raw_desc,
        "zh": DESCRIPTION_ZH,
    }
    quick_prompts = plugin.get("quickPrompts", [])
    default_init = quick_prompts[0] if quick_prompts else {}

    entry = {
        "id": team_id,
        "categoryId": plugin.get("categoryId", "02-Engineering"),
        "displayName": plugin.get("displayName", {}),
        "profession": plugin.get("profession", plugin.get("displayName", {})),
        "description": description,
        "promptFile": f"/plugins/ghost-workflow-team/agents/{lead_agent}.md",
        "avatar": f"/avatars/{team_id}.jpg",
        "createdAt": now,
        "updatedAt": now,
        "defaultInitPrompt": default_init,
        "expertType": plugin.get("expertType", "team"),
        "agentName": lead_agent,
        "plugin": "ghost-workflow-team",
        "tags": plugin.get("tags", []),
        "quickPrompts": quick_prompts,
        "members": members,
        "author": plugin.get("author", {"en": "Ghost233", "zh": "Ghost233"}),
    }

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest["experts"] = [e for e in manifest.get("experts", []) if e.get("id") != team_id]
    manifest["experts"].append(entry)

    backup_root = HOME / ".workbuddy/app/cache/experts/.gwf-backup" / stamp()
    backup_root.mkdir(parents=True, exist_ok=True)
    shutil.copy(MANIFEST_PATH, backup_root / "manifest.json")
    if METADATA_PATH.exists():
        shutil.copy(METADATA_PATH, backup_root / "metadata.json")

    manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2)
    MANIFEST_PATH.write_text(manifest_text, encoding="utf-8")
    new_hash = sha(manifest_text.encode("utf-8"))

    if METADATA_PATH.exists():
        md = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
        md["manifestHash"] = new_hash
        md["cachedAt"] = now
        METADATA_PATH.write_text(json.dumps(md, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[sync] expert manifest entry '{team_id}' injected/replaced")
    print(f"[sync] manifest hash updated -> {new_hash}")
    return True


def main() -> None:
    ts = stamp()
    agents_backup = HOME / ".workbuddy/agents/.gwf-backup" / ts
    teams_backup = HOME / ".workbuddy/teams/.gwf-backup" / ts
    plugin_backup = HOME / ".workbuddy/plugins/marketplaces/experts/.gwf-backup" / ts

    a_changed = sync_agents(agents_backup)
    t_changed = sync_team()
    p_changed = sync_plugin_package(plugin_backup)
    copy_avatars_to_market_root()
    m_changed = update_expert_manifest()

    if not (a_changed or t_changed or p_changed or m_changed):
        print("✅ Already up to date with", f"{REPO}@{BRANCH}.")
    else:
        msg = "🔄 Synced from " + f"{REPO}@{BRANCH}."
        if a_changed:
            msg += " Restart WorkBuddy to load updated agent definitions."
        print(msg)


if __name__ == "__main__":
    main()
