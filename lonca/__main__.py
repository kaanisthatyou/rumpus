"""python -m lonca: host a server, join one, run this machine's agents.

  python -m lonca                     start what is set up here (first time: asks whether to host or join)
  python -m lonca host                make a server on this machine and start it
  python -m lonca join <link>         join a server with an invite link, or add this computer with a pair link
  python -m lonca invite | phone      a link and QR for a new member | for your own phone
  python -m lonca agent list|add|remove
"""
from __future__ import annotations

import argparse
import socket
import sys
import time
import urllib.parse
import webbrowser
from pathlib import Path

from . import DEFAULT_PORT, VERSION
from .agents import KINDS, check, find_claude, shown_mode
from .hub import HANDLE, Hub, slug
from .net import plan
from .node import HubDown, Node, Refused, call
from .store import home, profiles, read_json, write_json


def say(text: str = "") -> None:
    print(text, flush=True)


def fail(text: str) -> None:
    say(f"lonca: {text}")
    sys.exit(1)


def first_agent(name: str, folder: Path) -> list[dict]:
    """A read-only Claude Code agent in this folder, when Claude Code is installed: the server works out of the box."""
    if not find_claude():
        say("Claude Code was not found, so no agent was added. Add one later: python -m lonca agent add …")
        return []
    handle = f"{slug(name) or 'my'}-claude"[:32]
    say(f"Added the agent @{handle}: Claude Code in {folder}, read-only, only you can call it.")
    return [{"handle": handle, "kind": "claude-code", "dir": str(folder), "mode": "read", "access": "owner",
             "description": f"Claude Code in {folder.name}"}]


def agent_folder(args, asked: bool) -> Path:
    """Where the first agent works: --dir, or asked for when the rest of the setup was typed in too."""
    folder = args.dir
    if not folder and asked and not args.no_agent and find_claude():
        folder = input("Folder your first agent works in [this folder]: ").strip().strip('"')
    return Path(folder or ".").expanduser().resolve()


def profile_for(server: str | None) -> Path:
    found = profiles()
    if server:
        found = [p for p in found if p.stem == server or read_json(p, {}).get("server", {}).get("name") == server]
    if not found:
        fail("no server is set up here yet (python -m lonca host, or join <link>)")
    if len(found) > 1:
        names = ", ".join(f"{p.stem} ({read_json(p, {}).get('server', {}).get('name')})" for p in found)
        fail(f"this machine is in several servers, say which with --server: {names}")
    return found[0]


def print_link(link: dict, what: str) -> None:
    say(f"{what}: {link['url']}")
    try:
        import segno
        segno.make(link["url"], error="m").terminal(compact=True, border=1)
    except Exception:  # no segno, or a console that cannot draw it: the link is enough
        pass


# ------------------------------------------------------------ commands
def cmd_host(args) -> None:
    hub = Hub(home() / "hub")
    if hub.exists:
        fail(f"this machine already hosts '{hub.server['name']}'. Start it with: python -m lonca")
    name = args.name or input("Your name: ").strip()
    server = args.server or input("Server name: ").strip() or f"{name}'s server"
    folder = agent_folder(args, asked=not args.name)
    owner = hub.setup(server, name)
    write_json(home() / "hub" / "host.json", {"port": args.port, "lan": bool(args.lan), "url": args.url})
    write_json(home() / "servers" / f"{hub.server['id']}.json", {
        "server": hub.public_server(), "hub": f"http://127.0.0.1:{args.port}", "member": {"id": owner["id"], "name": owner["name"]},
        "token": hub.new_device(owner["id"], "node", socket.gethostname()), "name": socket.gethostname(),
        "agents": [] if args.no_agent else first_agent(name, folder)})
    say(f"Server '{hub.server['name']}' created.")
    serve(args, hub)


