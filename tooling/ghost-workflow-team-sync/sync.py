#!/usr/bin/env python3
"""Sync the latest Ghost Workflow Delivery Team definitions from GitHub into the
local WorkBuddy install.

Why this exists:
    WorkBuddy's current version does NOT scan custom plugin marketplaces and does
    NOT auto-update manually registered marketplaces. So "remote update" is done by
    pulling the latest files straight from the GitHub repo and writing them to the
    local install paths. Functionally equivalent to marketplace auto-update.

What it syncs:
    - Agent definitions  -> ~/.workbuddy/agents/ghost-workflow-team-*.md
    - Team instance meta  -> ~/.workbuddy/teams/ghost-workflow-team/config.json

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


def main() -> None:
    backup_root = HOME / ".workbuddy/agents/.gwf-backup" / stamp()
    a_changed = sync_agents(backup_root)
    t_changed = sync_team()
    if not a_changed and not t_changed:
        print("✅ Already up to date with", f"{REPO}@{BRANCH}.")
    else:
        msg = "🔄 Synced from " + f"{REPO}@{BRANCH}."
        if a_changed:
            msg += " Restart WorkBuddy to load updated agent definitions."
        print(msg)


if __name__ == "__main__":
    main()
