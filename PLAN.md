# Lonca v2: plan

Status: **Phase 2 built** (2026-10-18; its done-check, a goal finishing on its own with advisors commenting, waits for real use), Phase 3 next; see "Phase 0 status" and "Phase 1 status" under section 8. Owners: Kaan and Arda. v0.1 (the
Python chat server, tag `v0.1.0`) was the starting point for ideas and the security model, not for code.

Research behind this plan: `docs/research/` (Claude Desktop, Antigravity, Hermes Agent + Jan, CLI agents, platform:
connectors, voice, networking). Theme: Grafit & tek vurgu, artboard 2 of the "Lonca theme directions" canvas
(claude.ai artifact, private).

---

## 1. What Lonca is

An open-source desktop hub where people and the CLI coding agents they already have work together.

- **Alone:** your agents (Claude Code, Codex, OpenCode, ...) in a chat-first cockpit: channels, live job cards you
  can watch, steer and stop, a task board, goals the agent works toward step by step, saved ideas, references and
  commands, memory, voice, one-click connectors, and advisor bots that watch the project and talk about it.
- **Together:** the same space shared with others through a join code and roles. Members and agents are listed on
  the right like a Discord server; anyone allowed can give a task to any agent; each agent still runs on its owner's
  computer, under the owner's own login.

Lonca **does not have its own coding agent**. It drives the CLIs people install and log in to themselves. The only
model calls Lonca makes itself are for advisors, memory upkeep and voice, on API keys the person enters.

