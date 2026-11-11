# Serai: plan

Status: **Phase 4 under way** (0.9.0-alpha.0, 2026-11-11). The product is called **Serai** since 2026-11-10 (it
was Lonca; the code name `lonca` stays in package names and environment variables, see section 2). Built on
2026-11-10/11: specialists (5.15), routines (5.16), the Overview page and unread counts (5.17), invite links with
a check of the way to the inviter (5.11); then (4.19) a shell that adapts to its room, an agent folder that no
longer has to be picked, character presets for agents and the personal settings. The name is open again: Serai
is taken (section 10). Before that (0.8.0-alpha.0, 2026-10-19): memory, projects with status pages, hand-over, several
CLI logins, `/durum`, `/özet`, quick entry and advisor notes; voice is paused (Kaan, 2026-10-19). The
connector store has its core and its catalog (4.10, 4.11, 2026-10-22): connectors from Serai's catalog, the MCP
Registry or by hand, served through Serai's gateway with a policy per tool; OAuth and MCPB come next. The done-checks of Phases 1-3 wait for real use by Kaan and Arda; see the status blocks
under section 8. Owners: Kaan and Arda. v0.1 (the Python chat server, tag `v0.1.0`) was the starting point for
ideas and the security model, not for code.

Research behind this plan: `docs/research/` (Claude Desktop, Antigravity, Hermes Agent + Jan, CLI agents, platform:
connectors, voice, networking). Theme: Grafit & tek vurgu, artboard 2 of the "Serai theme directions" canvas
(claude.ai artifact, private).

---

## 1. What Serai is

An open-source desktop hub where people and the CLI coding agents they already have work together.

- **Alone:** your agents (Claude Code, Codex, OpenCode, ...) in a chat-first cockpit: channels, live job cards you
  can watch, steer and stop, a task board, goals the agent works toward step by step, saved ideas, references and
  commands, memory, voice, one-click connectors, and advisor bots that watch the project and talk about it.
- **Together:** the same space shared with others through a join code and roles. Members and agents are listed on
  the right like a Discord server; anyone allowed can give a task to any agent; each agent still runs on its owner's
  computer, under the owner's own login.

Serai **does not have its own coding agent**. It drives the CLIs people install and log in to themselves. The only
model calls Serai makes itself are for advisors, memory upkeep and voice, on API keys the person enters.

