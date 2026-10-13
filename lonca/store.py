"""Where Lonca keeps its files: ~/.lonca, or LONCA_HOME (tests, a second instance on one machine).

hub/                the server hosted on this machine (hub.py)
servers/<id>.json   one profile per server this machine has joined: hub address, this machine's token, its agents
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

_lock = threading.Lock()


def home() -> Path:
    return Path(os.environ.get("LONCA_HOME") or (Path.home() / ".lonca"))


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def write_json(path: Path, data) -> None:
    """Whole-file replace, so a crash mid-write never leaves half a file."""
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, path)


def append_jsonl(path: Path, row: dict) -> None:
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def tail_jsonl(path: Path, limit: int) -> list[dict]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    rows = []
    for line in lines[-limit:]:
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue  # a line cut off by a crash
    return rows


def profiles() -> list[Path]:
    return sorted((home() / "servers").glob("*.json"))