It is the general version of Fabrika (roblox-factory's cockpit app), without Roblox and without the two-person
assumption. Roblox can come back later as a pack (connectors, commands, advisor profiles).

## 2. Decisions so far

From the Q&A on 2026-10-16.

| Topic | Decision |
|---|---|
| Name | Lonca |
| Distribution | Open source, **Apache-2.0** |
| Platforms, first release | Windows, Linux, phone companion (PWA). No macOS yet |
| Stack | Electron + TypeScript |
| Main agents | The user's own CLI agents, driven headless, as Fabrika does with Claude Code. No agent of our own |
| Provider sign-in | API keys and local endpoints for advisors (Groq, Anthropic, Gemini, NVIDIA NIM, DeepSeek, OpenAI-compatible, Ollama / LM Studio). Subscriptions only through the official CLIs the user logged in to |
| Workspace storage | Local only: every member keeps the whole workspace on their own PC. **No relay and no hosted server**, now or later |
| Networking | Solo needs nothing. Teams connect over Tailscale, as Kaan and Arda do with Fabrika |
| Code sharing | Git. Lonca shows status and offers pull/push; chat, records and boards live in Lonca's own store |
| Advisors | Continuous chatter (like Fabrika's #genel bots), on the advisor owner's keys |
| Cross-member jobs | Run on the agent owner's PC with the owner's login; the owner decides who may call it and how much it may do |
| `/todo`, `/goal` | `/todo` adds a card to the board; `/goal` starts goal mode (step by step until done, stoppable) |
| System prompts | Fabrika-like defaults for every role (worker, advisor, goal step, ...), editable by the people using them, in layers (5.14) |
| Phase order | Team (Phase 3) before memory, voice and the connector store (Phase 4) |
| Viewer role | Reads and posts messages; cannot task agents or edit the board and records |
| Repo | `github.com/kaanisthatyou/lonca`, private until Phase 1 is done, set up as open source from the first commit |
| Telemetry | None. Lonca sends nothing |
| v0.1 code | Removed from `main` when the v2 skeleton lands; tag `v0.1.0` kept |
| Theme | **Grafit & tek vurgu** (direction 2 on the canvas) |
| UI copy | **Impersonal**: Lonca's own text states facts and actions, with no author presence (7.1) |

## 3. Principles

1. **Solo works with nothing else.** No account, no server, no network, no Tailscale.
2. **The owner's machine decides what an agent may do; the workspace decides who may call it.** Agent folders,
   modes, connectors and limits are set only on the owner's computer and cannot be changed remotely (v0.1 rule).
3. **Only a person starts work.** A person's message, card or goal starts a job. Advisors and agents never start
   jobs; an advisor may propose one as a card a person approves with one click.
4. **Safe defaults.** New agents: read-only, callable only by their owner. Others' requests are capped at read
   unless the owner raises it. Channel text reaches agents marked as untrusted.
5. **No credential handling.** Lonca never reads, copies or moves a CLI's login files. It spawns the unmodified
   official binary, which uses its own login. No "Sign in with Claude/Gemini" inside Lonca. "Claude" is never part
   of an agent's product name in the UI beyond describing what it runs.
6. **Clean room.** Nothing from closed apps (code, strings, assets). Open-source code only with its license notice.
7. **Everything bilingual.** Turkish and English UI from the first build.
8. **One small core with plugin points**, not Hermes-style breadth.

## 4. From Fabrika to Lonca

| Fabrika | Lonca |
|---|---|
| Cockpit: one Claude chat per person | A direct channel with each of your agents, plus channels |
| Team chat with channels, mirrored at both PCs | Channels in a workspace, replicated at every member |
| Worker Claude (`@claude`): job card, steps, tokens, live view, steer, stop | **Workers**: any supported CLI agent, same job card |
| Chat bots on free APIs, small talk in #genel, critical takes | **Advisors** with personality profiles |
| Blender agent: the one machine with Blender | Capability agents: an agent with tools or connectors only one machine has |
| `roblox-studio-peer`: use the other PC's Studio | Later: a member's agent uses a connector on another member's PC |
| `ideas/`, `references/`, `.claude/commands/`, `library/` | **Kayıtlar**: Fikirler, Referanslar, Komutlar, Bellek |
| `progress.md` (where we left off, milestones, next) | A project status page kept current by agents |
| `split.md`, `Owner` attributes, claim/release | Areas: folders owned by a member, rules given to every job |
| Cockpit tiles (`shortcuts.json`) | Saved commands pinned as tiles, with `{project}`, `{user}` variables |
| Status bar quota, `/durum` | Quota per agent and per account, `/durum` |
| Login expiry detection | Per-CLI auth status, "sign in again" button that opens the CLI's own login |
| Second Claude login | Several accounts per CLI (separate config dirs) |
| Phone PWA over Tailscale | Phone companion, per-phone tokens |
| Update from GitHub with `git pull` | Signed installers, auto-update from GitHub Releases |
| Gemini web driven headless | **Dropped** (terms of service) |
| Roblox docs / DevForum research tab | Dropped; web research comes through connectors |

## 5. The product

### 5.1 First run (launcher)

1. Language (Türkçe / English) and theme.
2. Your name and avatar.
3. Data folder: the default under the user's app data, changeable.
4. Agents found on this PC: each supported CLI with version and login state, a "sign in" button that opens the
   CLI's own login in a console, and an API-key option. Nothing installed: links and one-line install commands.
5. Optional: advisor provider keys (free-tier picks first: Groq, NVIDIA NIM, Gemini free tier), voice, Tailscale.
6. A first workspace with `#genel` and a direct channel per agent; a short tour.

### 5.2 Layout

Discord-like, three columns plus a rail:

- **Rail:** workspaces (loncas), a new-workspace button, the shortcuts panel.
- **Sidebar:** workspace name, storage and network state, search / command palette (`Ctrl K`), channels, **Pano**
  (Görevler, Hedefler), **Kayıtlar** (Fikirler, Referanslar, Komutlar, Bellek), "needs attention" inbox, own card
  (mic, settings).
- **Center:** the channel (messages, job cards, goal strip, typing), or the board, a record, a job's live view.
- **Right, "Loncadakiler":** invite code, **workers** (CLI agents, with state), **advisors** (with profile chip and
  today's budget), **members** (with role and presence), quota of your own agents.
- Phone: the same UI in its narrow layout (bottom tabs), from the desktop app over Tailscale.

### 5.3 Workers (CLI agents)

- An agent = a CLI kind + an owner + a machine + a folder + a mode + connectors + who may call it.
- **Job card:** agent, CLI, mode, state, steps (read, edit with +/− lines, command, test), tokens (new / cache /
  output), cost when known, buttons: live view, steer, stop. Ends with a short summary message.
- **One state model for every CLI:** idle, running, **needs attention** (waiting on a permission, a question or plan
  approval), done, failed, stopped. Needs-attention items get a sidebar inbox, inline approve/deny, and a push to
  the phone (Antigravity's best idea).
- **Steering:** a message sent to a running job is queued and delivered at the next safe break (Claude Code takes it
  mid-turn; Codex through its app server later; others get it as the next turn).
- **Autonomy ladder**, the same three words everywhere: *Oku* (read), *Düzenle* (edit), *Tam* (full, warned).
  Mapped per CLI (Claude Code `plan` / `acceptEdits` / `bypassPermissions`; Codex `read-only` / `workspace-write` /
  `danger-full-access`; Gemini/agy `plan` / `auto_edit` / `yolo`). Command allow/deny lists where the CLI has them;
  deny wins.
- **Worktrees:** a job can run in its own git worktree, with a merge-back check before it closes.
- **Context given to every job:** who asked, the channel's recent messages (marked untrusted), referenced records,
  the workspace memory snapshot, area rules, the goal state. Shown on the card as "what was given".
- **Lonca's own MCP server** for the agents it runs: search history and records, read references (images), read
  and update board cards and goal steps, post progress. This is how agents keep `/todo` and `/goal` current.

### 5.4 Advisors

- A profile = name, avatar, personality, provider + model, channels it lives in, cadence, daily token budget, its
  own memory space, what it may read.
- Personalities: **Eleştirel**, **Doğrucu Davut**, **Olumlu** to start, plus custom (a prompt template). Honest
  takes over praise, as Fabrika's bots learned.
- Continuous chatter: they react to activity (a commit, a finished job, a new idea, a goal step) and drop in on
  their own now and then; they answer people and each other. Limits: daily budget per bot, at most a few bot turns
  in a row before a person speaks, quiet hours, small talk only in chosen channels.
- They read through read-only tools on the owner's machine: git log and diffs, file read and search in the project
  folder, the board, the goal, recent messages. **They never write code and never start jobs**; a suggested job
  appears as a card with "İş ver".
- Run on the member who added them, with that member's keys. Spend per bot is visible.

### 5.5 Commands

| Command | Does |
|---|---|
| `/todo <text> [@who]` | A board card; assigned to an agent it becomes a job on one click |
| `/goal <goal> [@agent]` | Goal mode: plan, approval, step by step with a report each step, until done, the budget ends, or someone stops it |
| `/meclis [topic]` | Advisors discuss a topic in turn and end with a short summary |
| `/kaydet` | Save the message, image or answer as an idea or a reference |
| `/hatırla <fact>` | Add to personal or workspace memory |
| `/özet [period]` | Summary of a channel |
| `/durum` | Every agent's account, login and quota on every machine |
| `/<saved command>` | A saved prompt with variables |

**Goal mode:** the person sets the goal, the agent, an optional budget (steps, time, tokens) and a done check
(e.g. a test command). The agent first writes a plan; the person approves it, with comments on any line
(comments travel as structured data, "proceed with 2 comments"). Then: step, report, check, next step. Advisors
comment per step. Each step continues the person's goal, so it does not break principle 3. Reference: Qwen Code's
native `/goal`.

### 5.6 Records (Kayıtlar)

- **Fikirler** (ideas): title, body, tags, status, an advisor's notes section (Fabrika's `ideas/` format).
- **Referanslar** (references): images and screenshots with notes and tags; attach to a message or a job.
- **Komutlar**: saved prompts with variables, pinnable as tiles.
- **Bellek**: see 5.7.
- Anything in chat can be saved with `/kaydet` or a hover button; any record can be shared back into a channel or
  attached to a job. Optional later: mirror records as plain files in the project repo (`.lonca/`).

### 5.7 Memory and context

Learned from Hermes: small, bounded, human-editable memory beats a big opaque store.

- **Personal** (private, on your own PC): a profile and notes, a few hundred tokens each, Markdown, editable.
- **Workspace** (shared): decisions, conventions, glossary; Editors edit; bounded.
- **Per advisor**: each bot's own notes, never shared with other bots.
- **History**: full-text search (SQLite FTS5) over messages, jobs and records, offered to agents as a tool.
- Writes come as suggestions with their source (which chat, which date), are scanned for injection, and show in
  Bellek with edit and delete. A "what was recalled" line on each job card.
- Upkeep (summaries, suggestions) runs on a cheap model from the person's providers.

### 5.8 Voice

- **Dictation** into the composer, **read aloud** of job summaries and advisor messages, and a **voice mode** for
  talking to an agent (speech → message → job → spoken summary).
- Push to talk: `Ctrl Space` inside Lonca, toggle by default (Electron only sees key presses), plus the mic
  button. From anywhere: the quick-entry window (`Ctrl Alt Space`) with the same mic. `Ctrl Space` is never
  registered globally, because editors use it for completion.
- Local by default, downloaded on first use: whisper.cpp sidecar with the multilingual `small` model; Piper with a
  Turkish voice. Silero VAD (2 MB) ships with the app for auto-stop, silence trimming and barge-in.
- Cloud options: Groq Whisper, OpenAI, ElevenLabs. **Bring your own:** any OpenAI-compatible audio server, or a
  command template (`{input_path}`, `{output_path}`) for anything else (Hermes' pattern).
- No wake word and no full-duplex voice in v1.

### 5.9 Connector store

- **Catalog:** a curated list (~30 entries, "Verified by Lonca") published as an open, signed static index that
  anyone can mirror or self-host; each entry points at an official MCP Registry entry. Live registry search below
  it, marked "community, unreviewed". A workspace can keep its own allowlist and recommended set.
- **One click per kind:** remote without auth (add); remote with OAuth (system browser, a one-shot loopback callback
  that checks Host, state, duplicate parameters and Referer; PKCE; Client ID Metadata Document, dynamic registration
  as fallback); remote with an API key (one field); MCPB bundle (the public format, imported as-is: download,
  signature and publisher shown, settings form from its `user_config`); `npx` / `uvx` packages (runtime check,
  pinned download offered). Every flow ends with a test (`initialize` + `tools/list`).
- **Install pipeline** (Claude Desktop's, which is sound): stage, verify signature and hash, confirm (publisher,
  compatibility, the folders and network it asks for), blocklist check, atomic move, install record (source,
  version, hash) re-checked at startup; settings kept across updates; an env deny list when spawning servers.
- **Tool policy per tool**, four values: allow, ask every time, ask once per job, blocked. A team-visible log of
  tool decisions.
- **Lonca MCP gateway.** Headless CLIs cannot ask the person anything, so connectors do not go to the CLIs
  directly: Lonca runs or connects every connector itself and gives each job one local HTTP MCP endpoint with a
  per-job token that exposes only that agent's connectors. "Ask" becomes a needs-attention approval on the job
  card; secrets never leave Lonca; one audit point. The same endpoint serves Lonca's own tools (5.3). For a CLI
  without HTTP MCP support, Lonca writes a per-run config instead (Claude Code `--mcp-config --strict-mcp-config`,
  Codex a temporary `CODEX_HOME`, Gemini a per-run settings dir).
- **Secrets** in Electron `safeStorage` (DPAPI, libsecret, KWallet), in the main process only; the UI sees masked
  values. Never a plaintext fallback: without an OS secret store, an encrypted file behind an app passphrase.
- Connectors belong to a member's machine (principle 2). Node bundles run in an Electron utility process; Python
  ones through a downloaded `uv`.

### 5.10 Keyboard shortcuts

Rebindable, with a conflict checker, rollback when a global shortcut cannot be registered, the GlobalShortcuts
portal on Wayland, and one searchable panel (`Ctrl /`). Defaults:

| Keys | Action |
|---|---|
| `Ctrl Alt Space` (global) | Quick entry: a small always-on-top window to message or task an agent from anywhere; remembers its monitor, hides on blur |
| `Ctrl K` | Search and command palette |
| `Ctrl Space` | Push to talk (inside Lonca, toggle) |
| `Alt ↑ / ↓` | Previous / next channel |
| `Ctrl Shift ↑ / ↓` | Previous / next item that needs attention |
| `Ctrl .` | Stop the focused job |
| `Ctrl Shift S` | Steer the focused job |
| `Ctrl Shift M` | Mute advisors in this channel |
| `Ctrl ,` | Settings |
| `↑` in an empty composer | Edit your last message |

### 5.11 Team

- **Invite:** an Admin makes a code or link with a role, an expiry (default 24 h) and one use; the joiner asks, an
  Admin approves ("Ayşe wants to join as Editor"). Codes carry ≥128 bits.
- **Roles:**

| | Viewer | Editor | Admin |
|---|---|---|---|
| Read channels, jobs, records | ✓ | ✓ | ✓ |
| Post messages | ✓ | ✓ | ✓ |
| Give agents tasks (if the agent's owner allows) | — | ✓ | ✓ |
| Board, goals, records | read | edit | edit |
| Add own agents and advisors | — | ✓ | ✓ |
| Channels, invites, roles, removing members, workspace settings | — | — | ✓ |

- **Agent access,** set by its owner: who may call it (only me / named members / every Editor), the highest mode
  for others (default *Oku*), "approve others' jobs first" (off by default), folders, connectors, time and token
  limits.
- Presence, typing, OS notifications, phone push for needs-attention, an activity feed.

### 5.12 Phone companion

The desktop app serves the UI to the person's own phone over Tailscale (`tailscale serve` for HTTPS so it installs
as an app), paired once with a QR, one token per phone (revoke one phone without the others). Everything runs on
the PC. Needs-attention pushes from day one.

### 5.13 Projects and git

A project = a git repo; each member points it at their own clone. Lonca shows branch, changes, ahead/behind, and
offers pull/push; jobs can end with a commit (owner's choice). Advisors read commits and diffs. Areas (folders
owned by a member) generalize Fabrika's `split.md`: every job gets the rules, and editing another member's area
needs a claim.

### 5.14 Agent instructions (system prompts)

Every role ships with a default instruction template modelled on Fabrika's (its system note and the worker, chat
bot and Blender agent prompts in `app/fabrika.py` and `app/backend/team_claude.py`), and people can change them.

- **Roles with a default:** worker (who you are and for whom, where you run, language, no interactive prompts so
  ask in plain text and end the turn, the autonomy mode, area rules, what to do after the work: summary, board and
  goal updates, commit policy, how to treat channel context), advisor (one per personality: honesty over praise,
  length, when to stay silent, never offer to do work), goal step (plan, step, report format), `/meclis`
  moderator, memory upkeep, quick entry.
- **Layers,** assembled in this order for every job:
  1. Lonca's core rules (untrusted context, only people start work, the owner's limits). Shown read-only, because
     Lonca enforces them in code; the text only explains them to the model.
  2. The role's default template: editable, with "reset to default" and a diff against the default.
  3. Workspace instructions (Admins): team conventions, language, areas.
  4. The agent's or advisor's own instructions (its owner).
  5. The job's context pack (5.3).
- **Variables:** `{user}`, `{agent}`, `{workspace}`, `{channel}`, `{project}`, `{mode}`, `{language}`,
  `{members}`, `{areas}`, `{goal}`, `{date}`. A preview shows the exact text a sample job would receive.
- **Files, not database rows:** Markdown with frontmatter, with history and revert; export and import, and share
  as a workspace preset. When a release changes a default the person edited, Lonca offers the new default as a
  merge instead of overwriting.
- **Personalities are presets:** Eleştirel, Doğrucu Davut and Olumlu are editable templates; duplicate one to make
  a new advisor.
- **Text never grants rights.** No instruction layer can widen an agent's mode, folders or connectors; those come
  only from the owner's settings (principle 2).
- Delivery per driver: Claude Code `--append-system-prompt` (or `--system-prompt` to replace, as Fabrika can);
  other CLIs through their equivalent, else the first message of the session.

## 6. Architecture

### 6.1 Stack

- **Electron** (latest stable at the start, pinned), **TypeScript strict**, electron-vite.
- **Renderer:** React 19, **Motion** (motion.dev) for animation, CSS variables + CSS Modules from our own design
  tokens, React Aria (or Radix) primitives for accessibility, Zustand for state, i18next (tr, en).
- **Core:** Node in an Electron `utilityProcess`: better-sqlite3 (FTS5), `ws`, `@noble/curves` + `@noble/ciphers`
  (Ed25519, X25519, XChaCha20-Poly1305), zod schemas, cross-spawn + tree kill for CLIs.
- **Tests:** Vitest, Playwright for Electron, a fake CLI agent that replays recorded event streams.
- **Build:** pnpm workspaces, Biome, electron-builder (NSIS for Windows, AppImage + deb for Linux), electron-updater
  on GitHub Releases, code signing through SignPath's free open-source program (to apply for).

### 6.2 Processes

```
Electron main: windows, tray, global shortcuts, deep links, safeStorage, updates
  └ core (utilityProcess): workspace store and sync, jobs and agent drivers, advisors,
  │                         connectors and the MCP gateway, voice sidecars, local HTTP/WS API
  └ renderer: UI only, talks to core over a typed message port
phone / other members ──(Tailscale)──► core's API
```

The renderer, the phone and other members' apps all use one API (events in, commands out), so live view,
reconnects and the phone come for free.

### 6.3 Repo layout

```
apps/desktop        Electron main, preload, renderer entry
packages/protocol   event and command types, zod schemas, versions
packages/core       store, sync, roles and certificates, jobs, scheduler
packages/agents     AgentDriver interface; claude-code, codex, opencode, acp, gemini/agy drivers
packages/providers  LLM clients (OpenAI-compatible, Anthropic, Gemini) and presets
packages/voice      STT/TTS engines, sidecar manager
packages/connectors store, registry, OAuth, MCPB, MCP gateway (with Lonca's own tools), per-CLI config writers
packages/ui         design tokens, components, motion presets
docs/               PLAN.md stays at the root; research, ADRs
```

The v0.1 Python code is tagged `v0.1.0` and removed from `main` when the skeleton lands; its tests
become TypeScript test cases for the same security rules.

### 6.4 Data

- Per workspace, one SQLite file: an **append-only event log** (message posted/edited/deleted, job created/step/
  ended, card, goal, record, member, channel, certificate events), each event signed by the author's device key and
  ordered by a hybrid logical clock (what Fabrika already does for its chat), plus tables built from it and an FTS5
  index.
- Images and files are content-addressed blobs, fetched when needed.
- A job's full transcript stays on the machine that ran it; the log keeps its steps and summary; live view streams
  the rest on request.
- Personal memory and secrets never enter the workspace log.

### 6.5 Sync and networking

- **Peers only, no server.** Every member keeps the whole workspace. Online peers sync directly over Tailscale
  (each app listens on its Tailscale address); whenever any two members are online they catch up, and a third
  member passes on what the other two missed. Nobody is "the server", so a closed PC only means its own agents are
  offline. Lonca never runs or depends on a relay or hosted service.
- A member who wants the workspace always reachable can leave Lonca running in the tray on an always-on machine;
  it is just another peer.
- Tailscale is detected and guided as in Fabrika: not installed (winget / download), signed out, wrong tailnet.
  Joining a workspace means being in the same tailnet, or the inviter sharing their device with the joiner
  (Tailscale node sharing); the invite screen walks through both.
- **Roles are certificates:** the workspace has an admin key; each device has a key pair; an Admin signs a
  membership certificate (device, role, expiry ~30 days, silently renewed). Peers check certificates on every event
  and refuse actions above the role. Removal = a signed revocation plus key rotation.
- Not v1: an embedded Tailscale (tsnet sidecar), iroh, WebRTC.

### 6.6 Agent drivers

One `AgentDriver` interface: detect, auth status (no tokens spent), start, send, steer, interrupt, stop, quota, and
normalized events (text, tool call, tool result, usage, needs-attention, end), plus a capability map the UI reads
to hide what a CLI cannot do.

| Driver | v1 | Notes |
|---|---|---|
| Claude Code | yes | stream-json in and out, mid-turn steering, interrupt, `rate_limit_event` quota windows, `--mcp-config --strict-mcp-config`, `claude auth status --json`. Fabrika-proven |
| Codex | yes | `codex exec --json`, resume, sandbox modes, temporary `CODEX_HOME` for connectors; app-server driver later for steering |
| OpenCode | yes | `run --format json`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_PERMISSION` |
| Gemini CLI / Antigravity `agy` | API key or Vertex only | Google forbids third-party use of its OAuth login; warn on OAuth |
| Generic ACP | v1.x | Qwen Code, Copilot CLI, Cursor, Kimi and others; no steering or quota there |

Windows details: resolve `.cmd` shims to the real executable, send prompts on stdin (never through `cmd` quoting),
kill process trees, hide windows. Each driver has contract tests against recorded output of a pinned CLI version
and warns when the installed version is newer than the last tested one.

### 6.7 Providers (for advisors, memory upkeep, voice)

Presets: Groq, Anthropic, Gemini, NVIDIA NIM, DeepSeek, OpenRouter, OpenAI, plus any OpenAI-compatible URL and local
servers (Ollama, LM Studio, llama.cpp). A provider = base URL, key chain (fallback to the next key on 401/403/429),
model list from `GET /models` with a tolerant parser, per-model limits. Keys in `safeStorage`, main process only.

### 6.8 Security model

- Agents are remote hands on their owner's PC: read-only and owner-only by default; others capped at *Oku*.
- Channel text, records and advisor output reach agents marked as untrusted; memory writes are scanned.
- Every event is signed; roles are enforced by every peer, not by a server.
- Secrets never leave the main process; CLI logins are never touched.
- Per-run connector configs are temporary files removed after the run.
- Phone and peer APIs listen only on loopback and the Tailscale address; a custom header on writes blocks
  cross-site posts.

## 7. Design

Chosen direction: **Grafit & tek vurgu** (artboard 2 on the canvas; the other two stay there for reference).

- **Color:** cool graphite surfaces (ground `#0A0B0D`, panels `#0F1013` / `#0C0D10`, cards `#131418` /
  `#191B20`, hairlines at 7% and 12% white), text `#E9ECF1`, secondary `#969CA7`, meta `#8A909B`, **one accent**
  (lime `#C6F24E` by default, text on it `#0A0B0D`), diff colors `#8BE0A8` / `#FF9F70`. The accent marks only
  what is live or chosen: the active channel, a running job, a mention, the primary button. A few tested accents
  can be picked in Settings; never two at once.
- **Type:** Geist for UI, Geist Mono for code, tokens, timers, counts and job steps (both OFL, bundled, no font
  requests at runtime). Dense sizes (13.5 px body), slight negative tracking.
- **Shape:** 6-10 px radii, 1 px hairlines instead of shadows, square-ish avatars.
- **Motion:** short springs (`cubic-bezier(.34,1.56,.64,1)`) for things that arrive or are pressed, a plain
  ease-out (`cubic-bezier(.2,.8,.2,1)`) for things that move; 150-450 ms. Job steps appear in order, a live log
  line types, the running agent has a moving ring, buttons press in.
- Next: tokens as a package (`packages/ui`), a component kit, a light version, the phone layout.

Motion rules: animation explains state changes (a job step arriving, a card moving, an agent starting), never
decorates idle screens; entrances stay under 400 ms in the app (the canvas exaggerates); nothing loops except live
indicators; everything respects `prefers-reduced-motion`, and every state stays readable without motion.

### 7.1 UI copy: impersonal

Lonca's own text (buttons, labels, menus, placeholders, empty states, notifications, errors, tooltips, the
launcher) is impersonal and objective: it names what a control does or states what happened. The author is not
present in it.