It is the general version of Fabrika (roblox-factory's cockpit app), without Roblox and without the two-person
assumption. Roblox can come back later as a pack (connectors, commands, advisor profiles).

## 2. Decisions so far

From the Q&A on 2026-10-16.

| Topic | Decision |
|---|---|
| Name | **Serai** since 2026-11-10 (a caravanserai: where people arriving with their own caravans meet). It was Lonca; Kaan asked for a name the product can be published and sold under. The name lives in `packages/protocol/src/brand.ts`; the code name `lonca` stays in package names (`@lonca/*`), environment variables (`LONCA_*`), wire headers and file names. Invite codes and the data folder of the former name are still accepted. **2026-11-11: Kaan found the name taken; a new one is being chosen (section 10)** |
| Workspace word | Independent of the product's name: "alan" in Turkish, "workspace" in English (2026-11-10) |
| Distribution | Open source, **Apache-2.0** |
| Platforms, first release | Windows, Linux, phone companion (PWA). No macOS yet |
| Stack | Electron + TypeScript |
| Main agents | The user's own CLI agents, driven headless, as Fabrika does with Claude Code. No agent of our own |
| Provider sign-in | API keys and local endpoints for advisors (Groq, Anthropic, Gemini, NVIDIA NIM, DeepSeek, OpenAI-compatible, Ollama / LM Studio). Subscriptions only through the official CLIs the user logged in to |
| Workspace storage | Local only: every member keeps the whole workspace on their own PC. **No relay and no hosted server**, now or later |
| Networking | Solo needs nothing. Teams connect over Tailscale, as Kaan and Arda do with Fabrika |
| Code sharing | Git. Serai shows status and offers pull/push; chat, records and boards live in Serai's own store |
| Advisors | Continuous chatter (like Fabrika's #genel bots), on the advisor owner's keys |
| Cross-member jobs | Run on the agent owner's PC with the owner's login; the owner decides who may call it and how much it may do |
| `/todo`, `/goal` | `/todo` adds a card to the board; `/goal` starts goal mode (step by step until done, stoppable) |
| System prompts | Fabrika-like defaults for every role (worker, advisor, goal step, ...), editable by the people using them, in layers (5.14) |
| Phase order | Team (Phase 3) before memory, voice and the connector store (Phase 4) |
| Viewer role | Reads and posts messages; cannot task agents or edit the board and records |
| Repo | `github.com/kaanisthatyou/lonca`, private until Phase 1 is done, set up as open source from the first commit |
| Telemetry | None. Serai sends nothing |
| v0.1 code | Removed from `main` when the v2 skeleton lands; tag `v0.1.0` kept |
| Theme | **Grafit & tek vurgu** (direction 2 on the canvas) |
| UI copy | **Impersonal**: Serai's own text states facts and actions, with no author presence (7.1) |

## 3. Principles

1. **Solo works with nothing else.** No account, no server, no network, no Tailscale.
2. **The owner's machine decides what an agent may do; the workspace decides who may call it.** Agent folders,
   modes, connectors and limits are set only on the owner's computer and cannot be changed remotely (v0.1 rule).
3. **Only a person starts work.** A person's message, card or goal starts a job. Advisors and agents never start
   jobs of their own; an advisor may propose one as a card a person approves with one click. The agent working on a
   person's request may hand parts of it to other agents (Fabrika's hand-over, 2026-10-17): a part continues that
   person's request under the other agent's owner's limits, and a part is never handed on, so work fans out one step
   from a person and agents can never keep each other going. A routine (5.16, 2026-11-11) is a person's standing
   request: a message they wrote once, posted for them at the times they set, on their own computer, as themselves;
   it starts work exactly as that message would if they typed it.
4. **Safe defaults.** New agents: read-only, callable only by their owner. Others' requests are capped at read
   unless the owner raises it. Channel text reaches agents marked as untrusted.
5. **No credential handling.** Serai never reads, copies or moves a CLI's login files. It spawns the unmodified
   official binary, which uses its own login. No "Sign in with Claude/Gemini" inside Serai. "Claude" is never part
   of an agent's product name in the UI beyond describing what it runs.
6. **Clean room.** Nothing from closed apps (code, strings, assets). Open-source code only with its license notice.
7. **Everything bilingual.** Turkish and English UI from the first build.
8. **One small core with plugin points**, not Hermes-style breadth.

## 4. From Fabrika to Serai

| Fabrika | Serai |
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
- **The shell adapts to its room** (2026-11-11). The crew panel stands beside the page only in a wide window (from
  1180 px); below that, or when the person narrows it, it is a **strip** of avatars (who is here, a turning ring on
  a working agent, a still one in the warning color on one that waits for approval, the quota as a small ring) and
  the whole panel opens over the page from it. The live view does the same in a narrow window. The channel list
  hides and comes back (`Ctrl B`, a button on the rail; `Ctrl Shift B` for the crew panel). Pages lay themselves
  out by their own width, not the window's (container queries on the middle column): the board keeps readable
  columns and scrolls sideways one column at a time, records put the list above the record, the overview goes to
  one column. The first window is 1440 × 900 where the screen has the room.

### 5.3 Workers (CLI agents)

- An agent = a CLI kind + an owner + a machine + a folder + a mode + connectors + who may call it.
- **The folder does not have to be picked** (2026-11-11): an agent added without one works in this computer's
  default folder, which is a setting (Settings → General) and the desktop until it is set (as the system reports
  it, so a desktop moved to OneDrive is found). New agents stay read-only, so the default is safe to take.
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
- **Serai's own MCP server** for the agents it runs: search history and records, read references (images), read
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
- Push to talk: `Ctrl Space` inside Serai, toggle by default (Electron only sees key presses), plus the mic
  button. From anywhere: the quick-entry window (`Ctrl Alt Space`) with the same mic. `Ctrl Space` is never
  registered globally, because editors use it for completion.
- Local by default, downloaded on first use: whisper.cpp sidecar with the multilingual `small` model; Piper with a
  Turkish voice. Silero VAD (2 MB) ships with the app for auto-stop, silence trimming and barge-in.
- Cloud options: Groq Whisper, OpenAI, ElevenLabs. **Bring your own:** any OpenAI-compatible audio server, or a
  command template (`{input_path}`, `{output_path}`) for anything else (Hermes' pattern).
- No wake word and no full-duplex voice in v1.

### 5.9 Connector store

- **Catalog:** a curated list (~30 entries, "Verified by Serai") published as an open, signed static index that
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
- **Serai MCP gateway.** Headless CLIs cannot ask the person anything, so connectors do not go to the CLIs
  directly: Serai runs or connects every connector itself and gives each job one local HTTP MCP endpoint with a
  per-job token that exposes only that agent's connectors. "Ask" becomes a needs-attention approval on the job
  card; secrets never leave Serai; one audit point. The same endpoint serves Serai's own tools (5.3). For a CLI
  without HTTP MCP support, Serai writes a per-run config instead (Claude Code `--mcp-config --strict-mcp-config`,
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
| `Ctrl Space` | Push to talk (inside Serai, toggle) |
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

A project = a git repo; each member points it at their own clone. Serai shows branch, changes, ahead/behind, and
offers pull/push; jobs can end with a commit (owner's choice). Advisors read commits and diffs. Areas (folders
a member mostly works on) generalize Fabrika's `split.md`: every job gets them as a record, never a lock (Fabrika
dropped its claim rule on 2026-10-16 because it only slowed two people down); an agent that changes someone else's
area says so in its summary. The project's status page generalizes Fabrika's `progress.md` (where it stands,
milestones, next) and agents keep it current through Serai's tools.

### 5.14 Agent instructions (system prompts)

Every role ships with a default instruction template modelled on Fabrika's (its system note and the worker, chat
bot and Blender agent prompts in `app/fabrika.py` and `app/backend/team_claude.py`), and people can change them.

- **Roles with a default:** worker (who you are and for whom, where you run, language, no interactive prompts so
  ask in plain text and end the turn, the autonomy mode, area rules, what to do after the work: summary, board and
  goal updates, commit policy, how to treat channel context), advisor (one per personality: honesty over praise,
  length, when to stay silent, never offer to do work), goal step (plan, step, report format), `/meclis`
  moderator, memory upkeep, quick entry.
- **Layers,** assembled in this order for every job:
  1. Serai's core rules (untrusted context, only people start work, the owner's limits). Shown read-only, because
     Serai enforces them in code; the text only explains them to the model.
  2. The role's default template: editable, with "reset to default" and a diff against the default.
  3. Workspace instructions (Admins): team conventions, language, areas.
  4. The agent's or advisor's own instructions (its owner).
  5. The job's context pack (5.3).
