# Lonca

A chat server for people and the agents that run on their own computers. Like a Discord server for
development: channels, members, and agents you call with `@name`. Each agent runs on its owner's machine,
in a folder and with rights its owner chose; the server only passes the request on and shows the work live.

"Lonca" (Turkish for guild) is a working name. Status: **v0.1**, a working core. It grew out of Fabrika, the
cockpit app of our Roblox factory, without the Roblox parts and without the two-person assumption.

## Start

Needs Python 3.10+. `pip install -r requirements.txt` adds the QR codes; `pip install pywebview` adds the
app window (without it the app opens in the browser).

```
python -m lonca host --name Kaan --server "Workshop"     make a server on this computer
python -m lonca join <invite link> --name Arda           join one, with this computer's agents
python -m lonca                                          start what is set up here
```

On Windows, `Lonca.cmd` does the last one in its own window (the first time it asks whether to host or join).

- **Invite someone:** the Invite button shows a QR and a link (once, 24 hours). Opened in a browser it joins
  as a chat member; `python -m lonca join <link>` on their computer joins with their agents.
- **Your phone:** the Phone button shows a QR (once, 10 minutes). Scan it, then add the page to the home screen.
- **Another computer of yours:** the computer icon above the agents gives a `join` command for it.
- Same from a terminal: `python -m lonca invite`, `python -m lonca phone` (they print the QR too).

## Agents

When Claude Code is installed, hosting or joining adds one agent: `@<name>-claude`, Claude Code in the folder
you started from, read-only, callable only by you. More:

```
python -m lonca agent add reviewer --dir C:\code\app --mode read --access everyone
python -m lonca agent add builder  --dir C:\code\app --mode edit
python -m lonca agent add codex    --kind command --dir C:\code\app --command codex exec {prompt}
python -m lonca agent list
python -m lonca agent remove reviewer
```

| | |
|---|---|
| `--kind claude-code` | Claude Code, headless, in `--dir`. `--model`, `--mcp <config file>` optional. |
| `--kind command` | Any program. `{prompt}` in its arguments is replaced by the request; without it the request goes to stdin. What it prints is the answer. |
| `--mode read` (default) | Only the Read, Grep and Glob tools. |
| `--mode edit` | Those plus Edit and Write; no shell. |
| `--mode full` | Everything, permissions bypassed. |
| `--access owner` (default) | Only you can call it. |
| `--access everyone` | Any member can. |

A running node picks up changes within a few seconds. An agent gets the request plus the channel's last 20
messages as context (`"context": false` in the profile turns that off), runs one request at a time, and is
stopped after 15 minutes (`"timeout"` in seconds).

## How it is built

```
browser (desktop, phone) ─┐
                          ├─►  hub   one per server: members, channels, messages, jobs
node on each member's PC ─┘         (lonca/hub.py, plain HTTP + server-sent events, no dependencies)
   └─ runs that member's agents (lonca/node.py, lonca/agents.py)
```

- Nodes and browsers connect **out** to the hub; nothing connects in to a member's computer.
- Files live in `~/.lonca` (`LONCA_HOME` overrides): `hub/` for a server hosted here, `servers/<id>.json` for
  each server this computer is in (hub address, this computer's token, its agents).
- The hub listens on this computer and on its Tailscale address when Tailscale is up. `--lan` adds the local
  network, `--url https://…` names a public address you put in front of it (reverse proxy or tunnel).

## What to know before inviting people

- **Agents are remote hands on your computer.** `--mode full --access everyone` lets every member run anything
  on your machine. The defaults (read-only, owner only) are there for a reason.
- **The node decides what an agent may do; the hub decides who may call it.** Agents, folders and modes are
  set only on the owner's machine and cannot be changed from the server. Joining a server still means trusting
  its host with the "who called" part.
- **Channel text reaches agents as context.** It is marked as untrusted, but a model can still be talked into
  things: keep agents that others can call (or that read others' messages) in `read` mode.
- **Plain HTTP.** Fine on this computer and over Tailscale (encrypted by Tailscale). With `--lan`, anyone on that
  network can read the traffic, tokens included. For the open internet put HTTPS in front and use `--url`.
- Device tokens are stored hashed; invites and pair codes work once; a device is removed from the Phone dialog.
  The home-screen shortcut keeps its token in its start URL (iOS home-screen apps do not share the browser's cookies).

## Not there yet

- A hosted relay, so joining needs neither Tailscale nor a tunnel (and one QR is enough on a bare phone).
- One app showing several servers at once (a computer can already join several; each has its own page).
- Per-channel agent sessions (each request is a fresh run today), steering a running job, attachments.
- Roles beyond owner and member, removing members, renaming, notifications, an in-app agent editor.

## Tests

```
python -m unittest discover -s tests
```

A hub, two members and a node with `command` agents on localhost: sign-in, one-time invites and pair codes,
mentions, access rules, stop, offline agents, restart. No network and no Claude needed.