def cmd_join(args) -> None:
    url = urllib.parse.urlsplit(args.link)
    kind, _, code = url.path.strip("/").partition("/")
    if url.scheme not in ("http", "https") or kind not in ("j", "p") or not code:
        fail("that does not look like a Lonca link (…/j/<code> or …/p/<code>)")
    base = f"{url.scheme}://{url.netloc}"
    try:
        if kind == "j":
            info = call(base, f"/api/info?code={urllib.parse.quote(code)}")
            if not info.get("invite"):
                fail("this invite was already used or has expired; ask for a new one")
            name = args.name or input(f"Your name in '{info.get('server')}': ").strip()
            answer = call(base, "/api/join", {"code": code, "name": name, "kind": "node", "device": socket.gethostname()})
        else:
            answer = call(base, "/api/redeem", {"code": code, "device": socket.gethostname()})
            if not answer.get("token"):
                fail("this link is for a phone or browser. For a computer use 'Add a computer' in the app.")
    except Refused as exc:
        fail({"name_taken": "that name is taken in this server, pick another with --name",
              "invite_invalid": "this invite was already used or has expired",
              "pair_invalid": "this link was already used or has expired (they last 10 minutes)"}.get(exc.code, exc.code))
    except HubDown as exc:
        fail(f"could not reach {base}: {exc}")
    member, server = answer["member"], answer["server"]
    path = home() / "servers" / f"{server['id']}.json"
    old = read_json(path, {})
    agents = old.get("agents")
    if agents is None:
        agents = [] if args.no_agent else first_agent(member["name"], agent_folder(args, asked=not args.name))
    write_json(path, {"server": server, "hub": base, "member": {"id": member["id"], "name": member["name"]},
                      "token": answer["token"], "name": socket.gethostname(), "agents": agents})
    say(f"Joined '{server['name']}' as {member['name']}.")
    serve(args)


def cmd_start(args) -> None:
    hub = Hub(home() / "hub")
    if not hub.exists and not profiles():
        say("Nothing is set up on this computer yet.")
        choice = input("[h]ost a new server, or paste an invite link to join: ").strip()
        if choice.lower() in ("h", "host", ""):
            cmd_host(args)
        else:
            args.link = choice
            cmd_join(args)
        return
    serve(args, hub if hub.exists else None)


def serve(args, hub: Hub | None = None) -> None:
    """Run the hosted server (if any) and this machine's node for every server it is in, until closed."""
    hub = hub or Hub(home() / "hub")
    hub = hub if hub.exists else None
    host = read_json(home() / "hub" / "host.json", {}) if hub else {}
    port = host.get("port") or DEFAULT_PORT
    if hub:
        hosts, hub.addresses = plan(port, host.get("lan"), host.get("url"))
        for error in hub.listen(hosts, port):
            say(f"Could not listen on {error}")
        if "127.0.0.1" not in hub._servers and "0.0.0.0" not in hub._servers:
            fail(f"port {port} is in use on this computer (is Lonca already running?)")
        say(f"Hosting '{hub.server['name']}' (v{VERSION}): " + ", ".join(a["url"] for a in hub.addresses))
        if not any(not a.get("local") for a in hub.addresses):
            say("Only this computer can reach it. Turn on Tailscale (or start with --lan / --url) to invite others.")
    nodes = [Node(p, say) for p in profiles()]
    for node in nodes:
        node.start()
    target = None
    try:
        first = read_json(profiles()[0], {}) if profiles() else {}
        if hub:
            target = f"http://127.0.0.1:{port}/p/{hub.pair(hub.members[hub.server['owner']])['code']}"
        elif first:
            target = first["hub"] + "/p/" + call(first["hub"], "/api/pair", {"kind": "browser"}, first["token"])["code"]
    except (Refused, HubDown, KeyError) as exc:
        say(f"Could not open the app: {exc}")
    if target and not args.no_open:
        if args.window and open_window(target, hub.server["name"] if hub else "Lonca"):
            pass  # returns when the window is closed
        else:
            webbrowser.open(target)
            say("Opened in your browser. Keep this window open; Ctrl+C stops Lonca.")
            wait(hub, port, host)
    else:
        if target:
            say(f"Open: {target}")
        wait(hub, port, host)
    for node in nodes:
        node.stop()
    if hub:
        hub.close()


def wait(hub: Hub | None, port: int, host: dict) -> None:
    """Idle until Ctrl+C; meanwhile follow Tailscale coming up or going away."""
    try:
        while True:
            time.sleep(30)
            if hub:
                hosts, links = plan(port, host.get("lan"), host.get("url"))
                if [a["url"] for a in links] != [a["url"] for a in hub.addresses]:
                    hub.listen(hosts, port)
                    hub.addresses = links
                    say("Addresses now: " + ", ".join(a["url"] for a in links))
    except KeyboardInterrupt:
        say("Stopping.")


def open_window(url: str, title: str) -> bool:
    try:
        import webview
    except ImportError:
        return False
    webview.create_window(title, url, width=1280, height=860, min_size=(420, 560), background_color="#0c0b09", text_select=True)
    webview.start(private_mode=False, storage_path=str(home() / "webview"))
    return True


def cmd_link(args) -> None:
    cfg = read_json(profile_for(args.server), {})
    try:
        answer = call(cfg["hub"], "/api/invite" if args.cmd == "invite" else "/api/pair", {"kind": "browser"}, cfg["token"])
    except (Refused, HubDown) as exc:
        fail(f"could not reach the server (is Lonca running?): {exc}")
    link = next((l for l in answer["links"] if not l["local"]), answer["links"][0])
    if args.cmd == "invite":
        print_link(link, "Invite (works once, for 24 hours)")
        say(f"To join with agents, on their computer: python -m lonca join {link['url']}")
    else:
        print_link(link, "Scan with your phone (works once, for 10 minutes)")
    if link["local"]:
        say("This link only works on this computer: the server has no address others can reach yet.")