- **Variables:** `{user}`, `{agent}`, `{workspace}`, `{channel}`, `{project}`, `{mode}`, `{language}`,
  `{members}`, `{areas}`, `{goal}`, `{date}`. A preview shows the exact text a sample job would receive.
- **Files, not database rows:** Markdown with frontmatter, with history and revert; export and import, and share
  as a workspace preset. When a release changes a default the person edited, Serai offers the new default as a
  merge instead of overwriting.
- **Personalities are presets:** Eleştirel, Doğrucu Davut and Olumlu are editable templates; duplicate one to make
  a new advisor.
- **Character presets for agents** (2026-11-11): twelve ready-made instruction lines an owner picks as chips in the
  agent form instead of writing them (thorough, quick, asks first, decides alone, few words, explains, light
  touch, test-minded, plans first, questions things, keeps notes, brings options). Opposites exclude each other
  (thorough/quick, asks first/decides alone, few words/explains), at most six per agent. The agent keeps the ids
  and the text comes from `packages/protocol/src/traits.ts` every time, so a better wording reaches every agent
  that picked it; they go into the prompt as part of the owner's layer (4), before the owner's own words, and
  specialists can carry them next to their playbook. Like every instruction text they are English and grant
  nothing.
- **Text never grants rights.** No instruction layer can widen an agent's mode, folders or connectors; those come
  only from the owner's settings (principle 2).
- Delivery per driver: Claude Code `--append-system-prompt` (or `--system-prompt` to replace, as Fabrika can);
  other CLIs through their equivalent, else the first message of the session.

### 5.15 Specialists

Fabrika's Blender agent made general (2026-11-10): an agent for one kind of work, done the same way every time.
A specialist is an agent with a `specialty`:

- **Role**: one line, shown next to its name and told to the other agents, so a worker knows whom to hand a part to.
- **Playbook**: how it works, step by step; its owner's Markdown, given with every job instead of the worker
  template.
- **Channel history**: it reads the channel's latest messages (0-200, whoever wrote them) before each job, so it
  knows what the people there are doing; search tools reach further back.
- **Fixed references**: reference records it gets with every job, next to the ones attached to the request.
- **Budget per job**: minutes and optionally tokens. At three quarters it is told to wrap up; past it the job is
  stopped (`over_budget`). Time spent waiting on a person's approval does not stop it.
- **A fresh session per job**: nothing carries over but the playbook and the lessons.
- **Lessons**: with `learn_lesson` it keeps one-line lessons for later jobs. A lesson from a job its owner asked
  for is kept at once; one from someone else's request, or one that looks like steering, waits for the owner.
  Lessons are part of the agent (shared with the workspace, bounded, the oldest lines go first) and its owner edits
  them.
- **RESULT line**: it can end with `RESULT {json}`, which is taken out of the chat, shown as a small table, and
  handed to whoever asked (`part_status` gives it to the agent that handed the part over).
- It never hands work on. Its mode, folder, access rules and connectors are an ordinary agent's (principle 2).

Templates (a start, copied into the agent): code reviewer, test writer, researcher, 3D modeler, interface
designer, documentation writer, security auditor, blank. A specialist's definition can be copied as text and
pasted into another person's gallery (without its folder, references and lessons).

### 5.16 Routines

A message a person asked to have posted for them at a set time on set days ("@test run the suite" every morning).
Shared with the workspace; only its owner changes or runs it, and only its owner's computer posts it, while the app
runs there (a missed time is caught up within an hour, an older one is let go). The message is the person's own, so
agents' access rules treat it as theirs. "Run now" posts it at once.

### 5.17 Overview and unread

- **Overview**: what runs now (with the current step and budget), people and the agents on their computers,
  projects with their milestones, the latest finished jobs, today's numbers (jobs, tokens, cost, messages) with the
  last seven days, and the setup steps until they are done or hidden.
