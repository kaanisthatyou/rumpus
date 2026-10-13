"""How a node runs one request on one agent. Two kinds:

claude-code   Claude Code, headless, in the agent's folder. `mode` decides what it may touch:
                read  only the Read, Grep and Glob tools (the default)
                edit  those plus Edit and Write, edits accepted without asking; no shell
                full  everything, permissions bypassed: whoever may call the agent can run anything here
              No MCP servers unless the agent names an `mcp` config file.
command       Any program: `command` is its argument list, `{prompt}` is replaced by the request (without
              the placeholder the request goes to its stdin). What it prints is the answer. It runs with
              this user's rights, so its mode is shown as "custom".
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import threading
from pathlib import Path
from typing import Callable

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
KINDS = ("claude-code", "command")
CLAUDE_MODES = {
    "read": ["--tools", "Read,Grep,Glob"],
    "edit": ["--tools", "Read,Grep,Glob,Edit,Write", "--permission-mode", "acceptEdits"],
    "full": ["--dangerously-skip-permissions"],
}
# Set by a Claude Code session for its own children: an agent started from inside one must not inherit them
SESSION_ENV = ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION",
               "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN",
               "CLAUDE_CODE_EXECPATH", "CLAUDE_PID", "CLAUDE_EFFORT")
_ARG_KEYS = ("file_path", "path", "pattern", "command", "query", "url", "description", "prompt")


def find_claude() -> str | None:
    """Prefer the real claude.exe behind npm's claude.cmd wrapper (a .cmd mangles multi-line arguments)."""
    found = shutil.which("claude")
    if found:
        exe = Path(found).parent / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe"
        return str(exe) if exe.exists() else found
    for candidate in (Path.home() / ".local" / "bin" / "claude.exe", Path.home() / ".local" / "bin" / "claude",
                      Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "claude" / "claude.exe"):
        if candidate.is_file():
            return str(candidate)
    return None


def shown_mode(agent: dict) -> str:
    return agent.get("mode", "read") if agent.get("kind") == "claude-code" else "custom"


def check(agent: dict) -> str | None:
    """Why this agent cannot run here, or None."""
    if agent.get("kind") not in KINDS:
        return f"unknown kind {agent.get('kind')!r}"
    if not Path(agent.get("dir") or "").is_dir():
        return f"folder not found: {agent.get('dir')}"
    if agent["kind"] == "claude-code":
        if agent.get("mode", "read") not in CLAUDE_MODES:
            return f"unknown mode {agent.get('mode')!r}"
        if not find_claude():
            return "Claude Code is not installed (no `claude` on PATH)"
    elif not (isinstance(agent.get("command"), list) and agent["command"] and all(isinstance(a, str) for a in agent["command"])):
        return "`command` must be a list of strings"
    return None


def _tool_arg(root: Path, tool_input) -> str:
    if not isinstance(tool_input, dict):
        return ""
    for key in _ARG_KEYS:
        value = tool_input.get(key)
        if isinstance(value, str) and value.strip():
            text = value.strip()
            if key == "file_path":
                try:
                    text = str(Path(text).resolve().relative_to(root)).replace("\\", "/")
                except ValueError:
                    pass
            first = text.splitlines()[0]
            return first[:110] + ("…" if len(first) > 110 or "\n" in text else "")
    return ""