def cmd_agent(args) -> None:
    path = profile_for(args.server)
    cfg = read_json(path, {})
    agents = cfg.setdefault("agents", [])
    if args.action == "list":
        for a in agents:
            problem = check(a)
            say(f"@{a['handle']:<20} {a['kind']:<12} {shown_mode(a):<7} {a.get('access', 'owner'):<9} {a['dir']}"
                + (f"   ! {problem}" if problem else ""))
        if not agents:
            say("No agents. Add one: python -m lonca agent add <handle> --dir <folder>")
        return
    handle = (args.handle or "").lower().lstrip("@")
    if args.action == "remove":
        if not any(a["handle"] == handle for a in agents):
            fail(f"no agent @{handle}")
        cfg["agents"] = [a for a in agents if a["handle"] != handle]
        write_json(path, cfg)
        say(f"Removed @{handle}.")
        return
    if not HANDLE.match(handle):
        fail("a handle is 2-32 characters: a-z, 0-9, - and _")
    agent = {"handle": handle, "kind": args.kind, "dir": str(Path(args.dir or ".").resolve()), "mode": args.mode,
             "access": args.access, "description": args.description or ""}
    if args.model:
        agent["model"] = args.model
    if args.mcp:
        agent["mcp"] = str(Path(args.mcp).resolve())
    if args.kind == "command":
        agent["command"] = args.command or []
        agent.pop("mode")
    problem = check(agent)
    if problem:
        fail(problem)
    cfg["agents"] = [a for a in agents if a["handle"] != handle] + [agent]
    write_json(path, cfg)
    who = "everyone in the server" if args.access == "everyone" else "only you"
    say(f"@{handle}: {args.kind} in {agent['dir']}, mode {shown_mode(agent)}, {who} can call it.")
    if shown_mode(agent) in ("full", "custom") and args.access == "everyone":
        say("Careful: anyone in the server can now run things on this computer through this agent.")


def main() -> None:
    parser = argparse.ArgumentParser(prog="lonca", description="A chat server for people and the agents on their computers.")
    parser.add_argument("--version", action="version", version=VERSION)
    sub = parser.add_subparsers(dest="cmd")

    def common(p) -> None:
        p.add_argument("--name", help="your name in the server")
        p.add_argument("--dir", help="folder for the first agent (default: the current folder)")
        p.add_argument("--no-agent", action="store_true", help="do not add a first agent")
        p.add_argument("--no-open", action="store_true", help="do not open the app")
        p.add_argument("--window", action="store_true", help="open the app in its own window (needs pywebview)")

    for name in ("start", "host"):
        p = sub.add_parser(name)
        common(p)
        p.add_argument("--server", help="the server's name")
        p.add_argument("--port", type=int, default=DEFAULT_PORT)
        p.add_argument("--lan", action="store_true", help="also listen on the local network (plain HTTP)")
        p.add_argument("--url", help="public address in front of this hub, used in invites")
    p = sub.add_parser("join")
    p.add_argument("link")
    common(p)
    for name in ("invite", "phone"):
        sub.add_parser(name).add_argument("--server", help="server id or name, when this machine is in several")
    p = sub.add_parser("agent")
    p.add_argument("action", choices=("list", "add", "remove"))
    p.add_argument("handle", nargs="?")
    p.add_argument("--server")
    p.add_argument("--dir")
    p.add_argument("--kind", choices=KINDS, default="claude-code")
    p.add_argument("--mode", choices=("read", "edit", "full"), default="read")
    p.add_argument("--access", choices=("owner", "everyone"), default="owner")
    p.add_argument("--model")
    p.add_argument("--mcp", help="MCP config file for a claude-code agent")
    p.add_argument("--description")
    p.add_argument("--command", nargs=argparse.REMAINDER, help="for --kind command: the program and its arguments (last option)")
    argv = sys.argv[1:]
    if not argv or (argv[0].startswith("-") and argv[0] not in ("-h", "--help", "--version")):
        argv = ["start", *argv]
    args = parser.parse_args(argv)
    try:
        {"start": cmd_start, "host": cmd_host, "join": cmd_join, "invite": cmd_link, "phone": cmd_link,
         "agent": cmd_agent}.get(args.cmd, cmd_start)(args)
    except KeyboardInterrupt:
        say()


if __name__ == "__main__":
    main()