- **Unread**: each channel shows how many messages arrived since it was last open (kept on this computer) and
  whether one names the person (`@name`); members complete after `@`; a line marks where the new ones start.
- A person's messages in quick succession read as one run.

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
packages/connectors store, registry, OAuth, MCPB, MCP gateway (with Serai's own tools), per-CLI config writers
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
  offline. Serai never runs or depends on a relay or hosted service.
- A member who wants the workspace always reachable can leave Serai running in the tray on an always-on machine;
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
  can be picked in Settings (lime, blue, orange, violet, teal, rose, amber); never two at once.
- **Personal** (2026-11-11, Settings → Appearance): text size (small, normal, large: the window's zoom, so
  everything scales together), density (comfortable or compact rows, messages and cards), the time format (24 or
  12 hours), the crew panel as a panel or a strip, the channel list shown or hidden, and the start page (the
  overview or the last channel). Settings → General: system notifications on or off, the default folder for agents.
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

Serai's own text (buttons, labels, menus, placeholders, empty states, notifications, errors, tooltips, the
launcher) is impersonal and objective: it names what a control does or states what happened. The author is not
present in it.

- No feelings, opinions, praise, jokes, greetings, encouragement or apologies; no exclamation marks; no emoji.
- No addressing the reader: no `sen` / `siz`, no second-person possessives (`kotan`, `ayarların`), no
  "Hoş geldin". In English no "you" / "your".
- The app never speaks as "I" or "we" and is never personified ("Serai düşünüyor" → "İşleniyor").
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
| **0. Foundation** | Theme choice, tokens and component kit, repo scaffold, CI, Electron shell, first-run launcher, i18n, signed installer, auto-update | An installable empty Serai updates itself |
| **1. Solo core** | Channels, messages, records (ideas, references, commands), Claude Code and Codex drivers with job cards, live view, steering, stop, quota, login state, autonomy ladder, needs-attention inbox, `Ctrl K`, shortcuts, `/todo` board, MCP gateway with Serai's own tools, worker instruction templates and their editor | Kaan runs a real non-Roblox project from Serai for a week |
| **2. Advisors and goals** | Provider presets and keys, advisor profiles with editable personality presets and chatter with budgets, `/meclis`, `/goal` with plan approval and comments, worktrees | A goal finishes on its own while the advisors comment |
| **3. Team** | Peer sync over Tailscale, invites, approval, role certificates, members panel, cross-member jobs, notifications, phone companion | Kaan and Arda run a project together on Serai instead of Fabrika's team tab |
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
  problem, and Serai's MCP endpoint reached through `-c mcp_servers.serai.*` with the token in an environment
  variable. A logged-in run (tool calls, answers) is still untested.
- Job cards (live steps, streaming answer, usage, cost, steer, stop), the live view with the whole transcript,
  the quota panel.
- `/todo` and the board: four columns, drag and drop, an agent per card, "Run as job", the card follows the job.
- `Ctrl K` palette (channels, agents, views, actions, message search), `Ctrl /` shortcut list, `Alt ↑ / ↓`,
  `Ctrl .`.

- Records: ideas (with status), references (images pasted, dropped or chosen), saved commands with `{user}`,
  `{channel}`, `{date}`; any message saved as an idea; records attached to a message reach the job as notes,
  references as images (inline for Claude Code, `--image` for Codex).

- Instructions (5.14): Serai's core rules shown read-only; the worker template and the workspace's instructions as
  Markdown files (`<data>/instructions/worker.md`, `<workspace>/instructions.md`), with earlier versions kept under
  `history/`, "back to default", a notice when the shipped default changed under an edited copy, and a preview of
  the whole prompt per agent. A session restarts its CLI process (same conversation) when a layer changes.

- The MCP gateway: a small Streamable HTTP endpoint on 127.0.0.1 with one bearer token per agent session (Host
  and Origin checked), serving Serai's tools: `search_messages`, `list_records`, `read_record` (with the image),
  `list_cards`, `add_card`, `update_card`, `post_progress`. Claude Code gets it with `--mcp-config` and
  `--allowedTools mcp__serai`; checked with a real Claude Code call (connected, tool called without a prompt).
  Codex gets the same endpoint through per-run config overrides.

- Approvals: at read and edit, Claude Code asks Serai over stdio (`--permission-prompt-tool stdio`,
  `control_request` / `can_use_tool`, checked with a real call); the job waits as "Onay bekliyor" with Allow and
  Deny on its card, a "Bekleyenler" count in the sidebar, an OS notification when Serai is in the background, and
  `Ctrl Shift ↑ / ↓` to go through waiting jobs. Control requests Serai does not handle get an error answer.

- Pinned commands as buttons above the message box; shortcuts rebindable in Settings (recorded by pressing them,
  conflicts refused, back to default), the shortcut list showing the current keys.