- No feelings, opinions, praise, jokes, greetings, encouragement or apologies; no exclamation marks; no emoji.
- No addressing the reader: no `sen` / `siz`, no second-person possessives (`kotan`, `ayarların`), no
  "Hoş geldin". In English no "you" / "your".
- The app never speaks as "I" or "we" and is never personified ("Lonca düşünüyor" → "İşleniyor").
- Buttons are plain verbs or nouns: Kaydet, Durdur, Davet oluştur, Ayarlar.
- Errors: what happened, the cause when known, the action: "İş başlatılamadı: `claude` bulunamadı. Kurulum
  komutu kopyalandı."

| Not | But |
|---|---|
| Hoş geldin Kaan! Hadi başlayalım | Kurulum · 1 / 5 |
| Claude Code kotan | Claude Code kotası |
| Harika, davet gönderildi! | Davet gönderildi. |
| Bir şeyler ters gitti :( | Bağlantı kurulamadı: Tailscale kapalı. |
| Buraya bir şeyler yaz… | Mesaj · #genel |
| Your code was copied! | Code copied. |

This is the app's voice only. What people, agents and advisors write is their own content; advisor personalities
are content, not UI. A CI check on the string files (tr, en) flags `!`, emoji and `sen` / `siz` / `senin` /
`sizin` forms; review covers the rest.

## 8. Phases

Each phase ends with something installable that the two of you use for real.

| Phase | Contents | Done when |
|---|---|---|
| **0. Foundation** | Theme choice, tokens and component kit, repo scaffold, CI, Electron shell, first-run launcher, i18n, signed installer, auto-update | An installable empty Lonca updates itself |
| **1. Solo core** | Channels, messages, records (ideas, references, commands), Claude Code and Codex drivers with job cards, live view, steering, stop, quota, login state, autonomy ladder, needs-attention inbox, `Ctrl K`, shortcuts, `/todo` board, MCP gateway with Lonca's own tools, worker instruction templates and their editor | Kaan runs a real non-Roblox project from Lonca for a week |
| **2. Advisors and goals** | Provider presets and keys, advisor profiles with editable personality presets and chatter with budgets, `/meclis`, `/goal` with plan approval and comments, worktrees | A goal finishes on its own while the advisors comment |
| **3. Team** | Peer sync over Tailscale, invites, approval, role certificates, members panel, cross-member jobs, notifications, phone companion | Kaan and Arda run a project together on Lonca instead of Fabrika's team tab |
| **4. Memory, voice, connectors** | Memory layers and recall line, voice (local and cloud, custom servers), connector store with OAuth and MCPB | A connector installs in one click and a job is started by voice |
| **5. Public 1.0** | OpenCode and the generic ACP driver, Linux packages, docs site, contribution guide, security review | Strangers install and use it without help |

### Phase 0 status (2026-10-16)

Built and verified on Windows:

- pnpm monorepo (`apps/desktop`, `packages/protocol`, `packages/core`, `packages/ui`), Electron 44, TypeScript,
  React 19, Motion, Biome, Vitest; dependencies pinned and at least 7 days old.
- Design system "Grafit & tek vurgu" as tokens (dark, light, four accents), components and line icons.
- Electron shell: sandboxed renderer, core in a utility process over MessagePorts, custom title bar, window state,
  single instance, IPC limited to the app's own page.
- First-run launcher: language, appearance, profile, data folder, CLI agents (found, version, login state without
  spending tokens, the CLI's own login in a console, install commands), Tailscale state. Settings dialog with the
  same parts.
- The empty shell (rail, sidebar, channel, "Loncadakiler" panel) with installed agents listed.
- Turkish and English, impersonal copy checked by `pnpm check:copy`.
- Tests: 26 unit tests; the real app through launcher, shell, settings and restart (`pnpm e2e`), also as the
  packaged build; an update found and downloaded from a local feed (`e2e/update.mjs`).
- Windows installer (NSIS, per user) and Linux targets (AppImage, deb) configured; CI and a tag-driven release
  workflow.

Still open for Phase 0's "done when":

- **Signing:** the installer is unsigned (SmartScreen warns). SignPath's free program needs the public repo.
- **Real auto-update:** works against GitHub Releases only once the repo is public. Verified with a local feed:
  0.2.0-alpha.0 found 0.2.0-alpha.1, downloaded it, offered the restart, and (by accident, before the test hook
  turned install-on-quit off) installed it silently when it closed.
- **Linux:** CI passes on Ubuntu (lint, types, tests, build); the AppImage and deb packages have not been built
  or run on Linux yet (the first tagged release builds them).

### Phase 1 status (done 2026-10-18, 0.3.0-alpha.0)

Built and verified (unit tests, and the real app driven against a fake Claude Code in `e2e/channel.mjs`):

- Workspace store on Node's built-in `node:sqlite`: append-only event log applied to tables, accent-insensitive
  full-text search; jobs and CLI sessions kept locally.
- Channels and agents' own channels; messages as Markdown, edit and delete, `@` completion, `/` commands.
- Agents: CLI, name, handle, folder, permission level, model, instructions; one CLI session per agent and
  channel, kept across jobs; "New session" to start over.
- Claude Code driver over stream-json: live steering (messages sent mid-turn become queued turns of the same
  job), stop, refused tools shown as steps, login failures, quota from rate-limit events. The read and edit flag
  sets were checked against Claude Code 2.1.301 (two Haiku calls).
- Codex driver over `codex exec --json`: checked against codex-cli 0.162.1 installed in a temporary folder and not
  logged in (`packages/core/test/real-cli.test.ts`, run with `LONCA_REAL_CODEX`): detection, "Not logged in" (which
  exits 0), the exec flags, `--image`, `resume`, retries (`error` events) before `turn.failed`, a 401 shown as a login
  problem, and Lonca's MCP endpoint reached through `-c mcp_servers.lonca.*` with the token in an environment
  variable. A logged-in run (tool calls, answers) is still untested.
- Job cards (live steps, streaming answer, usage, cost, steer, stop), the live view with the whole transcript,
  the quota panel.
- `/todo` and the board: four columns, drag and drop, an agent per card, "Run as job", the card follows the job.
- `Ctrl K` palette (channels, agents, views, actions, message search), `Ctrl /` shortcut list, `Alt ↑ / ↓`,
  `Ctrl .`.

- Records: ideas (with status), references (images pasted, dropped or chosen), saved commands with `{user}`,
  `{channel}`, `{date}`; any message saved as an idea; records attached to a message reach the job as notes,
  references as images (inline for Claude Code, `--image` for Codex).

- Instructions (5.14): Lonca's core rules shown read-only; the worker template and the workspace's instructions as
  Markdown files (`<data>/instructions/worker.md`, `<workspace>/instructions.md`), with earlier versions kept under
  `history/`, "back to default", a notice when the shipped default changed under an edited copy, and a preview of
  the whole prompt per agent. A session restarts its CLI process (same conversation) when a layer changes.

- The MCP gateway: a small Streamable HTTP endpoint on 127.0.0.1 with one bearer token per agent session (Host
  and Origin checked), serving Lonca's tools: `search_messages`, `list_records`, `read_record` (with the image),
  `list_cards`, `add_card`, `update_card`, `post_progress`. Claude Code gets it with `--mcp-config` and
  `--allowedTools mcp__lonca`; checked with a real Claude Code call (connected, tool called without a prompt).
  Codex gets the same endpoint through per-run config overrides.

- Approvals: at read and edit, Claude Code asks Lonca over stdio (`--permission-prompt-tool stdio`,
  `control_request` / `can_use_tool`, checked with a real call); the job waits as "Onay bekliyor" with Allow and
  Deny on its card, a "Bekleyenler" count in the sidebar, an OS notification when Lonca is in the background, and
  `Ctrl Shift ↑ / ↓` to go through waiting jobs. Control requests Lonca does not handle get an error answer.

- Pinned commands as buttons above the message box; shortcuts rebindable in Settings (recorded by pressing them,
  conflicts refused, back to default), the shortcut list showing the current keys.

- `e2e/real-claude.mjs` (by hand, two short Haiku turns): the real Claude Code answers from a project's files
  and moves a board card through Lonca's MCP tools; the packaged 0.3.0-alpha.0 passes `smoke.mjs` and
  `channel.mjs`.

Left open from Phase 1: a logged-in Codex run (no Codex login on the dev machine), and making the repository
public, which waits for the owners' go.


### Phase 2 status (built 2026-10-18)

- Providers: presets (Groq, Anthropic, Gemini, NVIDIA NIM, DeepSeek, OpenRouter, OpenAI, Ollama, LM Studio,
  llama.cpp, any OpenAI-compatible URL), kept by the main process in `<app>/providers.json` with keys sealed by
  `safeStorage` (Linux without a keychain is shown as weak protection; with no encryption keys are refused). The
  page sends keys in and gets back only their last four characters. Two wires: OpenAI chat completions and
  Anthropic messages, both streamed; a key chain that moves on after 401, 403 or 429; `GET /models` read
  tolerantly; plain http only for loopback, private networks and Tailscale addresses. The core asks the main
  process for completions over its parent port (`PortLlm`). Tested against a local stand-in server (unit tests and
  `e2e/advisors.mjs`).
- Advisors: profiles (name, handle, personality preset with an editable prompt: Eleştirel, Doğrucu Davut, Olumlu,
  Özel; provider and model; channels; how often they speak unasked; a daily token budget; an optional project
  folder whose recent commits and git status they see, read only). They answer `@mentions`, comment now and then
  on finished jobs and new ideas, drop in on their own in active channels, and answer each other. Limits in
  code: the budget, quiet hours (Settings → General) for unasked turns, at most three bot turns in a row before a
  person speaks, one unasked turn per channel per hour, one turn at a time per channel. They never write code or
  start jobs; a `/todo` line in their answer becomes a board card. `/meclis [topic]`: two rounds in turn, then a
  summary. Each advisor runs on the device that added it. Tested with unit tests and `e2e/advisors.mjs`; not yet
  run against a real provider with a real key. Lonca gathers the channel, the board and git history for them;
  with a project folder they also get read-only tools (`list_files`, `read_file`, `search`, `git_log`,
  `git_show`), kept inside the folder (symlinks included) with git on fixed arguments: up to three rounds of
  calls, then they answer with what they have; every round counts against the budget. The provider client speaks
  tool calls on both wires (not streamed); a model or server without tools is remembered and gets the gathered
  context only.
- `/goal`: a dialog for the goal, the agent, the budget (steps, minutes, optional tokens) and an optional done
  check (a shell command in the agent's folder; exit code 0 means done). The agent writes a numbered plan; the
  goal card shows it with a comment box on every step and on the plan, and "approve with N comments" sends the
  comments as structured data with every step. Then one job per step, the check after each, a fix step when the
  plan is done but the check fails, `GOAL_DONE` to finish early (only with a passing check). Pauses on the budget
  (continue with more), a failed step, or an app restart; stop at any time. The running step's job card stays for
  steering and approvals; finished ones open from their step. Advisors of the channel take turns commenting on
  each step. A Goals view lists them. Tested with unit tests and `e2e/channel.mjs` against the fake CLI, and once
  with the real Claude Code on Haiku (`e2e/real-claude.mjs`: a four-step plan, an approval, the check passed).
- Worktrees: a goal can run in its own git worktree (`<data>/worktrees/<goal id>`, branch `lonca/goal-<id>`), in a
  CLI session of its own, so the main folder stays as it is and the agent can take other work meanwhile; each step
  ends with a commit, the done check runs in the worktree, and the session closes when the goal ends. The card
  shows the branch, opens the folder, and removes the worktree when the goal is over (never forced: a worktree
  with changes stays; the branch always stays). Tested with real git in unit tests and `e2e/channel.mjs`.

### Phase 3 design (2026-10-18)

The details behind 5.11 and 6.5, decided before building.

- **Workspaces.** Several per app: "Kişisel" (never synced, as today) and team workspaces, each in its own folder
  `<data>/workspaces/<id>/` with its own SQLite file. The rail lists them; ＋ creates one or joins with a code.
- **Device identity.** An Ed25519 key pair made on first start; the private key is sealed with `safeStorage` in
  `<app>/identity.json` and signs in the main process for the core (the same pattern as providers), so it never
  sits in the core's memory. Device id: the first 16 bytes of the public key's SHA-256, base32. v1: one device per
  member.
- **Signed events.** Envelope `{id, ws, author, n, hlc, type, data, sig}`: `n` counts the author's events (1, 2,
  …), `hlc` is the hybrid logical clock (now also advanced by clocks seen from peers), `sig` is Ed25519 over the
  canonical JSON of the rest. Every row remembers the HLC of the event that last set it; an older event is kept in
  the log but changes nothing (last writer wins per entity, by HLC), so peers that receive events in any order end
  up the same. The personal workspace stays unsigned.
- **Genesis and roles.** A team workspace starts with a signed `workspace.created` naming the root admin.
  `member.certified {device, publicKey, name, role, expires}` signed by an admin is the membership certificate
  (about 30 days, renewed silently by any online admin); `member.removed` signed by an admin revokes it. Every peer
  checks every event: valid signature, an author certified at the event's time, a role that allows the event type
  (the table in 5.11). Events that fail are kept apart for diagnosis and never applied.
- **Transport.** Each app listens with HTTP on its Tailscale address, port 47640, only while it has a team
  workspace (loopback in tests). Every request carries the device id, a time and an Ed25519 signature over method,
  path, time and the body's hash; requests older than two minutes, from devices without a valid certificate (the
  join request excepted) or from outside Tailscale's ranges (100.64.0.0/10, fd7a:115c:a1e0::/48) are refused.
  WireGuard encrypts the link. Endpoints: heads (`{device: n}`), pull (events the caller lacks, paged), push,
  blobs by hash, join and join status, live (job updates and typing, not stored).
- **Sync.** New events are pushed to online peers at once; every 30 seconds each peer compares heads with every
  known peer and pulls what it lacks, so a third member passes on what two others missed. Addresses come from signed
  `device.endpoint` events and `tailscale status --json`.
- **Invites.** An admin makes a code (role, 24-hour expiry, one use) that carries the workspace id, the inviter's
  addresses and a 128-bit token. The joiner pastes it; the inviter's app shows "Ayşe wants to join as Editor" to
  the admins; approval writes `member.certified` and the joiner pulls the workspace. The invite screen walks
  through Tailscale: the same tailnet, or the inviter sharing their device.
- **Cross-member jobs.** A message that mentions another member's agent syncs like any message; the agent's owner's
  app starts the job if the agent's access rules allow the sender, runs it on the owner's CLI login and streams the
  job card live; the job's steps and end are signed events, the answer a normal message. Approvals go to the
  owner by default.
- **Built so far:** 3.1. Several workspaces: a registry in `<data>/workspaces.json` next to the personal one, the
  rail lists them and ＋ makes a team lonca; the open one is a setting. Workspaces in the background keep running
  (jobs, goals, advisors); their callbacks run in their own scope, so a background job or an agent's tool call reads
  and writes its own workspace, and only the open workspace's events reach the window.
  3.2. The device key (Ed25519, sealed in `<app>/identity.json`, signing in the main process through
  `PortSigner`); the device id stays the existing random one and certificates will bind it to the key. The log gets
  author counts, signatures (own events are signed after they are applied, so committing stays synchronous) and
  entities; `ingest` takes a peer's event, and an event older than what its entity shows rebuilds the entity from
  the log in clock order. Heads count only gap-free, signed events. Unit tests shuffle the same events into fresh
  copies and get the same tables every time.
  3.3 and the core of 3.4. A team workspace starts with a self-signed genesis naming the root admin, who certifies
  itself; `Membership` checks every incoming event (signature, a certificate valid by this device's clock, the role
  table of 5.11, owners for agents, advisors, messages and endpoints; a removed member's events count only up to what
  the admin had from them). `PeerServer` / `PeerClient`: signed HTTP on the Tailscale address (loopback in tests),
  with time, address-range and membership checks. `Sync` signs own events, compares heads with each member (or the
  inviter's address, for a device that just joined) and takes and gives what is missing, retrying events whose
  certificate comes later. Invites: a code with the workspace, the inviter's address and a one-time token; the joiner
  proves its key, an admin approves, the joiner polls and then pulls everything. Roles: set, remove (the removed
  device hears it for a day), automatic renewal by admins, local actions refused above the role. Tested with two
  cores in one process over loopback (invite, approve, messages both ways, roles, removal) and membership unit tests.
- **Slices:** 3.1 several workspaces; 3.2 identity, signed log, last-writer-wins; 3.3 transport and sync between
  two apps (two `LONCA_HOME` instances on one PC in tests); 3.4 invites, roles, members panel; 3.5 cross-member
  jobs and agent access; 3.6 presence, typing, notifications; 3.7 the phone companion.

## 9. Risks

- **Terms and billing move** (Anthropic's billing for `claude -p` changed twice in 2026; Google bans OAuth reuse):
  API-key mode for every driver, the vendors' current policy linked in the app, written confirmation asked before
  wide release.
- **CLI output formats change:** contract tests on pinned versions, capability detection, version warnings.
- **Tailscale is a hurdle for non-technical people:** a guided flow (install, sign in, invite to the tailnet or
  share the device); an embedded Tailscale (tsnet sidecar) only if it is still the main drop-off. No relay.
- **Members who are rarely online together** sync late; an always-on peer in the tray solves it for teams that
  need it.
- **Advisor cost runaway:** budgets, bot-turn caps, free providers by default, spend per bot.
- **Prompt injection through chat and records:** untrusted marking, others capped at read, scans on memory.
- **Scope:** this is a lot; phases ship on their own and each one is used before the next starts.
- **Code signing:** SignPath eligibility is not guaranteed; fallback is a paid certificate.

## 10. Open questions

None at the end of planning (2026-10-16). Next step: Phase 0.
