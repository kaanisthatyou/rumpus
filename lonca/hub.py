"""The server: members, channels, messages, and the jobs it hands to the agents on members' machines.

One hub is one server. People reach it from a browser (desktop or phone); each member's machine runs a
node (node.py) that connects out to the hub and runs that member's agents. Nothing connects in to a
member's machine.

Who may do what:
- Every call but joining carries a device token (cookie for browsers, Authorization header for nodes).
  Tokens are stored hashed. A member gets one by redeeming an invite (a new member) or a pair code
  (one more device for a member who is already in: a phone, another computer).
- A message starts a job for each agent it @mentions, when the agent's owner wrote it or the agent is
  open to everyone. Only a person's message can start a job, never an agent's answer.
- The hub only passes prompts on. Which agents exist, what they may touch and where they run is set on
  the owner's machine and is not changeable from here.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import queue
import re
import secrets
import threading
import time
import unicodedata
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import VERSION
from .net import qr_svg
from .store import append_jsonl, read_json, tail_jsonl, write_json

UI_DIR = Path(__file__).resolve().parent / "ui"
HANDLE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,31}$")
MENTION = re.compile(r"(?<![\w@./])@([A-Za-z0-9][\w-]{1,31})")
MODES = ("read", "edit", "full", "custom")
ACCESS = ("owner", "everyone")
ACTIVE = ("queued", "running")
COLORS = ("#ffb43a", "#4fd6c8", "#c49bff", "#8cf5a0", "#7ab8ff", "#ff8fa3", "#f5d76e", "#ff9a5c")
MAX_TEXT = 20_000
MAX_BODY = 1_000_000
MAX_STEPS = 400
CONTEXT = 20          # channel messages an agent gets with a request
TAIL = 300            # messages per channel kept in memory
INVITE_TTL = 24 * 3600
PAIR_TTL = 600
NODE_GRACE = 30       # seconds a node may be gone before its running jobs count as failed
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"}


class HubError(Exception):
    """A refusal the caller can show: `code` is translated by the UI."""

    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code, self.status = code, status


def slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.replace("ı", "i").replace("İ", "I"))
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")[:32]


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _clip(value, limit: int) -> str:
    text = value if isinstance(value, str) else ""
    return text[:limit]


class Hub:
    def __init__(self, directory: Path):
        self.dir = directory
        self._lock = threading.RLock()
        self.server: dict = read_json(directory / "server.json", {})
        self.members: dict[str, dict] = read_json(directory / "members.json", {})
        self.devices: dict[str, dict] = read_json(directory / "devices.json", {})
        self.invites: dict[str, dict] = read_json(directory / "invites.json", {})
        self.channels: list[dict] = read_json(directory / "channels.json", [])
        self.agents: dict[str, dict] = read_json(directory / "agents.json", {})
        for agent in self.agents.values():  # nothing is connected yet
            agent["online"] = agent["busy"] = False
        self.jobs: dict[str, dict] = {j["id"]: j for j in tail_jsonl(directory / "jobs.jsonl", 500) if j.get("id")}
        self.addresses: list[dict] = []   # [{"label", "url"}] the launcher found, best first
        self._pairs: dict[str, dict] = {}
        self._tails: dict[str, list[dict]] = {}
        self._last_id = 0
        self._clients: list[tuple[str, str, queue.Queue]] = []   # (member id, device id, stream)
        self._nodes: dict[str, queue.Queue] = {}                 # device id -> stream
        self._grace: dict[str, threading.Timer] = {}
        self._servers: dict[str, ThreadingHTTPServer] = {}
        self._seen_saved = 0.0

    # ------------------------------------------------------------ setup
    @property
    def exists(self) -> bool:
        return bool(self.server.get("id"))

    def setup(self, server_name: str, owner_name: str) -> dict:
        """A new server with its owner and a #general channel. Returns the owner."""
        if self.exists:
            raise HubError("server_exists")
        with self._lock:
            self.server = {"id": secrets.token_hex(4), "name": _clip(server_name.strip(), 48) or "Lonca",
                           "created": time.time(), "owner": ""}
            owner = self._new_member(owner_name, "owner")
            self.server["owner"] = owner["id"]
            self.channels = [{"id": "general", "name": "general", "created": time.time(), "by": owner["id"]}]
            self._save("server", "channels")
        return owner

    def _save(self, *names: str) -> None:
        for name in names:
            write_json(self.dir / f"{name}.json", getattr(self, name))

    # ------------------------------------------------------------ members and devices
    def _new_member(self, name: str, role: str = "member") -> dict:
        name = " ".join(_clip(name, 64).split())[:32]
        if not name:
            raise HubError("name_needed")
        if any(m["name"].casefold() == name.casefold() for m in self.members.values()):
            raise HubError("name_taken", 409)
        base = slug(name) or "member"
        mid, n = base, 2
        while mid in self.members:
            mid, n = f"{base}-{n}", n + 1
        member = {"id": mid, "name": name, "role": role, "created": time.time(),
                  "color": COLORS[len(self.members) % len(COLORS)]}
        self.members[mid] = member
        self._save("members")
        return member

    def new_device(self, member_id: str, kind: str, name: str = "") -> str:
        """A token for one more browser or node of this member: `<device id>.<secret>`."""
        with self._lock:
            did, secret = secrets.token_hex(6), secrets.token_urlsafe(32)
            self.devices[did] = {"id": did, "member": member_id, "kind": "node" if kind == "node" else "browser",
                                 "name": _clip(name, 48), "hash": _hash(secret), "created": time.time(), "seen": time.time()}
            self._save("devices")
        return f"{did}.{secret}"

    def auth(self, token: str | None) -> tuple[dict, dict] | None:
        did, _, secret = (token or "").partition(".")
        device = self.devices.get(did)
        if not device or not secret or not hmac.compare_digest(device["hash"], _hash(secret)):
            return None
        member = self.members.get(device["member"])
        if not member:
            return None
        device["seen"] = time.time()
        if device["seen"] - self._seen_saved > 300:  # "last seen" is a hint; not worth a write per call
            self._seen_saved = device["seen"]
            self._save("devices")
        return member, device

    def devices_of(self, member: dict, current: dict) -> list[dict]:
        return [{"id": d["id"], "kind": d["kind"], "name": d["name"], "created": d["created"], "seen": d["seen"],
                 "current": d["id"] == current["id"], "online": self._device_online(d["id"])}
                for d in self.devices.values() if d["member"] == member["id"]]

    def _device_online(self, did: str) -> bool:
        return did in self._nodes or any(c[1] == did for c in self._clients)

    def revoke(self, member: dict, device_id: str) -> None:
        with self._lock:
            device = self.devices.get(device_id)
            if not device or device["member"] != member["id"]:
                raise HubError("no_device", 404)
            del self.devices[device_id]
            self._save("devices")
            for _, did, q in list(self._clients):
                if did == device_id:
                    q.put(None)
            if device_id in self._nodes:
                self._nodes[device_id].put(None)

    # ------------------------------------------------------------ invites and pair codes
    def links(self, path: str) -> list[dict]:
        out = []
        for a in self.addresses:
            url = a["url"].rstrip("/") + path
            out.append({"label": a["label"], "url": url, "local": bool(a.get("local")), "qr": qr_svg(url)})
        return out

    def invite(self, member: dict) -> dict:
        with self._lock:
            now = time.time()
            self.invites = {c: i for c, i in self.invites.items() if i["expires"] > now}
            code = secrets.token_urlsafe(12)
            self.invites[code] = {"by": member["id"], "created": now, "expires": now + INVITE_TTL}
            self._save("invites")
        return {"code": code, "expires": now + INVITE_TTL, "links": self.links(f"/j/{code}")}

    def invite_info(self, code: str) -> dict:
        invite = self.invites.get(code)
        ok = bool(invite and invite["expires"] > time.time())
        by = self.members.get(invite["by"], {}).get("name") if ok else None
        return {"server": self.server.get("name"), "version": VERSION, "invite": ok, "by": by}

    def join(self, code: str, name: str, kind: str = "browser", device_name: str = "") -> tuple[dict, str]:
        """Redeem an invite: a new member and their first device. An invite works once."""
        with self._lock:
            invite = self.invites.get(code)
            if not invite or invite["expires"] <= time.time():
                raise HubError("invite_invalid", 403)
            member = self._new_member(name)
            del self.invites[code]
            self._save("invites")
            token = self.new_device(member["id"], kind, device_name)
            self._post("general", {"kind": "system"}, sys={"code": "joined", "name": member["name"]})
            self._roster()
        return member, token

    def pair(self, member: dict, kind: str = "browser") -> dict:
        """A short-lived, one-time code that signs one more device in as this member."""
        with self._lock:
            now = time.time()
            self._pairs = {c: p for c, p in self._pairs.items() if p["expires"] > now}
            code = secrets.token_urlsafe(12)
            self._pairs[code] = {"member": member["id"], "kind": "node" if kind == "node" else "browser",
                                 "expires": now + PAIR_TTL}
        return {"code": code, "expires": now + PAIR_TTL, "kind": self._pairs[code]["kind"], "links": self.links(f"/p/{code}")}

    def redeem(self, code: str, device_name: str = "") -> tuple[dict, str, str]:
        with self._lock:
            pair = self._pairs.pop(code, None)
            if not pair or pair["expires"] <= time.time() or pair["member"] not in self.members:
                raise HubError("pair_invalid", 403)
            return self.members[pair["member"]], self.new_device(pair["member"], pair["kind"], device_name), pair["kind"]

    # ------------------------------------------------------------ channels and messages
    def _channel(self, cid: str) -> dict:
        channel = next((c for c in self.channels if c["id"] == cid), None)
        if not channel:
            raise HubError("no_channel", 404)
        return channel

    def new_channel(self, member: dict, name: str) -> dict:
        with self._lock:
            cid = slug(name)
            if not cid:
                raise HubError("name_needed")
            if any(c["id"] == cid for c in self.channels):
                raise HubError("channel_exists", 409)
            if len(self.channels) >= 100:
                raise HubError("too_many_channels")
            channel = {"id": cid, "name": cid, "created": time.time(), "by": member["id"]}
            self.channels.append(channel)
            self._save("channels")
            self._emit({"kind": "channels", "channels": self.channels})
        return channel

    def _tail(self, cid: str) -> list[dict]:
        if cid not in self._tails:
            self._tails[cid] = tail_jsonl(self.dir / "messages" / f"{cid}.jsonl", TAIL)
        return self._tails[cid]

    def _post(self, cid: str, frm: dict, text: str = "", sys: dict | None = None, job: str | None = None) -> dict:
        with self._lock:
            self._last_id = max(self._last_id + 1, int(time.time() * 1000))
            msg = {"id": self._last_id, "ts": time.time(), "ch": cid, "from": frm, "text": text}
            if sys:
                msg["sys"] = sys
            if job:
                msg["job"] = job
            tail = self._tail(cid)
            tail.append(msg)
            del tail[:-TAIL]
            append_jsonl(self.dir / "messages" / f"{cid}.jsonl", msg)
            self._emit({"kind": "msg", "msg": msg})
        return msg

    def send(self, member: dict, cid: str, text: str) -> dict:
        text = (text or "").strip()
        if not text:
            raise HubError("empty")
        if len(text) > MAX_TEXT:
            raise HubError("too_long", 413)
        with self._lock:
            self._channel(cid)
            msg = self._post(cid, {"kind": "member", "id": member["id"], "name": member["name"]}, text)
            self._mentions(member, msg)
        return msg

    def messages(self, cid: str, before: int | None = None, limit: int = 80) -> dict:
        with self._lock:
            self._channel(cid)
            rows = self._tail(cid)
            if before:
                rows = [m for m in rows if m["id"] < before]
            rows = rows[-limit:]
            jobs = {m["job"]: self.jobs[m["job"]] for m in rows if m.get("job") in self.jobs}
            return {"messages": rows, "jobs": jobs}

    # ------------------------------------------------------------ agents and jobs
    def _mentions(self, member: dict, msg: dict) -> None:
        seen: list[str] = []
        for handle in (h.lower() for h in MENTION.findall(msg["text"])):
            agent = self.agents.get(handle)
            if not agent or handle in seen or len(seen) >= 3:
                continue
            seen.append(handle)
            if agent["owner"] != member["id"] and agent["access"] != "everyone":
                owner = self.members.get(agent["owner"], {}).get("name", "?")
                self._post(msg["ch"], {"kind": "system"}, sys={"code": "agent_private", "agent": handle, "owner": owner})
            elif not agent["online"]:
                self._post(msg["ch"], {"kind": "system"}, sys={"code": "agent_offline", "agent": handle})
            else:
                self._start_job(agent, member, msg)

    def _start_job(self, agent: dict, member: dict, msg: dict) -> None:
        job = {"id": secrets.token_hex(6), "agent": agent["handle"], "owner": agent["owner"], "node": agent["node"],
               "ch": msg["ch"], "by": {"id": member["id"], "name": member["name"]}, "msg": msg["id"],
               "prompt": msg["text"], "status": "queued", "steps": [], "text": "", "error": "",
               "created": time.time(), "started": None, "ended": None, "usage": {}}
        self.jobs[job["id"]] = job
        self._emit({"kind": "job", "job": job})  # before its card's message, so the card finds it
        self._post(msg["ch"], {"kind": "agent", "id": agent["handle"], "name": agent["handle"]}, job=job["id"])
        self._deliver(job)

    def _context(self, job: dict) -> list[dict]:
        rows = [m for m in self._tail(job["ch"]) if m["id"] < job["msg"] and not m.get("sys")][-CONTEXT:]
        out = []
        for m in rows:
            text = self.jobs.get(m["job"], {}).get("text", "") if m.get("job") else m["text"]
            if text:
                out.append({"name": m["from"].get("name", ""), "kind": m["from"]["kind"], "text": text[:2000]})
        return out

    def _deliver(self, job: dict) -> None:
        stream = self._nodes.get(job["node"])
        if stream:
            stream.put({"kind": "job", "job": {k: job[k] for k in ("id", "agent", "ch", "by", "prompt")},
                        "context": self._context(job), "server": self.server["name"]})

    def node_hello(self, member: dict, device: dict, data: dict) -> dict:
        """The node says which agents it runs. The list replaces this node's earlier one."""
        if device["kind"] != "node":
            raise HubError("not_a_node", 403)
        accepted, rejected = [], []
        with self._lock:
            mine = {h for h, a in self.agents.items() if a["node"] == device["id"]}
            for spec in (data.get("agents") or [])[:20]:
                handle = _clip(spec.get("handle"), 40).lower()
                current = self.agents.get(handle)
                if not HANDLE.match(handle):
                    rejected.append({"handle": handle, "reason": "bad_handle"})
                elif current and current["owner"] != member["id"]:
                    rejected.append({"handle": handle, "reason": "handle_taken"})
                else:
                    self.agents[handle] = {
                        "handle": handle, "owner": member["id"], "node": device["id"],
                        "kind": _clip(spec.get("kind"), 32), "description": _clip(spec.get("description"), 200),
                        "access": spec.get("access") if spec.get("access") in ACCESS else "owner",
                        "mode": spec.get("mode") if spec.get("mode") in MODES else "read",
                        "online": device["id"] in self._nodes, "busy": bool(current and current.get("busy"))}
                    accepted.append(handle)
            for handle in mine - set(accepted):
                del self.agents[handle]
            if _clip(data.get("name"), 48) and device["name"] != data["name"]:
                device["name"] = _clip(data["name"], 48)
                self._save("devices")
            running = set(data.get("running") or [])
            for job in list(self.jobs.values()):  # jobs this node lost (it restarted)
                if job["node"] == device["id"] and job["status"] == "running" and job["id"] not in running:
                    self._finish(job, "failed", error="node_restarted")
            self._save("agents")
            self._roster()
        return {"agents": accepted, "rejected": rejected, "server": self.public_server(),
                "member": {"id": member["id"], "name": member["name"]}}

    def node_job(self, device: dict, data: dict) -> None:
        with self._lock:
            job = self.jobs.get(data.get("id") or "")
            if not job or job["node"] != device["id"]:
                raise HubError("no_job", 404)
            if job["status"] not in ACTIVE:
                return  # a late update for a job that was stopped or timed out here
            step = data.get("step")
            if isinstance(step, dict) and len(job["steps"]) < MAX_STEPS:
                clean = {"kind": _clip(step.get("kind"), 16), "label": _clip(step.get("label"), 80),
                         "arg": _clip(step.get("arg"), 240), "text": _clip(step.get("text"), 600), "ts": time.time()}
                job["steps"].append(clean)
                self._emit({"kind": "step", "id": job["id"], "step": clean})
            if isinstance(data.get("usage"), dict):
                job["usage"] = {k: int(v) for k, v in data["usage"].items() if k in ("in", "cached", "out") and isinstance(v, (int, float))}
            status = data.get("status")
            if status == "running" and job["status"] == "queued":
                job["status"], job["started"] = "running", time.time()
                self._busy(job["agent"])
                self._emit({"kind": "job", "job": job})
            elif status in ("done", "failed", "stopped"):
                self._finish(job, status, _clip(data.get("text"), MAX_TEXT), _clip(data.get("error"), 600))
            elif isinstance(data.get("usage"), dict):
                self._emit({"kind": "job", "job": {k: v for k, v in job.items() if k != "steps"}, "partial": True})

    def _finish(self, job: dict, status: str, text: str = "", error: str = "") -> None:
        job.update(status=status, text=text, error=error, ended=time.time())
        append_jsonl(self.dir / "jobs.jsonl", job)
        while len(self.jobs) > 600:
            old = next((jid for jid, j in self.jobs.items() if j["status"] not in ACTIVE), None)
            if not old:
                break
            del self.jobs[old]
        self._busy(job["agent"])
        self._emit({"kind": "job", "job": job})

    def _busy(self, handle: str) -> None:
        agent = self.agents.get(handle)
        if agent:
            busy = any(j["agent"] == handle and j["status"] == "running" for j in self.jobs.values())
            if busy != agent["busy"]:
                agent["busy"] = busy
                self._roster()

    def stop(self, member: dict, job_id: str) -> None:
        with self._lock:
            job = self.jobs.get(job_id)
            if not job or job["status"] not in ACTIVE:
                raise HubError("no_job", 404)
            if member["id"] not in (job["by"]["id"], job["owner"], self.server["owner"]):
                raise HubError("not_allowed", 403)
            stream = self._nodes.get(job["node"])
            if stream:
                stream.put({"kind": "stop", "id": job_id})  # the node answers with status "stopped"
            else:
                self._finish(job, "stopped")

    def _node_online(self, device_id: str, stream: queue.Queue) -> None:
        with self._lock:
            old = self._nodes.get(device_id)
            if old:
                old.put(None)
            self._nodes[device_id] = stream
            timer = self._grace.pop(device_id, None)
            if timer:
                timer.cancel()
            for agent in self.agents.values():
                if agent["node"] == device_id:
                    agent["online"] = True
            for job in self.jobs.values():  # asked for while the node was reconnecting
                if job["node"] == device_id and job["status"] == "queued":
                    self._deliver(job)
            self._roster()

    def _node_offline(self, device_id: str, stream: queue.Queue) -> None:
        with self._lock:
            if self._nodes.get(device_id) is not stream:
                return  # a newer stream of the same node took over
            del self._nodes[device_id]
            for agent in self.agents.values():
                if agent["node"] == device_id:
                    agent["online"] = False
            timer = threading.Timer(NODE_GRACE, self._node_gone, args=(device_id,))
            timer.daemon = True
            self._grace[device_id] = timer
            timer.start()
            self._roster()

    def _node_gone(self, device_id: str) -> None:
        with self._lock:
            if device_id in self._nodes:
                return
            self._grace.pop(device_id, None)
            for job in list(self.jobs.values()):
                if job["node"] == device_id and job["status"] in ACTIVE:
                    self._finish(job, "failed", error="node_offline")

    # ------------------------------------------------------------ what clients see
    def public_server(self) -> dict:
        return {"id": self.server["id"], "name": self.server["name"], "owner": self.server["owner"]}

    def roster(self) -> dict:
        online = {c[0] for c in self._clients}
        members = [dict(m, online=m["id"] in online) for m in self.members.values()]
        return {"members": members, "agents": list(self.agents.values())}

    def _roster(self) -> None:
        self._emit(dict(self.roster(), kind="roster"))

    def state(self, member: dict, device: dict) -> dict:
        with self._lock:
            active = [j for j in self.jobs.values() if j["status"] in ACTIVE]
            return dict(self.roster(), version=VERSION, server=self.public_server(), channels=self.channels,
                        me={"id": member["id"], "name": member["name"], "device": device["id"]}, jobs=active,
                        reachable=any(not a.get("local") for a in self.addresses))

    def _emit(self, event: dict) -> None:
        data = json.dumps(event, ensure_ascii=False)
        for _, _, q in list(self._clients):
            q.put(data)

    # ------------------------------------------------------------ listening
    def listen(self, hosts: list[str], port: int) -> list[str]:
        """Listen on these addresses (and stop on the ones no longer wanted). Returns the failures."""
        errors = []
        with self._lock:
            for host in [h for h in self._servers if h not in hosts]:
                server = self._servers.pop(host)
                threading.Thread(target=lambda s=server: (s.shutdown(), s.server_close()), daemon=True).start()
            for host in hosts:
                if host in self._servers:
                    continue
                try:
                    server = ThreadingHTTPServer((host, port), _handler(self))
                except OSError as exc:
                    errors.append(f"{host}:{port}: {exc}")
                    continue
                server.daemon_threads = True
                self._servers[host] = server
                threading.Thread(target=server.serve_forever, daemon=True, name=f"hub-{host}").start()
        return errors

    def close(self) -> None:
        self.listen([], 0)
        for _, _, q in list(self._clients):
            q.put(None)
        for q in list(self._nodes.values()):
            q.put(None)