- `e2e/real-claude.mjs` (by hand, two short Haiku turns): the real Claude Code answers from a project's files
  and moves a board card through Serai's MCP tools; the packaged 0.3.0-alpha.0 passes `smoke.mjs` and
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
  run against a real provider with a real key. Serai gathers the channel, the board and git history for them;
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
- Worktrees: a goal can run in its own git worktree (`<data>/worktrees/<goal id>`, branch `serai/goal-<id>`), in a
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
  3.4 in the app: Davet (role, how long the code lasts, the code to copy, Tailscale guidance), ＋ → Koda katıl, the
  rail showing a lonca that waits for approval, join requests with Onayla / Reddet (and an OS notification), the
  members list with online dots, role changes and removal for admins. `e2e/team.mjs` runs two real apps on one PC
  over loopback: invite, join, approve, messages both ways.
  3.5. Agents carry their owner and access (who may give jobs: only the owner or editors; the highest permission
  for others; "approve others' jobs first"). Only the owner's app runs an agent: a mention from another member
  reaches it through sync, the access rules decide, the mode is capped, and with approval on the job waits as
  "İşe başlama" until the owner allows it. Job states (start, waiting, end) are signed `job.saved` events, so
  everyone sees the card ("Sahibi: Kaan"); steering, stopping, approving and the live view stay with the owner.
  Viewers cannot change the board, records or goals; goals and cards use only own agents; agents' own channels
  belong to the agent's owner. Covered in the two-core unit test and `e2e/team.mjs` (Arda's mention runs Kaan's
  fake Claude Code and the answer comes back).
  3.6. A live path between members (`/v1/live`, signed like the rest, never stored): "Arda yazıyor" under the
  messages (at most every three seconds, at once again after a send), and another member's running job moving on
  everyone's card about once a second (only the agent's owner may report it). The members list shows who answered
  the last sync. A message from another member in a background lonca marks it in the rail; while Serai is in the
  background a message from another member gives an OS notification.
  0.5.0-alpha.0 (2026-10-18): the packaged app passes all e2e tests; `e2e/tailscale.mjs` (by hand, on a computer
  with Tailscale) has one app listen on its real Tailscale address: the invite carried `100.76.173.48:47640` and the
  second app joined and chatted through it.
  3.7. The phone companion: the core serves the built UI on 127.0.0.1:47620 with `tailscale serve` in front for
  HTTPS (`https://<pc>.<tailnet>.ts.net:47621`); requests are the same frames over POST, events a server-sent
  stream. Settings → Telefon turns it on, shows why it cannot work yet (Tailscale off, no HTTPS certificates in the
  tailnet, `tailscale serve` failed, port taken), and pairs a phone with a one-time QR link (ten minutes); each phone
  gets its own key (cookie, or a header and the event address for home-screen apps without cookies; only the hash is
  kept) and can be removed alone. Writes need the `x-lonca` header and a matching origin. On a narrow screen the UI
  is one column with a bottom bar (Kanallar, Görevler, Bekleyenler, Loncadakiler, Ayarlar) and full-screen dialogs;
  settings about the PC itself are not offered on the phone. `e2e/phone.mjs` pairs a narrow window as the phone.
  Pushes: Web Push with no library (RFC 8291 aes128gcm, RFC 8292 VAPID with a key made once on the PC); the phone
  turns them on with one tap (a banner), its service worker shows them, and the PC sends one when a job waits for
  approval, someone asks to join, or another member writes, but never to a phone that has the app open; dead
  subscriptions are dropped. Tested against a stand-in push service that decrypts what it gets.
  Phase 3 is built (2026-10-18). Left: the real test between Kaan's and Arda's computers over Tailscale (the
  phase's done-check), and a real phone with HTTPS certificates turned on in the tailnet.
- **Slices:** 3.1 several workspaces; 3.2 identity, signed log, last-writer-wins; 3.3 transport and sync between
  two apps (two `LONCA_HOME` instances on one PC in tests); 3.4 invites, roles, members panel; 3.5 cross-member
  jobs and agent access; 3.6 presence, typing, notifications; 3.7 the phone companion.

### Phase 4 status (started 2026-10-18; voice paused on 2026-10-19)

- 4.1 Memory: personal sections (profile, notes) in `<app>/memory.json`, on this computer only; workspace sections
  (decisions, conventions, glossary) as signed `memory.saved` events that editors write. Each section has a
  character limit, and all of it goes into agents' prompts (as facts kept by people, not instructions) and into
  advisors' prompts; a job card says how many sections it recalled. `/hatırla` adds a dated line to the notes.
  Agents suggest through the MCP tool `suggest_memory`; suggestions wait in Bellek with their source and flags for
  things that look like steering (instructions, role changes, markup, secrets, passwords in addresses, encoded
  blobs, length) until a person edits and accepts or rejects them. Not yet: upkeep by a cheap model (summaries) and
  per-advisor notes (added as 4.8). Search: the MCP tool `search_workspace` looks through messages, records, board cards, goals and
  project status pages (added with 4.5).
- 4.2 Projects (5.13), Fabrika's per-game folder made general: a project is shared (name, description, areas as
  signed `project.saved` events, the status page as `progress.saved`), its folder is each computer's own clone (a
  local table, never synced). The page shows the clone's git state (branch, upstream, ahead/behind, changes, recent
  commits; fetch at most every five minutes unless asked, `pull --ff-only` and `push`, never forced, git never
  prompts), the status page ("where it stands", milestones, next; a clone with a Fabrika `progress.md` starts the
  page from it) and the areas. An agent whose folder is inside a project's clone gets the page and the areas in its
  prompt and two MCP tools, `read_status` and `update_status`; advisors whose folder is inside one get the page too.
  Areas are a record, not a lock. Covered by unit tests (git with real repositories, two cores syncing a project and
  a page edit) and `e2e/channel.mjs` (a project from a repository with `progress.md`, the fake agent updating the
  page, a person editing it, the page after a restart).
