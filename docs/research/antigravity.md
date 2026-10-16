# Google Antigravity: how it manages many agents (static study)

Method: static reading only; nothing was launched. All facts come from the installed bundle. No public docs were used (the one page tried returned 404), so nothing here is docs-derived. Wording is paraphrased; no code, UI strings, assets or endpoints are reproduced (clean-room).

## 0. What is installed

Two directories under `AppData/Local/Programs`: `Antigravity` and `Antigravity IDE`. Both are the same product (a VS Code 1.107 fork, product name "Antigravity IDE") with the same executable size, but different builds. `Antigravity/resources/app/product.json` says IDE version 2.0.1 (built 2026-05-19, Microsoft extension gallery). `Antigravity IDE/resources/app/product.json` says 2.5.5 (built 2026-08-13, Open VSX gallery). The newer build has a larger agent UI bundle and language server. The "Agent Manager" is not a separate app: it is a second renderer bundle (`out/jetskiAgent/main.js`, 12 MB, one minified React/Tailwind file) shipped inside the IDE, plus a Go language server. Internally the agent UI is called "Jetski" and the agent loop "Cascade" (a lineage from Windsurf/Codeium; settings and headers still use that vocabulary).

## 1. Agent Manager ("mission control")

**Shape.** Window kinds in the bundle: Manager, Settings, Launchpad (plus debug views). The Manager is conversation-centric: a sidebar of conversations, a step-by-step chat view, an auxiliary pane (artifacts, diffs, browser, terminal) and an optional embedded editor.

**Listing and grouping.** Conversations are grouped into sections per workspace or project, with collapse state saved per section. Inside a section they sort by time of the last user input. A pinned strip sits on top (drag to reorder, order stored locally). Per row: rename, archive, delete, mark read/unread. Empty scratch workspaces are hidden. A "project" is a named set of folders with its own agent settings and permission grants; conversations may also be standalone. Conversations can be forked (split view with the parent), and a "best of N models" mode runs one prompt on several models so the user keeps one result.

**Run environment per task.** Local (current workspace) or a background git worktree. Closing is blocked while a merge-back failed or subagents or background tasks still run (enum in `out/jetskiAgent/main.js`).

**State model.** Two small state machines:
- Conversation run state: idle, running, canceling, busy.
- Step state: generating, queued, pending, running, waiting, done, canceled, error, interrupted.

A conversation "needs attention" when at least one step is waiting (an unapproved command, a browser action, a review). The row then shows that step's one-line summary, and for subagents inline approve and deny buttons. Ordering of running items: waiting first, then running, then idle, then killed; ties by latest start.

**Live updates.** The UI subscribes to a server-streaming RPC per conversation (subscriber id, paged step slices) from the local language server over loopback HTTPS with a per-session CSRF header, and re-subscribes after one second if the stream breaks. Steps are the unit of everything.

**Inbox and notifications.** No literal inbox screen was found. The equivalent is the needs-attention marking in the list, OS notifications (setting: notify when the agent needs attention or finishes), an optional completion sound, and toasts. Static reading cannot show how badge counts roll up.

**Steering and interrupting.**
- Sending while the agent works is allowed: the message is queued and inserted at the next break in reasoning; there is a "send queued message" action (the user-input step carries a queued flag).
- Stop controls per running item, plus "stop all subagents"; step-level accept and reject.
- "Side question": ask something without disturbing the main thread.
- Revert to a step (refused when that step carries review comments), fork, prune.
- Subagents (browser subagent and others) appear as child conversations in a running-items panel with their own stop and approve controls; background tasks show in the same panel.
- A scheduled-tasks screen exists, and a "remote control" preference plus a "manage conversations from the website" switch hint at a cloud or phone path (not analysable statically).

## 2. Artifacts

Kinds (enum): implementation plan, walkthrough, task list, other. Help text says artifacts are created when the agent does more complex, longer tasks in Planning mode (an on/off conversation mode; off is the quick mode without artifacts). They are markdown files in a per-user data folder ("brain", one subfolder per conversation) with names for task, implementation plan and walkthrough; browser screenshots and recordings are stored with them. There is also a global artifact viewer and export.

Roles (inferred from icons, file-name checks, UI): task = live checklist the agent ticks; implementation plan = proposal awaiting approval before coding; walkthrough = after-the-fact summary of changes and verification, with media.

**Review and comments.**
- The user selects text in an artifact and attaches a comment through a floating button. Comments are held client-side per artifact and conversation until submitted.
- Submit opens a popover: optional overall message, list of pending comments, voice input.
- On an implementation plan the main action is "proceed" (with N comments if any). Proceed sends an approval entry; other comments carry "requested changes". The UI shows both as pills.
- Flow back to the agent: comments are structured fields on the next user-input step: artifact comments (artifact id, scope = whole file or text selections, comment text, approval status), file comments, and per-hunk diff comments. The UI does not paste them as text; how they become prompt content happens server-side and cannot be seen statically.
- Diff review keys: next and previous hunk alt+j and alt+k, accept alt+Enter, reject alt+shift+Backspace (`extensions/antigravity/package.json`, contributes.keybindings).

## 3. Autonomy and permission policies

All in the agent UI settings registry (`out/jetskiAgent/main.js`); project-level overrides replace the global value.

