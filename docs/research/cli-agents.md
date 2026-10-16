# Driving CLI agents from Lonca: research (2026-10-16)

Scope: which agent CLIs Lonca should drive headless, how, whether ACP should be the integration layer, and what the terms of service allow. Sources are official docs and repos read on 2026-10-16. "(unverified)" marks things I could not confirm from a primary source; test them on a real install first.

## 0. What Fabrika already proves (Claude Code only)

From `app/backend/claude_session.py` (one long-lived process per agent):

- Spawn: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --strict-mcp-config [--mcp-config f] --append-system-prompt ... [--resume <id>] [--model m]`. One JSON user message per stdin line; a message sent mid-turn is the steer.
- Token-free auth check: `claude auth status --json` (`loggedIn`, `subscriptionType`). An expired login also shows as an `assistant` event with error `authentication_failed`.
- Quota: the stream carries `rate_limit_event` with `rate_limit_info.unifiedWindows.{five_hour,seven_day}` (`utilization` 0..1, `resetsAt`) and `status`. A cheap probe (`-p ok --model haiku --tools ""`) costs about $0.0001.
- Stop: `taskkill /PID <pid> /T /F`; the next message respawns with `--resume`. Several logins via `CLAUDE_CONFIG_DIR`.

## 1. Per-CLI findings (versions = npm, 2026-10-16)

### 1.1 Claude Code 2.1.301 - v1, tier 1
- Install/detect: native installer (`claude` / `claude.exe`, user-level `~/.local/bin`) or npm `@anthropic-ai/claude-code` (shim in `%APPDATA%\npm`). PATH lookup plus `claude --version`.
- Login: `claude auth status --json`; `ANTHROPIC_API_KEY` for API mode; `--bare` ignores OAuth/keychain.
- Headless: `-p`, `--output-format text|json|stream-json`, `--json-schema`, `--max-budget-usd`, `--no-session-persistence`, `--session-id`, `--fork-session`.
- Events: `system/init` (session_id, model, tools, `mcp_servers`, `mcp_server_errors`, `capabilities[]`), `stream_event` (deltas), `assistant` (text and `tool_use` blocks), `user` (`tool_result` blocks), `system/api_retry`, `rate_limit_event`, `result` (text, `total_cost_usd`, `usage`, `permission_denials`). `parent_tool_use_id` marks subagent messages. Mapping: text = assistant/stream_event, tool call = tool_use, tool result = tool_result, usage = result + rate_limit_event, end = result.
- Resume: `--resume <id|path.jsonl>`, `--continue`.
- Steering: yes. Streaming input queues user messages mid-turn; an `interrupt` control request stops the turn (feature-detect via init `capabilities`: `interrupt_receipt_v1`, `interrupt_cancel_queued_v1`). [Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode), [TS reference](https://code.claude.com/docs/en/agent-sdk/typescript).
- Permissions: `--permission-mode plan|acceptEdits|auto|dontAsk|bypassPermissions`, `--allowedTools`, `--permission-prompts none`. Map: read = `plan`, edit = `acceptEdits`, full = `bypassPermissions`.
- MCP for one run: `--mcp-config <json|file> --strict-mcp-config`; add `--setting-sources ""` to skip settings. Bad entries show in `mcp_server_errors`.
- Model: `--model`, `--effort`, `--fallback-model`.
- Cancel: SIGTERM exits 143 with no result recorded; SIGINT or the interrupt request ends the turn properly ([headless](https://code.claude.com/docs/en/headless)). On Windows: interrupt request, close stdin, then `taskkill /T /F`.

### 1.2 OpenAI Codex CLI 0.163.0 (Apache-2.0) - v1, tier 1
- Install/detect: `npm i -g @openai/codex` (bin `codex`), `install.ps1` / `install.sh`, brew, release binary ([repo](https://github.com/openai/codex)).
- Login: `codex login status`; credentials in `$CODEX_HOME/auth.json` (default `~/.codex`) or OS keyring; `CODEX_API_KEY` per run; `codex login --device-auth` ([auth](https://learn.chatgpt.com/docs/auth)).
- Headless: `codex exec "<prompt>" --json` gives JSONL ([docs](https://learn.chatgpt.com/docs/non-interactive-mode)): `thread.started{thread_id}`, `turn.started`, `item.started|completed{item:{id,type,command,status,text}}` (types: agent message, reasoning, command execution, file change, MCP tool call, web search, plan update), `turn.completed{usage:{input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens}}`, `turn.failed`, `error`. Mapping: text = agent_message item, tool call = item.started, result = item.completed, usage = turn.completed, end = turn.completed/failed. Also `--output-schema`, `-o`, `--ephemeral`; needs a git repo or `--skip-git-repo-check`.
- Resume: `codex exec resume --last|<SESSION_ID> "<prompt>"`.
- Steering: not in `exec` (one prompt per process). `codex app-server` (JSON-RPC over stdio) has `turn/start`, `turn/steer`, `turn/interrupt`, `item/*` deltas, and per-thread `model/cwd/approvalPolicy/sandbox`; its page calls it experimental, not supported for production, and recommends the SDK for automation ([app-server](https://learn.chatgpt.com/docs/app-server)). Plan: `exec --json` first, an app-server driver later behind the same interface.
- Sandbox: `--sandbox read-only` (default) | `workspace-write` | `danger-full-access` = read / edit / full. `--full-auto` was removed. `--ignore-user-config`, `--ignore-rules` skip user config.
- MCP per run: config keys `mcp_servers.<name>.*`; `-c key=value` dotted overrides work for scalars (array quoting unverified). Safest: a temp `CODEX_HOME` with a generated `config.toml` plus the user's `auth.json` copied on the same machine. A required MCP server that fails makes `exec` exit with an error.
- Usage: per-turn token counts; plan-limit read exists in app-server (`account/rateLimits/read`, from memory, unverified).
- Cancel: kill the process tree; no documented graceful signal for `exec`.

### 1.3 Gemini CLI 0.64.0 (Apache-2.0) and Antigravity CLI `agy` - v1 only with API key or Vertex
The Gemini CLI README and FAQ say: "Gemini CLI was replaced by Antigravity CLI on June 18th, 2026" for unpaid-tier and Google One users ([README](https://github.com/google-gemini/gemini-cli), [FAQ](https://geminicli.com/docs/resources/faq/)). Secondary coverage says Pro/Ultra/free Code Assist stopped working in Gemini CLI that day while API key, Vertex and paid Code Assist licenses continue (official pages are vague; unverified).
- Gemini CLI (bin `gemini`): `-p`, `--output-format json|stream-json` ([headless](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md)); events `init`, `message`, `tool_use`, `tool_result`, `error`, `result` (stats, per-model tokens); field names undocumented. Exit codes 0, 1, 42 (input), 53 (turn limit). `--approval-mode default|auto_edit|plan|yolo` (read = plan, edit = auto_edit, full = yolo), `-s` sandbox. MCP: `mcpServers` in settings.json (system file path overridable with `GEMINI_CLI_SYSTEM_SETTINGS_PATH`, user root with `GEMINI_CLI_HOME`), `--allowed-mcp-server-names` filter. Model `-m`. Auth env `GEMINI_API_KEY`, Vertex vars. No documented login-status command or stdin steering (unverified).
- `agy` ([headless doc](https://antigravity.google/docs/cli/headless/)): `irm https://antigravity.google/cli/install.ps1 | iex`; Windows `%LOCALAPPDATA%\agy\bin`, Linux `~/.local/bin/agy`. `agy -p`, `--output-format text|json|stream-json`, `--input-format stream-json` (one `{"event":"user","message":{"content":...}}` per line, each prompt yields its own `result`, close stdin to end), `--json-schema`, `--model`, `--effort`, `--continue`, `--conversation <id>`, `--dangerously-skip-permissions`, `--sandbox`. Events: `init`, `step_update` (ACTIVE/DONE, `tool_info`, `subagent_info`, text deltas), `result` (`conversation_id`, `status`, `usage`, `num_turns`). Without allow rules in `~/.gemini/antigravity-cli/settings.json` tools are soft-denied. MCP for headless and ACP support not confirmed. Closed source.

### 1.4 OpenCode 1.19.2 (MIT) - v1, tier 2
Bin `opencode` (npm `opencode-ai` ships `opencode.exe`). `opencode run "<prompt>" --format json`, `-c`, `-s <id>`, `--fork`, `-m provider/model`, `--auto`, `--attach` to a running `opencode serve` (HTTP, `OPENCODE_SERVER_PASSWORD`), `opencode acp`. Login check `opencode auth list`. Per-run config without touching global: `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT` (inline JSON), `OPENCODE_PERMISSION` (inline JSON). [CLI docs](https://opencode.ai/docs/cli/). Event schema not captured.

### 1.5 Qwen Code 0.25.2 - tier 2
Bin `qwen`. `-p`, `--output-format json|stream-json`, `--input-format stream-json` (documented as under construction), `--approval-mode plan|default|auto-edit|auto|yolo`, `--continue/--resume`, run budgets (`--max-wall-time` etc., exit 55/53, SIGINT 130), and a native `/goal` that emits `goal_state` events ([headless](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/headless.md)). Listed as ACP-capable. Useful reference for Lonca's own /goal mode.

### 1.6 GitHub Copilot CLI 1.0.98 (proprietary) - tier 2 via ACP
Bin `copilot` (npm `@github/copilot`, brew, WinGet; Windows needs PowerShell 6+). `copilot login` or env `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` (fine-grained PAT with "Copilot Requests"; classic `ghp_` unsupported). `--acp` and `--continue` exist ([reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)); `-p`, JSON output and permission flags not confirmed. ACP list marks it public preview.

### 1.7 Cursor CLI - tier 2 via ACP
Bin `agent` (`irm 'https://cursor.com/install?win32=true' | iex`). `agent -p`, `--output-format json|stream-json`, `--stream-partial-output`; events `system/init`, `assistant`, `tool_call{started,completed}`, `result`; `--force` allows writes; auth `agent login` or `CURSOR_API_KEY` ([headless](https://cursor.com/docs/cli/headless)). `agent acp`: modes `agent|plan|ask`, `session/request_permission`, extension methods `cursor/ask_question`, `cursor/create_plan`; MCP only from `.cursor/mcp.json`, so per-session injection is limited ([ACP](https://cursor.com/docs/cli/acp)).

### 1.8 Amp, Kimi - not v1
Amp (`@sourcegraph/amp`, proprietary, bin `amp`) has execute and streaming-JSON modes but I could not read those pages; own sign-in and credit model. Kimi: the Python Kimi CLI repo is archived, replaced by "Kimi Code CLI" (`kimi acp`, `--mcp-config-file`) ([repo](https://github.com/MoonshotAI/kimi-cli)). Both reachable later via the generic ACP driver.

### 1.9 Comparison

| CLI | Bin | Login check (no tokens) | Stream | Mid-turn steer | read / edit / full | Per-run MCP | Quota info |
|---|---|---|---|---|---|---|---|
| Claude Code | `claude` | `claude auth status --json` | stream-json (rich) | yes, stdin + interrupt | plan / acceptEdits / bypassPermissions | `--mcp-config --strict-mcp-config` | rate_limit_event windows, cost |
| Codex | `codex` | `codex login status` | `exec --json` | app-server only | read-only / workspace-write / danger-full-access | temp `CODEX_HOME` or `-c` | token usage per turn |
| Gemini CLI | `gemini` | none documented | stream-json | unverified | plan / auto_edit / yolo | settings.json + path env | token stats in result |
| Antigravity | `agy` | unknown | stream-json | stdin, new turn per line | rules / rules / skip flag | undocumented | `usage` in result |
| OpenCode | `opencode` | `opencode auth list` | `run --format json`, serve, acp | via serve/ACP | `OPENCODE_PERMISSION` | `OPENCODE_CONFIG_CONTENT` | provider dependent |
| Qwen Code | `qwen` | docs link only | stream-json | input mode WIP | plan / auto-edit / yolo | not captured | unverified |
| Copilot CLI | `copilot` | token env / login | ACP | ACP | unverified | ACP `mcpServers` | unverified |
| Cursor | `agent` | `agent login` / key | stream-json, ACP | ACP | agent / plan / ask | `.cursor/mcp.json` only | unverified |

Windows notes for all: npm-installed CLIs are `.cmd` shims and Node refuses to spawn `.cmd` without a shell, so resolve the real executable; `child.kill()` leaves grandchildren, so use `taskkill /PID n /T /F`; send prompts on stdin or a file, never through `cmd` quoting; set `windowsHide`.

## 2. ACP (Agent Client Protocol)

- Status: open, Apache-2.0, `agentclientprotocol` GitHub org (started by Zed). Stable schema v1.26.0 (2026-10-16); v2 is a public alpha (`2.0.0-alpha.9`). Very fast churn: stable schema releases weekly in October ([releases](https://github.com/agentclientprotocol/agent-client-protocol/releases)).
- TypeScript SDK: `@agentclientprotocol/sdk` 1.8.0 (2026-10-09, Apache-2.0); v2 under `/experimental/v2` ([repo](https://github.com/agentclientprotocol/typescript-sdk)).
- Wire: JSON-RPC 2.0, nd-JSON over stdio. `initialize` (capabilities), `authenticate`, `session/new{cwd, mcpServers}`, `session/load` (replays history), `session/resume`, `session/list`, `session/close`, `session/prompt` (ends with stop reason `end_turn|max_tokens|max_turn_requests|refusal|cancelled`), `session/cancel`, agent-to-client `session/request_permission`, `fs/*`, `terminal/*`. Updates: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `current_mode_update`, `usage_update{used,size,cost?}`, `session_info_update`, plus notices and compaction (stable 2026-10-09). Per-session MCP: stdio required, http and sse by capability ([session setup](https://agentclientprotocol.com/protocol/session-setup), [prompt turn](https://agentclientprotocol.com/protocol/prompt-turn)).
- Gaps for Lonca: no steering or queued prompt in v1 (the v2 alpha mentions "prompt insertion"; not examined in depth); `usage_update` is context fill plus optional cost, not subscription quota windows (RFDs `session-usage`, `end-turn-token-usage`, `get-auth-state` are drafts); no side-effect-free login check (auth is an agent-defined `authenticate` call); read/edit/full has no standard mapping, only agent-defined modes; agents implement different capability subsets.
- Who speaks it ([agent list](https://agentclientprotocol.com/get-started/agents)): listed without an adapter: Gemini CLI, OpenCode, Qwen Code, Copilot CLI (preview), Cursor, Kimi, Goose, Cline, Factory Droid, Augment, Mistral Vibe, OpenHands, Junie, Kiro, Qoder, many more. Via adapter: Claude and Codex.
- Adapters: Claude `@agentclientprotocol/claude-agent-acp` 0.91.0 (2026-10-15, Apache-2.0, wraps the Claude Agent SDK; successor of `@zed-industries/claude-code-acp` 0.16.2, 2026-03). Codex `@agentclientprotocol/codex-acp` 2.2.2 (2026-10-15, Apache-2.0; successor of `@zed-industries/codex-acp` 0.16.0, 2026-06). Both actively maintained.

### Recommendation
Do not make ACP the single layer. Define Lonca's own small `AgentDriver` interface (start, send, steer, interrupt, stop, status, quota, normalized events: text / tool_call / tool_result / usage / end, plus a capability map). Then:
1. Direct drivers for Claude Code (stream-json, Fabrika-proven, steer, quota windows, interrupt receipts) and Codex (`exec --json`, app-server later for steer). Lonca's headline features (steer, quota bar, permission modes, per-run MCP) depend on exactly what ACP lacks or adapters hide.
2. A generic ACP driver as the breadth layer for OpenCode, Qwen, Copilot, Cursor, Kimi, Gemini and future agents, with unsupported features shown as unavailable through the capability map.
3. The Claude/Codex ACP adapters only as optional fallbacks. For Claude they add a Node layer and route through the Agent SDK, which matters for ToS (section 3).

So: direct-CLI first for the two big agents, ACP as the long-tail layer. Re-check when ACP v2 stabilises.

### v1 CLI list
Claude Code, Codex CLI, OpenCode, plus Gemini CLI / Antigravity only on API key or Vertex auth. Qwen Code, Copilot CLI and Cursor CLI through the generic ACP driver as soon as it works (v1.x). Amp and Kimi later.

## 3. Terms of service (read 2026-10-16; 2026 saw several reversals)

### Anthropic
Primary: [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) (undated page, read 2026-10-16).
- Open door: "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code..."
- Conditions for products that run Claude Code: "The Claude Code binary must not be modified. Claude Code must be installed and run as published by Anthropic, and customers may not remove, disable, or restrict any authentication method built into it" and "Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf. Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential." That section says running Claude Code in your product "requires agreeing to our Commercial Terms of Service"; whether it applies to a user merely driving their own install is unclear.
- Forbidden: "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens - sign-in to a Claude account must complete through Anthropic's own flow." Also "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication", and "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."
- Naming: you "can't use the Claude Code or Anthropic names or logos as part of your own product ... name"; saying in plain text that it "runs Claude Code" is fine.
- Billing churn: [support article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) says (June 15, 2026 entry) "We've paused the previously-announced changes to Claude Agent SDK usage ... Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription limits", and an October 7, 2026 entry adds monthly API credits for Max and Team covering the Agent SDK and `claude -p`. [The Register, 2026-05-14](https://www.theregister.com/ai-ml/2026/05/14/anthropic-tosses-agents-into-the-api-billing-pool/5240748) reported the original plan for a separate programmatic credit pool. Unclear and moving: drive the quota bar from `rate_limit_event`, offer API-key mode.
- Enforcement history (secondary, Feb-Apr 2026): harnesses using subscription OAuth tokens were blocked. That targets token extraction, not spawning the official binary.
- Implication: spawn the user's own unmodified `claude`, let it use its own login, never read or copy `.credentials.json`, never run one person's login for someone else (each agent stays on its owner's machine, as designed), do not put "Claude Code" in the app name. The Agent SDK / `claude-agent-acp` route falls under the "Agent SDK should use API keys" sentence, a further reason for the direct driver (still gray: the SDK runs the same binary).

### OpenAI
- [Codex auth](https://learn.chatgpt.com/docs/auth): "Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs." "API keys are still the recommended default for automation." "Treat `~/.codex/auth.json` like a password." The [non-interactive page](https://learn.chatgpt.com/docs/non-interactive-mode) says `codex exec` reuses saved CLI authentication by default, and advises against ChatGPT-managed auth in CI for public/open-source repos.
- I found no OpenAI sentence forbidding a local app from spawning the user's own logged-in `codex`. Secondary reports (late September 2026) say OpenAI opened "Sign in with ChatGPT" to third-party tools (Amp, OpenClaw) with per-app weekly caps; I could not reach OpenAI's own post, so unverified. The Terms of Use clause against programmatic data extraction was seen only through a third-party quote; unverified.
- Implication: `codex exec` as the user is the documented headless path; never move `auth.json` across machines or people.

### Google
- Gemini CLI [FAQ](https://geminicli.com/docs/resources/faq/): "Using third-party software, tools, or services to harvest or piggyback on Gemini CLI's OAuth authentication" is "a direct violation of our applicable terms and policies" and "may be grounds for immediate suspension or termination of your account"; for third-party agents "the supported and secure method is to use a Vertex AI or Google AI Studio API key." The [ToS/privacy page](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md) repeats this with the example "using OpenClaw with Gemini CLI OAuth."
- Forum reports of 403 bans after OAuth reuse through OpenCode plugins exist (anecdotal).
- Unclear: whether spawning the official `gemini` / `agy` binary without touching tokens counts as "piggybacking". The text targets harvesting the OAuth session. Safe default: Google agents use API key or Vertex, with a warning on OAuth. Antigravity CLI terms: not found.

### Bottom line
Spawning the user's own installed, logged-in, unmodified official CLI on the user's own machine, with no credential handling by Lonca, is the pattern Anthropic's page leaves open and OpenAI documents (API key preferred for automation); Google's wording is the strictest, so default to API keys there. "Sign in with X" inside Lonca, token copying, or sharing one login across teammates is out with all three. Before wide distribution, ask each vendor for written confirmation and link their current policy in the app.