- 4.3 Hand-over (Fabrika's `job_request.py`): the MCP tool `hand_over` posts a self-contained part of the person's
  request the agent is working on as `@other task`, marked with the request it continues; it runs in a session of
  its own (closed when the part ends), as that person's request: the other agent's access rules and mode cap apply,
  also when it belongs to another member and runs on their computer, and a part never gets more than the handing
  agent's owner could ask for (the stricter of the two), so a member cannot borrow someone's rights by naming their
  message. `part_status` gives the state and, once done,
  the answer (waiting up to 50 seconds per call). Refused for a job that is itself a part, for the agent itself, and
  past six parts per request; a part may start up to two hours after the handing job started. The message shows a
  "handed-over part" label. Covered by unit tests on one computer and between two (Kaan's agent hands a part to
  Arda's, which runs capped at read on Arda's computer and answers back).
- 4.4 Several logins per CLI (Fabrika's second worker on another Claude login): Settings → Agents → Accounts adds an
  extra login of Claude Code or Codex on this computer. Each is a config folder of the CLI's own under
  `<app>/accounts/<id>` (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`), signed in with the CLI's own login opened there; its
  state is read with the CLI's status command under that folder. An agent can run on an account; its quota shows
  under the account's name. Accounts stay on this computer (`<app>/accounts.json`); removing one leaves its folder.
  Covered by a unit test and `e2e/channel.mjs` (an account added, signed out, offered in the agent form).
- 4.5 `/durum` (also in `Ctrl K`): every computer's installed CLIs (version, plan, login state), extra logins and
  latest quota, this computer first. In a team workspace the others are asked over the live link (never stored) and
  answer within seconds, at most every three seconds each; answers are kept to their expected shape. Covered by the
  two-core unit test and `e2e/channel.mjs`.
- 4.6 `/özet [hours | hafta] [@advisor]`: an advisor of the channel (the one named, else the first) sums up the
  channel's last hours (24 by default): decisions, done work, what is open or blocked, who waits on whom. It reads up
  to 300 messages of the period instead of a normal turn's 30, on its own budget and provider; the summary is the
  advisor's message, so Serai never speaks as itself. Covered by a unit test.
- 4.7 Quick entry (5.10): `Ctrl Alt Space` from anywhere (registered globally by the main process; when another app
  holds it, the palette's "Hızlı giriş" opens the same window) shows a small always-on-top window on the screen the
  pointer is on: a channel or agent to write to (the last one used is remembered) and a message box; Enter sends and
  the window hides, as it does on Esc or when it loses focus. It is the same UI bundle with its own connection to the
  core. Its key is rebound in Settings → Shortcuts like the others; the main process registers the new one first and
  keeps the old one when another app holds it. Covered by `e2e/channel.mjs` (opened from the palette, a message sent
  to #genel, the key listed in Settings) and the packaged build's smoke and channel runs.
- 4.8 Per-advisor notes (5.7): an advisor that ends an answer with a `/not <note>` line keeps the note (dated, at most
  2000 characters, the oldest lines go first) on the computer it runs on; the line is not shown, and the notes go
  into that advisor's prompt only. Its owner reads and edits them in the advisor form. Covered by a unit test.
- 4.9 Moving from Fabrika: `Ctrl K` → "Fabrika'dan içe aktar" takes a roblox-factory folder and turns its ideas
  (`ideas/*.md`, front matter kept as status and tags), references (`references/*.json` with their images), saved
  prompts (`.claude/commands/*.md`) and games with a status page (`games/*/progress.md`, as projects pointed at the game
  folder) into records and projects of the open workspace. Nothing in the folder changes; things already here (same
  kind and title, same project name) are skipped; advisors stay quiet about imported ideas. On the real roblox-factory
  it reads 20 ideas, 40 references, 9 prompts and 7 games. Covered by unit tests and `e2e/channel.mjs`.
- 4.10 Connectors, the core of the store (5.9), 2026-10-22: Settings → Bağlayıcılar adds an MCP server by hand, a
  remote one (Streamable HTTP; JSON or event-stream answers, the session id, no redirects, https except loopback,
  private networks and Tailscale) or a local program over stdio (no shell; it gets Serai's environment without
  variables that look like keys or tokens, and Serai's own). Connectors belong to this computer:
  `<app>/connectors.json`, never synced; header and variable values are sealed by the main process with safeStorage
  (none stored where nothing can seal them) and shown as their last characters. Saving tests the server in the
  background (`initialize`, `tools/list`, up to two minutes for a first `npx` download); a failure shows the server's
  own words. Each connector lists the agents of this computer that may use it, and each tool has a policy: allow
  (the default for tools the server marks read-only), ask every time (the default otherwise), ask once per job,
  blocked (the agent does not see it). The gateway serves an agent's connector tools next to Serai's own as
  `<slug>__<tool>` (at most 50 characters, so `mcp__serai__…` fits every CLI); a call that asks waits on the job card
  like a CLI's approval (one at a time, ten minutes, then denied; Claude Code gets `MCP_TOOL_TIMEOUT` and Codex
  `tool_timeout_sec` to wait that long), and a request from another member never runs a tool unasked. A changed tool
  list starts the agent's CLI again with the same conversation. Serai connects on first use and closes a server
  after ten idle minutes. Covered by unit tests (stdio and HTTP clients, the core end to end), `e2e/channel.mjs`
  (a local connector with a secret, an approval on the card) and `e2e/real-claude.mjs` (`REAL_QUICK=1`: the real
  Claude Code on Haiku called a connector's tools through Serai after an approval); the Codex contract test passes
  with the new flag. Not yet: OAuth, MCPB bundles, the team-visible log of tool decisions, and connectors on other
  members' computers.
- 4.11 The catalog (5.9), 2026-10-22: Bağlayıcılar → Katalogdan ekle shows Serai's catalog above a live search of the
  official MCP Registry (`/v0.1/servers`, by name, latest active versions), which is marked as community and not
  reviewed. Both install the same way: a registry `server.json` becomes install plans (a Streamable HTTP remote, or
  an npm, PyPI or OCI package run pinned through `npx -y pkg@version`, `uvx pkg@version` or `docker run -i --rm`),
  each with the fields it asks for (keys, tokens, folders, flags as checkboxes); the form shows what will run and
  which values are sealed, says when npx, uvx or docker is missing, and saves through 4.10 with an install record
  (catalog or registry, the registry name, version, how it runs) shown on the card. A bare key in `Authorization`
  gets `Bearer`; a docker `-e NAME={secret}` becomes a sealed variable passed by name, so secrets never sit in the
  arguments. SSE remotes, MCPB and OAuth-only entries are not offered yet. The catalog (`packages/protocol/src/
  catalog.ts`) holds 11 entries checked on 2026-10-22 that work without OAuth: GitHub, Context7, Microsoft Learn,
  Playwright, Chrome DevTools, Exa, Tavily, Firecrawl, Hugging Face, Supabase (starts read-only) and Sentry, each a
  copy of its registry entry with the plans offered, safe defaults, where to get a key, and corrections found
  against the real server (GitHub's token is required although its entry says optional). It ships with the app;
  a signed index others can mirror waits for the public repository. Covered by unit tests (the conversion on real
  entries, every catalog entry, the search against a stand-in), `e2e/channel.mjs` (the catalog, an entry's form, a
  search against a stand-in registry) and two opt-in checks against the real servers: `LONCA_REAL_REMOTE=1`
  (Context7, Microsoft Learn, Exa, Firecrawl and Hugging Face answer `initialize` and `tools/list` through Serai's
  client) and `LONCA_REAL_NPX=1` (Playwright, Chrome DevTools, Context7 and Firecrawl start through npx on Windows).
  Next for the store: OAuth (Notion, Linear, Figma, Sentry's and Stripe's remotes need it), MCPB, a workspace's own
  allowlist, and the tool-decision log.
- 4.12 The rename (2026-11-10): Serai. One constant (`BRAND`) for the name everywhere a person or a model reads it
  (the UI through `{{app}}` in the locale files), the MCP server agents see (`mcp__serai__*`), git branch prefixes
  (`serai/goal-…`), a new mark (a caravanserai's gate). Invite codes start with `SERAI1.`; `LONCA1.` codes are
  still read. On first start the former name's data folder is moved to the new one (not yet tried on a real
  installation). Workspaces are "alan" / "workspace" in the UI.
- 4.13 Specialists (5.15), 2026-11-10: the `specialty` of an agent, the specialist prompt, the roster given to
  workers, a session per job, the budget (timers, a token check after every usage report), the RESULT line (kept
  on the message, given through `part_status`), lessons (`learn_lesson`, waiting ones in `lessons.pending` on the
  owner's computer, `lessons.accept` / `lessons.reject`), eight templates. In the app: a gallery, a form in four
  parts, a group of their own in the members panel with what they learned, the budget on the job card, the RESULT
  table. Covered by unit tests and `e2e/specialists.mjs`. Not yet run with a real CLI.
- 4.14 Joining (5.11), 2026-11-11: `serai://join/<code>` opens the app (a second copy hands the link to the running
  one) with the join dialog filled in; `invites.check` reads an invite without using it and says which workspace
  it is for, whether Tailscale runs here, whether the inviter's device is in sight and whether its app answers.
  The invite dialog copies the code, the link, or a message with the steps for the person joining. Tailscale's
  status now lists the tailnet and the devices in sight. Covered by unit tests and `e2e/team.mjs` (the link through
  a second copy of the app). The protocol handler is registered only by the installed app; not yet tried there.
- 4.15 Overview and unread (5.17), 2026-11-11: `overview.get`, `channels.read`, unread counts and mentions in the
  workspace state, the Overview page, the channel list's marks, the line above new messages, runs of messages.
- 4.16 Routines (5.16), 2026-11-11: `routine.saved` / `routine.deleted` events (owner-only, like agents), a tick
  every minute on the owner's computer, `routines.save` / `delete` / `run`, the Routines page. Covered by unit
  tests (due times, catch-up, ownership) and `e2e/specialists.mjs`.
- 4.17 Small things, 2026-11-11: the members panel shows what a working agent is doing; an empty channel offers
  the agents that can be called; a specialist is shared as text; after the launcher the Overview opens first. The
  message box empties at once on send (text typed while a message was on its way used to be wiped when it landed;
  `e2e/specialists.mjs` caught it).
- 4.18 Checks on 2026-11-11: all six e2e scripts pass against the built app; the packaged
  `Serai-Setup-0.9.0-alpha.0.exe` was built and its unpacked app passes `smoke`, `specialists` and `team`
  (invite link through a second copy). `e2e/real-specialist.mjs` (by hand, one Haiku job): the real Claude Code
  as a code reviewer read the channel, found the planted bug with file and line, kept a lesson through
  `learn_lesson` and ended with a RESULT line that was taken out of the chat. Not yet tried on a real
  installation: the `serai://` handler (registered only by an installed app without `LONCA_HOME`) and the move of
  the former name's data folder.

- 4.19 The shell, the agent form and personal settings (5.2, 5.3, 5.14, 7), 2026-11-11, from Kaan's notes after
  using 0.9.0: text ran out of the board and the idea status control in a narrower window, a folder had to be
  picked for every agent, and there was little to make the app one's own. Built: the adaptive shell (crew strip,
  the panel and the live view over the page in a narrow window, a channel list that hides, container queries for
  the board, records and overview, a segmented control that wraps), the default agent folder (`system.info` gives
  it, `LONCA_DESKTOP_DIR` from the main process, a setting over it), character presets (`traits` on the agent,
  `cleanTraits` / `traitsPrompt`, a session restarts when they change), the look and layout settings (three more
  accents, text size through `shell:setZoom` with the title bar and the quick-entry window following, density,
  time format, start page, notifications). Covered by unit tests (`traits.test.ts`: the presets, the prompt, the
  default folder, old settings files) and `e2e/layout.mjs` (an agent without a folder, presets in the prompt
  preview, every look setting, the strip and the panel over the page at 960 px, columns that keep their width,
  the hidden channel list, a restart). `e2e/tour.mjs` walks every page at several window sizes for looking at
  layouts (no assertions). Not yet: the same pass over the dialogs' own layouts below 760 px (the phone), and a
  real CLI run with presets (they are prompt text only).

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

From 2026-11-11, for the owners:

- **The name.** Serai was chosen without a trademark or domain check, and Kaan found it taken (2026-11-11; a web
  search shows a Zurich smart-home company of that name and `serai.dev` / `serai.app` registered). Candidates
  checked the same day with a web search and RDAP, which is weak evidence and no trademark search: **Avlu**
  (courtyard, where a caravanserai's guests meet; `avlu.dev`, `avlu.ai` and `avlu.io` unregistered; an unrelated
  loyalty app "Avlu Club"), **Tayfa** (crew; only `tayfa.io` unregistered; a Turkish game studio and a children's
  series use the word), **Tezgah** (workbench; only `tezgah.io` unregistered; no software product found),
  **Eyvan** (a caravanserai's vaulted hall; `eyvan.dev` and `eyvan.io` unregistered; eyva.ai is close). Ruled out:
  Kalfa (a Claude Code extension has it) and Kovan (Kovant makes agent software). A new name is a change to
  `brand.ts`, the icon, `electron-builder.yml`, `productName` in `apps/desktop/package.json` and `e2e/locale.mjs`;
  the former names' invite codes and data folders should stay accepted.
- **Earning money.** Kaan (2026-11-10): the product could be published and earn money. The plan so far says
  Apache-2.0 with no hosted service. Ways that fit it: paid signed builds with updates and support while the source
  stays open; a paid team tier (more than a few members, an always-on peer, audit log) on an open core; paid packs
  (specialist sets, connector bundles). Not decided; nothing in the code assumes any of them.
- **Routines and principle 3.** Routines were added as a person's standing request. If the owners read "only a
  person starts work" more strictly, routines are one switch to remove.
- **The repository** is still `kaanisthatyou/lonca` and private; renaming it and making it public are the owners'.