- **Security preset** (3): full access, sandboxed (restricted outside trusted folders), strict (commands always need review, no access outside the workspaces; the loose options become unselectable).
- **Terminal command policy** (3): always proceed (never asks except deny-list), request review (always asks except allow-list), proceed in sandbox (automatic only if the command ran sandboxed, else ask). Changes apply to new messages only. Always-proceed without a sandbox shows a danger warning.
- **Allow and deny lists** for terminal commands: Unix shells match by token prefix; PowerShell by any contiguous token subsequence; deny wins.
- **Artifact review policy** (2): always proceed (flagged as risky because artifact content may carry injected instructions) or always ask.
- **Browser**: tools on/off; JavaScript execution policy (disabled, ask, model decides, always proceed); a URL allowlist (a palette command shows it, and the agent prompts on unlisted sites); custom Chrome path, profile path, debugging port.
- **File access**: outside-workspace access off by default; explicit allow or deny entries for read paths, write paths and URLs (permission grants: allow, ask, deny; global and per project). A decision record distinguishes user, system, model and default allow or deny.
- **Sandbox**: optional terminal sandbox with a network toggle (a shell wrapper ships in `extensions/antigravity/bin/sandbox-wrapper.sh`) and a "commands outside the sandbox" list.
- Also: auto-fix lints, shell integration versus the agent's own shell, MCP servers (`extensions/antigravity/schemas/mcp_config.schema.json`).

## 4. Rules, memory, models, shortcuts

- **Customization types** (enum): rules, workflows, skills, agents, plugins, hooks, MCP. Workspace rules live in a dot-agent or dot-agents folder (both accepted); a global memory file lives in the user data folder. Each rule has a trigger mode: always on, model decision, manual, or glob. Workflows are reusable prompts run by slash command (workspace and global folders). Skills have custom search paths and a recommender that offers a skill when the project uses a known platform. Plugins package skills plus MCP. Hooks include "before the model is called". Custom agents live in workspace or global agent folders.
- **Knowledge**: a per-user knowledge folder. The agent generates items in the background and reads them back; one switch disables reading without deleting. Conversation history can also be made searchable by the agent. Scoring and injection are not visible.
- **Models**: the list comes from the server per account. The picker has groups, a quota and credits page, and add or edit of custom models (Linux builds only, Gemini-API models only). An API-provider enum shows Google plus Anthropic via Vertex among others. The actual catalog is not in the bundle.
- **Shortcuts** (mod = Ctrl or Cmd): new conversation mod+n, mod+shift+o, mod+shift+l; conversation picker mod+k; history mod+y; scheduled tasks mod+u; next and previous conversation alt+Down and alt+Up; model selector mod+/; project selector mod+;; environment selector mod+.; toggle editor mod+e; terminal mod+j; aux pane mod+shift+b; focus input mod+l or mod+i; command palette mod+shift+p; file picker mod+p; code search mod+shift+f; commit graph mod+shift+c; voice ctrl+m. In the history list: Enter open, shift+i read, shift+u unread, shift+e archive, shift+# delete.

## 5. Where the agent core lives

- `extensions/antigravity/bin/language_server_windows_x64.exe` (about 130 MB PE, built with a pre-release Go toolchain from 2026; the REA build-info read returned no module list, so dependencies are stripped). The agent loop, planner, tool execution, prompts, artifact and knowledge generation and model calls are almost certainly here. The UI only renders streamed state and sends user-input steps and settings; the planner config the UI builds carries the agentic flag, autonomy policy and allow and deny lists.
- `extensions/antigravity/dist/extension.js` (2 MB) starts it, handles login, settings imports from VS Code, Cursor and Windsurf, and editor bridging. A persistent-server setting keeps it alive after the editor closes.
- The UI talks to it with generated protobuf and Connect stubs. Message and enum definitions are readable in `out/jetskiAgent/main.js`, which is the best static map of the protocol.
- Static limits: prompts, tool schemas, the heuristics for when artifacts are made, knowledge logic, quotas and cloud features sit in the Go binary or server and are not recoverable by reading the JS. Decompiling a stripped 130 MB Go binary is out of scope.

## 6. Recommendations for Lonca

**Copy (behavior)**
1. One conversation list with a first-class "needs attention" state from a single rule (a step waits on a human), ordered waiting, running, idle. This is the core of the mission-control feel.
2. Approve and deny inline on the list row, so blocked agents clear without opening them.
3. Queue messages mid-run and deliver at the next safe break; stop at both job and sub-task level.
4. Review comments as structured data (target, selection, text, approve or changes-requested) attached to the next message, not pasted text. For Lonca: the same on a /todo card or a /goal step plan.
5. A few presets instead of many knobs, project-level overrides, deny-beats-allow lists, a visible warning on full autonomy.
6. Per-task worktrees with a merge-back check before closing.
7. A plan, then proceed gate (plan artifact plus "proceed with N comments") maps directly onto /goal.
8. Keyboard-first list (mark read, archive, next and previous).

**Do better**
- Be agent-agnostic: map Claude, Codex and Gemini states onto one idle, running, waiting model and show CLI, model and real usage per job.
- Team features: who owns or steers each job, shared comments, an activity feed (Antigravity is single-user).
- Keep artifacts and rules as plain files in the repo, diffable and shareable, not in a hidden per-user folder.
- Use an append-only event log per job instead of a bespoke RPC; it makes live view, reconnect and the phone companion simple.
- Explain approval decisions (which list entry, preset or sandbox allowed it).
- Push "needs attention" to the phone from day one.

**Avoid**
- A closed core with decisions out of sight.
- Overlapping policy settings with near-identical names; use one autonomy ladder per tool category with the same labels.
- A review setting that lets injected artifact text skip review; treat artifact text as untrusted.
- Allow-list matching rules that differ per shell; choose one documented rule.

## Not determinable statically
When and why the agent creates each artifact; prompt text; knowledge scoring; the model catalog and quotas; what remote control and website conversation management do; notification roll-up; how comments become prompt text.