def _handler(hub: Hub):
    cookie_name = f"lonca_{hub.server['id']}"

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "Lonca"

        def log_message(self, *args) -> None:  # quiet
            pass

        # -------------------------------------------------------- plumbing
        def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, data: dict, code: int = 200, extra: dict | None = None) -> None:
            self._send(code, json.dumps(data, ensure_ascii=False, default=str).encode("utf-8"),
                       "application/json; charset=utf-8", extra)

        def _token(self) -> str | None:
            header = self.headers.get("Authorization") or ""
            if header.startswith("Bearer "):
                return header[7:].strip()
            for part in (self.headers.get("Cookie") or "").split(";"):
                name, _, value = part.strip().partition("=")
                if name == cookie_name:
                    return value
            return None

        def _who(self) -> tuple[dict, dict]:
            who = hub.auth(self._token())
            if not who:
                raise HubError("signed_out", 401)
            return who

        def _cookie(self, token: str) -> dict:
            return {"Set-Cookie": f"{cookie_name}={token}; Max-Age=31536000; Path=/; SameSite=Lax; HttpOnly"}

        def _page(self, extra: dict | None = None) -> None:
            self._send(200, (UI_DIR / "index.html").read_bytes(), TYPES[".html"], extra)

        # -------------------------------------------------------- GET
        def do_GET(self) -> None:  # noqa: N802
            url = urllib.parse.urlsplit(self.path)
            path, query = url.path, urllib.parse.parse_qs(url.query)
            try:
                if path == "/":
                    # the home-screen shortcut carries the token (iOS home-screen apps do not share the browser's cookies)
                    given = (query.get("t") or [""])[0]
                    self._page(self._cookie(given) if given and hub.auth(given) else None)
                elif path.startswith(("/j/", "/p/")):
                    self._page()
                elif path == "/api/info":
                    self._json(hub.invite_info((query.get("code") or [""])[0]))
                elif path == "/api/state":
                    self._json(hub.state(*self._who()))
                elif path == "/api/messages":
                    self._who()
                    before = (query.get("before") or [""])[0]
                    self._json(hub.messages((query.get("ch") or ["general"])[0], int(before) if before.isdigit() else None))
                elif path == "/api/devices":
                    self._json({"devices": hub.devices_of(*self._who())})
                elif path == "/events":
                    member, device = self._who()
                    self._stream(lambda q: hub._clients.append((member["id"], device["id"], q)) or hub._roster(),
                                 lambda q: self._client_gone(q))
                elif path == "/node/events":
                    member, device = self._who()
                    if device["kind"] != "node":
                        raise HubError("not_a_node", 403)
                    # pinged more often than a browser: a node that vanished shows as offline within seconds
                    self._stream(lambda q: hub._node_online(device["id"], q), lambda q: hub._node_offline(device["id"], q), ping=5)
                elif path == "/manifest.webmanifest":
                    token = self._token() if hub.auth(self._token()) else None
                    start = f"/?t={urllib.parse.quote(token)}" if token else "/"
                    manifest = {"name": hub.server["name"], "short_name": hub.server["name"][:12], "start_url": start,
                                "scope": "/", "display": "standalone", "background_color": "#0c0b09", "theme_color": "#0c0b09",
                                "icons": [{"src": "/icon.svg", "sizes": "any", "type": "image/svg+xml"}]}
                    self._send(200, json.dumps(manifest).encode("utf-8"), "application/manifest+json")
                else:
                    target = (UI_DIR / path.lstrip("/")).resolve()
                    if target.parent != UI_DIR or not target.is_file() or target.suffix not in TYPES:
                        self._send(404, b"not found", "text/plain")
                        return
                    self._send(200, target.read_bytes(), TYPES[target.suffix])
            except HubError as exc:
                self._json({"ok": False, "error": exc.code}, exc.status)

        def _client_gone(self, q: queue.Queue) -> None:
            hub._clients[:] = [c for c in hub._clients if c[2] is not q]
            hub._roster()

        def _stream(self, opened, closed, ping: float = 15) -> None:
            q: queue.Queue = queue.Queue()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            try:
                self.wfile.write(f"event: hello\ndata: {json.dumps({'version': VERSION})}\n\n".encode())
                self.wfile.flush()
                opened(q)
                while True:
                    try:
                        item = q.get(timeout=ping)
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")  # keeps mobile networks from dropping an idle stream
                        self.wfile.flush()
                        continue
                    if item is None:
                        break
                    data = item if isinstance(item, str) else json.dumps(item, ensure_ascii=False)
                    self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                    self.wfile.flush()
            except OSError:
                pass
            finally:
                closed(q)
                self.close_connection = True

        # -------------------------------------------------------- POST
        def do_POST(self) -> None:  # noqa: N802
            path = urllib.parse.urlsplit(self.path).path
            try:
                # a custom header, so another site cannot post here with the browser's cookie
                if self.headers.get("X-Lonca") != "1":
                    raise HubError("bad_request")
                length = int(self.headers.get("Content-Length") or 0)
                if length > MAX_BODY:
                    raise HubError("too_long", 413)
                try:
                    data = json.loads(self.rfile.read(length) or b"{}")
                except json.JSONDecodeError:
                    raise HubError("bad_request") from None
                if not isinstance(data, dict):
                    raise HubError("bad_request")
                self._route(path, data)
            except HubError as exc:
                self._json({"ok": False, "error": exc.code}, exc.status)
            except Exception as exc:  # the caller sees the error instead of a hung call
                self._json({"ok": False, "error": "server_error", "detail": f"{type(exc).__name__}: {exc}"}, 500)

        def _route(self, path: str, data: dict) -> None:
            if path == "/api/join":
                kind = "node" if data.get("kind") == "node" else "browser"
                member, token = hub.join(_clip(data.get("code"), 64), _clip(data.get("name"), 64), kind, _clip(data.get("device"), 48))
                body = {"ok": True, "member": member, "server": hub.public_server()}
                self._json(dict(body, token=token) if kind == "node" else body, extra=None if kind == "node" else self._cookie(token))
                return
            if path == "/api/redeem":
                member, token, kind = hub.redeem(_clip(data.get("code"), 64), _clip(data.get("device"), 48))
                body = {"ok": True, "member": member, "server": hub.public_server(), "kind": kind}
                self._json(dict(body, token=token) if kind == "node" else body, extra=None if kind == "node" else self._cookie(token))
                return
            member, device = self._who()
            if path == "/api/send":
                self._json({"ok": True, "msg": hub.send(member, _clip(data.get("ch"), 40), data.get("text") if isinstance(data.get("text"), str) else "")})
            elif path == "/api/channel":
                self._json({"ok": True, "channel": hub.new_channel(member, _clip(data.get("name"), 64))})
            elif path == "/api/invite":
                self._json(dict(hub.invite(member), ok=True))
            elif path == "/api/pair":
                self._json(dict(hub.pair(member, _clip(data.get("kind"), 16)), ok=True))
            elif path == "/api/revoke":
                hub.revoke(member, _clip(data.get("id"), 32))
                self._json({"ok": True})
            elif path == "/api/logout":
                hub.revoke(member, device["id"])
                self._json({"ok": True}, extra={"Set-Cookie": f"{cookie_name}=; Max-Age=0; Path=/"})
            elif path == "/api/stop":
                hub.stop(member, _clip(data.get("id"), 32))
                self._json({"ok": True})
            elif path == "/node/hello":
                self._json(dict(hub.node_hello(member, device, data), ok=True))
            elif path == "/node/job":
                hub.node_job(device, data)
                self._json({"ok": True})
            elif path == "/node/bye":  # the node is closing: its agents go offline now, not at the next ping
                stream = hub._nodes.get(device["id"])
                if stream:
                    stream.put(None)
                self._json({"ok": True})
            else:
                raise HubError("not_found", 404)

    return Handler
