# Lonca — rules for Claude

**v2 is being planned in `PLAN.md`** (Electron + TypeScript, open source, Apache-2.0). Read it first for any v2
work; the layout and rules below describe v0.1, the Python chat server. Two v2 rules that are easy to miss: the
UI's own text is **impersonal** (PLAN.md 7.1: no "sen/siz", no "!", no emoji, the app never speaks as itself), and
there is **no relay or hosted server**: teams connect over Tailscale.

The general version of roblox-factory's Fabrika app: a chat server where people call agents that run on their
own computers. Owners: Kaan and Arda. This repo is separate on purpose; never change roblox-factory for it.

- Reply to the user in **Turkish**. Everything in the repo is **English**; the UI has both (`STR` in `ui/app.js`).
- Read `README.md` first: what exists, how it is built, what is not there yet.

## Layout

| What | Where |
|---|---|
| Server: members, devices, invites, channels, messages, jobs, HTTP + SSE | `lonca/hub.py` |
| A member's machine: connects out, runs requests | `lonca/node.py` |
| How one request runs (Claude Code, any command), modes | `lonca/agents.py` |
| Addresses to listen on and hand out, QR | `lonca/net.py` |
| Files under `~/.lonca` | `lonca/store.py` |
| Commands (`host`, `join`, `agent`, `invite`, `phone`) | `lonca/__main__.py` |
| The one page for desktop and phone | `lonca/ui/` |

## Rules

- No dependencies in the hub and node beyond the standard library (`segno` and `pywebview` are optional extras).
- The security model in the README is the product. Do not weaken a default (read-only, owner only, one-time
  codes, hashed tokens, the custom header on posts) and keep agent configuration on the owner's machine: the
  hub must never be able to change what an agent may do.
- Only a person's message starts a job. An agent's answer never does.
- Every refusal is a code (`HubError("name_taken")`) that the UI translates; add both languages.
- UI: icons are line SVGs from the sprite in `index.html` (no emoji or symbols as icons), system font, the phone
  layout is the `max-width: 760px` block, touch targets 44px. Nothing from the server goes into `innerHTML`
  except through `MD.render`, which escapes.
- After a change: `python -m unittest discover -s tests`, then try it in the real app with its own data folder
  (`LONCA_HOME=<temp folder>`, another `--port`) in a desktop and a phone-sized browser before saying it works.
