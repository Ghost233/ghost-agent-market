#!/usr/bin/env python3
"""Detach the Goal DAG dashboard server and report its local URL."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen


CONTRACT = "DAG_DASHBOARD_START_V1"
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


class StartError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Start the read-only Goal DAG dashboard as a detached process."
    )
    parser.add_argument("plan", type=Path, help="absolute or relative plan.json path")
    parser.add_argument(
        "state",
        nargs="?",
        type=Path,
        help="state.json path; defaults to the plan.json sibling",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7357)
    parser.add_argument("--allow-remote", action="store_true")
    return parser.parse_args()


def display_url(host: str, port: int) -> str:
    rendered_host = f"[{host}]" if ":" in host and not host.startswith("[") else host
    return f"http://{rendered_host}:{port}/"


def probe_url(host: str, port: int) -> str:
    if host in {"0.0.0.0", "::"}:
        host = "127.0.0.1" if host == "0.0.0.0" else "::1"
    return display_url(host, port)


def read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise StartError(f"cannot read JSON from {path}: {error}") from error
    if not isinstance(payload, dict):
        raise StartError(f"expected a JSON object in {path}")
    return payload


def pid_is_alive(pid: object) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def probe_dashboard(base_url: str, goal_id: str) -> bool:
    try:
        with urlopen(f"{base_url}healthz", timeout=0.5) as response:
            health = json.loads(response.read())
        with urlopen(f"{base_url}api/snapshot", timeout=0.8) as response:
            snapshot = json.loads(response.read())
    except (OSError, URLError, TimeoutError, json.JSONDecodeError):
        return False
    return (
        health == {"status": "ok"}
        and snapshot.get("contract") == "DAG_DASHBOARD_SNAPSHOT_V1"
        and snapshot.get("goal", {}).get("id") == goal_id
    )


def write_descriptor(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(f".tmp-{os.getpid()}")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    os.replace(temporary, path)


def log_tail(path: Path, limit: int = 20) -> str:
    try:
        return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:])
    except OSError:
        return ""


def start() -> dict[str, Any]:
    args = parse_args()
    plan_path = args.plan.expanduser().absolute()
    state_path = (
        args.state.expanduser().absolute()
        if args.state is not None
        else plan_path.with_name("state.json")
    )
    if not plan_path.is_file():
        raise StartError(f"plan file does not exist: {plan_path}")
    if not state_path.is_file():
        raise StartError(f"state file does not exist: {state_path}")
    if not 1 <= args.port <= 65535:
        raise StartError("--port must be between 1 and 65535")
    if args.host not in LOOPBACK_HOSTS and not args.allow_remote:
        raise StartError("non-loopback --host requires explicit --allow-remote")

    plan = read_json(plan_path)
    goal_id = plan.get("goal_id")
    if not isinstance(goal_id, str) or not goal_id:
        raise StartError(f"plan is missing goal_id: {plan_path}")

    driver_path = Path(__file__).resolve().with_name("goal-dag.mjs")
    if not driver_path.is_file():
        raise StartError(f"Goal DAG driver is missing: {driver_path}")
    node = shutil.which("node")
    if node is None:
        raise StartError("node executable is not available on PATH")

    public_url = display_url(args.host, args.port)
    health_url = probe_url(args.host, args.port)
    progress_document_path = plan_path.with_name("progress.json")
    progress_document_url = f"{public_url}api/progress-document"
    progress_events_path = plan_path.with_name("events.jsonl")
    progress_events_url = f"{public_url}api/progress-events"
    identity = "\n".join(
        (str(plan_path), str(state_path), args.host, str(args.port))
    ).encode("utf-8")
    runtime_id = hashlib.sha256(identity).hexdigest()[:20]
    runtime_dir = Path(tempfile.gettempdir()) / "ghost-agent-workflow-dashboard"
    runtime_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        runtime_dir.chmod(0o700)
    except OSError:
        pass
    descriptor_path = runtime_dir / f"{runtime_id}.json"
    log_path = runtime_dir / f"{runtime_id}.log"

    descriptor: dict[str, Any] = {}
    if descriptor_path.is_file():
        try:
            descriptor = read_json(descriptor_path)
        except StartError:
            descriptor = {}
    descriptor_matches = (
        descriptor.get("plan_path") == str(plan_path)
        and descriptor.get("state_path") == str(state_path)
        and descriptor.get("host") == args.host
        and descriptor.get("port") == args.port
    )
    if descriptor_matches and pid_is_alive(descriptor.get("pid")):
        for _ in range(10):
            if probe_dashboard(health_url, goal_id):
                return {
                    "contract": CONTRACT,
                    "status": "already_running",
                    "url": public_url,
                    "pid": descriptor["pid"],
                    "log_path": str(log_path),
                    "descriptor_path": str(descriptor_path),
                    "progress_document_path": str(progress_document_path),
                    "progress_document_url": progress_document_url,
                    "progress_events_path": str(progress_events_path),
                    "progress_events_url": progress_events_url,
                    "read_only": True,
                }
            time.sleep(0.1)
        raise StartError(
            f"tracked dashboard process {descriptor['pid']} is alive but not healthy"
        )

    if probe_dashboard(health_url, goal_id):
        return {
            "contract": CONTRACT,
            "status": "already_running",
            "url": public_url,
            "pid": None,
            "log_path": None,
            "descriptor_path": None,
            "progress_document_path": str(progress_document_path),
            "progress_document_url": progress_document_url,
            "progress_events_path": str(progress_events_path),
            "progress_events_url": progress_events_url,
            "read_only": True,
        }

    command = [
        node,
        str(driver_path),
        "dashboard",
        str(plan_path),
        str(state_path),
        "--host",
        args.host,
        "--port",
        str(args.port),
    ]
    if args.allow_remote:
        command.append("--allow-remote")
    environment = os.environ.copy()
    environment.pop("GOAL_DAG_EXECUTION_PLATFORM", None)
    with log_path.open("ab", buffering=0) as log_file:
        process = subprocess.Popen(
            command,
            cwd=str(plan_path.parent),
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            close_fds=True,
        )

    descriptor = {
        "contract": CONTRACT,
        "pid": process.pid,
        "url": public_url,
        "plan_path": str(plan_path),
        "state_path": str(state_path),
        "host": args.host,
        "port": args.port,
        "log_path": str(log_path),
        "progress_document_path": str(progress_document_path),
        "progress_document_url": progress_document_url,
        "progress_events_path": str(progress_events_path),
        "progress_events_url": progress_events_url,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    write_descriptor(descriptor_path, descriptor)

    for _ in range(80):
        if probe_dashboard(health_url, goal_id):
            return {
                "contract": CONTRACT,
                "status": "started",
                "url": public_url,
                "pid": process.pid,
                "log_path": str(log_path),
                "descriptor_path": str(descriptor_path),
                "progress_document_path": str(progress_document_path),
                "progress_document_url": progress_document_url,
                "progress_events_path": str(progress_events_path),
                "progress_events_url": progress_events_url,
                "read_only": True,
            }
        return_code = process.poll()
        if return_code is not None:
            descriptor_path.unlink(missing_ok=True)
            details = log_tail(log_path)
            suffix = f"\n{details}" if details else ""
            raise StartError(
                f"dashboard exited during startup with code {return_code}{suffix}"
            )
        time.sleep(0.1)

    try:
        process.terminate()
    except ProcessLookupError:
        pass
    descriptor_path.unlink(missing_ok=True)
    raise StartError(f"dashboard did not become healthy; see {log_path}")


def main() -> int:
    try:
        payload = start()
    except StartError as error:
        payload = {"contract": CONTRACT, "status": "error", "error": str(error)}
        print(json.dumps(payload, ensure_ascii=False))
        return 1
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