class Run:
    """One request on one agent. `start()` blocks and returns (status, text, error, usage)."""

    def __init__(self, agent: dict, prompt: str, system: str, on_step: Callable[[dict], None]):
        self.agent, self.prompt, self.system, self.on_step = agent, prompt, system, on_step
        self._proc: subprocess.Popen | None = None
        self._ended: str | None = None  # "stopped" or "timeout" when it was killed on purpose

    def stop(self, reason: str = "stopped") -> None:
        proc = self._proc
        if not proc or proc.poll() is not None:
            return
        self._ended = self._ended or reason
        if os.name == "nt":  # the CLI starts children of its own: take the whole tree
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, creationflags=NO_WINDOW)
        else:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except OSError:
                proc.kill()

    def start(self) -> tuple[str, str, str, dict]:
        problem = check(self.agent)
        if problem:
            return "failed", "", problem, {}
        timer = threading.Timer(float(self.agent.get("timeout") or 900), lambda: self.stop("timeout"))
        timer.daemon = True
        timer.start()
        try:
            status, text, error, usage = self._claude() if self.agent["kind"] == "claude-code" else self._command()
        except OSError as exc:
            return "failed", "", f"{type(exc).__name__}: {exc}", {}
        finally:
            timer.cancel()
        if self._ended == "stopped":
            return "stopped", text, "", usage
        if self._ended == "timeout":
            return "failed", text, "timeout", usage
        return status, text, error, usage

    def _popen(self, args: list[str]) -> subprocess.Popen:
        env = {k: v for k, v in os.environ.items() if k not in SESSION_ENV}
        self._proc = subprocess.Popen(
            args, cwd=self.agent["dir"], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=NO_WINDOW, start_new_session=os.name != "nt")
        return self._proc

    def _feed(self, proc: subprocess.Popen, text: str | None) -> list[str]:
        """Write the prompt to stdin and collect stderr on the side; returns the list stderr lands in."""
        errors: list[str] = []
        threading.Thread(target=lambda: errors.extend(l.decode("utf-8", "replace") for l in proc.stderr), daemon=True).start()
        try:
            if text is not None:
                proc.stdin.write(text.encode("utf-8"))
            proc.stdin.close()
        except OSError:
            pass
        return errors

    def _claude(self) -> tuple[str, str, str, dict]:
        agent, root = self.agent, Path(self.agent["dir"]).resolve()
        args = [find_claude(), "-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
                "--strict-mcp-config", *(["--mcp-config", agent["mcp"]] if agent.get("mcp") else []),
                *CLAUDE_MODES[agent.get("mode", "read")], *(["--model", agent["model"]] if agent.get("model") else []),
                "--append-system-prompt", self.system]
        proc = self._popen(args)
        errors = self._feed(proc, self.prompt)
        text, error, usage, done = "", "", {}, None
        for raw in proc.stdout:
            try:
                ev = json.loads(raw.decode("utf-8", "replace"))
            except json.JSONDecodeError:
                continue
            kind = ev.get("type")
            if kind == "assistant" and not ev.get("parent_tool_use_id"):
                for block in (ev.get("message") or {}).get("content") or []:
                    if block.get("type") == "text" and block.get("text", "").strip():
                        text = block["text"].strip()
                        self.on_step({"kind": "text", "text": text[:600]})
                    elif block.get("type") == "tool_use":
                        self.on_step({"kind": "tool", "label": block.get("name", ""), "arg": _tool_arg(root, block.get("input"))})
            elif kind == "result":
                u = ev.get("usage") or {}
                usage = {"in": (u.get("input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0),
                         "cached": u.get("cache_read_input_tokens") or 0, "out": u.get("output_tokens") or 0}
                done = not ev.get("is_error")
                if isinstance(ev.get("result"), str) and ev["result"].strip():
                    text = ev["result"].strip()
                if not done:
                    error = text or str(ev.get("subtype") or "error")
        proc.wait()
        if done is None:
            return "failed", text, ("".join(errors).strip() or f"claude exited with code {proc.returncode}")[-600:], usage
        return ("done", text, "", usage) if done else ("failed", "", error[:600], usage)

    def _command(self) -> tuple[str, str, str, dict]:
        command = self.agent["command"]
        inline = any("{prompt}" in a for a in command)
        proc = self._popen([a.replace("{prompt}", self.prompt) for a in command])
        errors = self._feed(proc, None if inline else self.prompt)
        lines: list[str] = []
        for raw in proc.stdout:
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            lines.append(line)
            if line.strip() and len(lines) <= 200:
                self.on_step({"kind": "text", "text": line[:600]})
        proc.wait()
        text = "\n".join(lines).strip()
        if proc.returncode != 0:
            return "failed", text, ("".join(errors).strip() or f"exit code {proc.returncode}")[-600:], {}
        return "done", text, "", {}
