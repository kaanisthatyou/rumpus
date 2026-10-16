# Hermes Agent and Jan: what Lonca can learn

Read on 2026-10-16 from shallow clones. Hermes Agent (`NousResearch/hermes-agent`) at commit `788f95786dd598efe4bfb8ee98e993f60df471e1`. Jan (`janhq/jan`) at commit `a86d87ebcfb7eb542dbc548cd3a5936b4650c3c6`. Nothing was run or built; all repo contents were treated as data. Paths below are relative to each repo ("hermes:" or "jan:").

## 1. Hermes: memory and context

**What is stored.** There are four layers.

1. Curated notes in two small Markdown files, `MEMORY.md` (the agent's own notes) and `USER.md` (user profile). They live under the profile's `memories/` folder. Entries are separated by a `§` line, and each file has a character budget (defaults 2200 and 1375 chars, roughly 800 and 500 tokens). Source: hermes: `tools/memory_tool.py`, `tools/memory_tool_store.py`, `cli-config.yaml.example` (`memory:` block).
2. Episodic history: every session and message goes into one SQLite file `state.db` (WAL mode, FTS5 full-text index, sessions chained through `parent_session_id` when compaction splits them). Source: hermes: `hermes_state.py`.
3. Procedural memory: skills the agent writes itself as `<skills>/[category/]<skill>/SKILL.md` plus optional `references/`, `templates/`, `scripts/`. Source: hermes: `tools/skill_manager_tool.py`.
4. Optional external memory plugins (Honcho, Hindsight and others, listed in `plugin-catalog/*.yaml`; examples in `plugins/memory/`). Only one external provider may be active at a time; the built-in store is always on. Source: hermes: `agent/memory_manager.py`, `agent/memory_provider.py`.

**Creation.**
- The model calls a single `memory` tool (add, patch, remove, or a batch). Entries are scanned for prompt-injection and exfiltration patterns before saving, because they enter the system prompt (`tools/memory_tool_store.py`, `_scan_memory_content`).
- A periodic nudge reminds the agent to save something every N user turns (`nudge_interval: 10`).
- After a turn, a forked agent copy can review the conversation in a background thread and decide whether a memory or skill should be saved. It shares the parent's prompt cache and runs with a tool whitelist (`agent/background_review.py`).

**Recall and ranking.**
- The curated files are injected as a frozen snapshot at session start. Writes during the session hit disk but do not change the prompt, which keeps the provider's prefix cache valid (`tools/memory_tool.py` docstring).
- Long-term recall of past chats is a `session_search` tool: FTS5/BM25 search deduplicated by session lineage, then scroll or read modes. It makes no LLM call and returns real stored messages. Cron-job sessions are demoted so scheduled output does not drown the user's own chats (`tools/session_search_tool.py`).
- External providers implement `prefetch`, `sync_turn`, `handle_tool_call` and `on_pre_compress`. A regex skips recall for trivial prompts such as "ok" or "thanks" (`agent/memory_provider.py`).

**Pruning.** The curated files are bounded by the char limits, so the agent has to consolidate. A background "curator" runs when the agent is idle and the last run is old enough. It may pin, archive, consolidate or patch skills, never deletes (archive only), and skips pinned skills (`agent/curator.py`).

**Context compaction** (`agent/context_compressor.py`, defaults in `hermes_cli/config_defaults.py`, key `compression`):
- Triggered when usage passes a ratio of the window (`threshold: 0.50`, floored at 0.75 for windows under 512K). Optional absolute token cap.
- A cheap auxiliary model summarizes the middle; head and tail are protected. Old tool outputs are pruned first, without an LLM. Summaries are iterative.
- `tail_mode: lean` keeps a small verbatim tail (about 2.5% of the window), keeps at least one real user message, and puts pointers to `session_search` in the summary so detail can be fetched back.
- `checkpoint_required` can block lossy compaction until a memory provider confirms it saved a checkpoint first.
- Chat gateways stay silent about routine compaction unless `progress_notices` is on.

**What the user sees and edits.** The notes are plain Markdown files, so they can be edited by hand. There is also a `/memory` command, a desktop Settings > Memory pane (`apps/desktop/src/app/settings/memory`), and a "learning graph" view that shows skills and memory chunks as linked nodes (`agent/learning_graph.py`).

## 2. Hermes: voice

**STT** (`tools/transcription_tools.py`, config block `stt:` in `cli-config.yaml.example`). Providers: local faster-whisper (default, with Silero VAD and an idle-unload timer), a local command, Groq, OpenAI, Mistral (Voxtral), xAI, ElevenLabs, DeepInfra. Cloud uploads get an ffmpeg silence trim first to cut cost and Whisper hallucinations. An optional vocabulary prompt is forwarded to Whisper-family backends.

**TTS** (`tools/tts_tool*.py`, `tts_streaming.py`). Providers named in the config comment: edge (default), openai, xai, minimax, mistral, gemini, elevenlabs, neutts, kittentts, piper, deepinfra. Streaming providers turn sentences into PCM chunks so playback starts on sentence one; providers without a chunked API play per sentence.

**Plugging in an external or custom voice model.** Two ways, both config-driven:
- Command providers, in both directions. Shape: `stt.providers.<name>: {type: command, command: "custom-asr --input {input_path} --output {output_path}", normalize: true}` and `tts.providers.<name>: {type: command, command: "piper -f {output_path} < {input_path}"}`. TTS placeholders: `{input_path}`, `{output_path}`, `{format}`, `{voice}`, `{model}`, `{speed}`. Placeholders are shell-quoted for their quote context; built-in names win over a same-named entry (`tools/tts_command_provider.py`).
- Plugin providers that subclass a `TTSProvider` or STT provider base and register themselves (`agent/tts_provider.py`, `agent/transcription_provider.py`).

**Modes.** The `voice:` block (`hermes_cli/config_defaults.py`): `voice_chat_mode: chained` (STT, then agent turn, then TTS) or `gpt-live` (one full-duplex model over WebRTC that delegates real work to the agent; see `tools/voice_live.py`). `record_key: ctrl+b` is push-to-talk in the terminal; silence-based auto-stop (`silence_threshold`, `silence_duration: 3.0`), `max_recording_seconds: 120`, optional `auto_tts`, and an optional "Hey Hermes" wake word for hands-free use.

**Barge-in.** `barge_in: true` runs a side monitor during playback with a rolling noise-floor VAD: speech trigger is the quiet-room floor times `barge_in_threshold_multiplier: 3.0`, ignored for the first 0.5 s after TTS starts to avoid self-triggering. Saying exactly a stop phrase (`["stop"]`) ends the voice chat (`tools/voice_mode.py`, around line 1140).

## 3. Hermes: shortcuts, gateways, scheduling

**Desktop shortcuts** (defaults, `mod` = Ctrl or Cmd; hermes: `apps/desktop/src/lib/keybinds/actions.ts`). All are user-rebindable, with a settings panel and a plugin API for adding actions.
- Composer: focus `/` or Enter, model picker `mod+shift+m`, voice `mod+alt+v` (Ctrl+B on Mac), send Enter, newline Shift+Enter, queue `mod+enter`, cancel Esc.
- Sessions: new `mod+n`, new tab `mod+t`, new window `mod+shift+n`, next/prev `ctrl+tab` / `ctrl+shift+tab`, search `mod+shift+f`, close tab `mod+w`, reopen `mod+shift+t`.
- Navigation and view: command palette `mod+k` or `mod+p`, settings `mod+,`, sidebar `mod+b`, right sidebar `mod+j`, terminal `ctrl+\``, find `mod+f`, shortcut panel `mod+/`, profile switching `mod+shift+[` and `]`.

**Gateways.** One shared base adapter (`gateway/platforms/base.py`, how-to in `gateway/platforms/ADDING_A_PLATFORM.md`) with adapters for Telegram, Discord, Slack, Matrix, Mattermost, WhatsApp, Signal, Email, SMS, Teams, Feishu, DingTalk, IRC and more (`plugins/platforms/*`, `gateway/platforms/*`), plus an OpenAI-compatible API server and webhooks. Sessions persist across inactivity. Voice messages arriving on chat platforms go through the same STT.

**Scheduled and autonomous work.** `cron/jobs.py` stores jobs in `~/.hermes/cron/jobs.json` with output in `cron/output/<job>/<timestamp>.md`; the scheduler lives in `cron/scheduler*.py` and delivers results back to chat platforms. This matters for Lonca: scheduled advisor reviews posted into the team chat is the same pattern.

## 4. Jan: providers

- Presets are a static array in jan: `web-app/src/constants/providers.ts` (OpenAI, Azure, Anthropic, OpenRouter, Mistral, Groq, xAI, Gemini through its OpenAI-compatible endpoint, MiniMax, Hugging Face router, NVIDIA NIM at `integrate.api.nvidia.com/v1`). DeepSeek is not a preset; it can be added as a custom provider. Each ships with `base_url`, `explore_models_url` and a settings array.
- Config shape (jan: `web-app/src/types/modelProviders.d.ts`, `ProviderObject`): `active`, `provider` (name), `base_url`, `api_key`, `api_key_fallbacks` (used after a 401/403/429), `custom_header[]`, `api_type` (`openai` or `anthropic`), `explore_models_url`, `settings[]` (typed controls: input, checkbox, dropdown, slider), `models[]`, `persist`. A model carries `id`, `displayName`, `capabilities[]`, `embedding`, `imported`.
- Model list fetch: `GET {base_url}/models` with `Authorization: Bearer` and `x-api-key`, then custom headers; it accepts `{data:[{id}]}`, a bare array, or `{models:[...]}`, rotates through the key chain, and gives separate errors for 401, 403 and 404 (jan: `web-app/src/services/providers/tauri.ts`, `fetchModelsFromProvider`).
- Custom OpenAI-compatible providers are the same object with a user-chosen name and URL.
- Key storage: keys live only in the OS keyring (Rust `keyring` crate). If no keyring exists (headless Linux), they fall back to an AES-256-GCM encrypted file `provider_secrets.enc` with mode 0600, key derived from a machine id (jan: `src-tauri/src/core/server/provider_secrets.rs`). The web store strips keys before persisting (jan: `web-app/src/hooks/useModelProvider.ts`).
- Local engine: llama.cpp is driven by a Tauri plugin (`src-tauri/plugins/tauri-plugin-llamacpp`) and an extension (`extensions/llamacpp-extension`). Each model has a `model.yml`; a generated `router.preset.ini` holds only values that differ from llama.cpp defaults (jan: `extensions/llamacpp-extension/src/preset.ts`). There is also an MLX plugin. Jan exposes a local OpenAI-compatible server (default port 1337, jan: `web-app/src/hooks/useLocalApiServer.ts`).

## 5. Jan: assistants, threads, MCP, shortcuts, stack

- **Assistants.** `{id, name, avatar, description, instructions, parameters, created_at}` (jan: `web-app/src/types/threads.d.ts`). It is a system prompt plus sampling parameters, switchable from the chat box.
- **Threads and projects.** A thread has title, favorite flag, model, order and metadata with an optional project link. Storage is plain files: `thread.json` plus an append-only `messages.jsonl` per thread (jan: `src-tauri/src/core/threads/commands.rs`). Projects are folders that can pin a default assistant (`ThreadFolder.assistantId`, jan: `web-app/src/services/projects/types.ts`).
- **MCP.** Stored as a map `mcpServers: {name: {command, args, env, active, type: stdio|http|sse, url, headers, timeout, capabilities[], description}}`, plus global settings: tool timeout 30 s, restart backoff 1 s up to 30 s with multiplier 2, optional "smart tool routing" using a small router model, and a 40,000-char cap on each tool result (jan: `web-app/src/hooks/useMCPServers.ts`). A per-tool approval flow exists (`useToolApproval.ts`).
- **Shortcuts** (jan: `web-app/src/lib/shortcuts/const.ts`), all `mod`+: sidebar `b`, new chat `n`, new agent chat `m`, new project `p`, settings `,`, search `k`, switch assistant `j`, zoom `+` / `-`. Enter sends, Shift+Enter inserts a newline. The settings page lists them but they are fixed, not rebindable.
- **Claude Code integration.** Jan's Settings > Claude Code page starts its local server and writes environment variables so the `claude` CLI talks to a Jan-hosted model (`launch_claude_code_with_config`, jan: `web-app/src/routes/settings/claude-code.tsx`). Custom CLIs and env vars can be added. The idea is close to Lonca's "drive the CLI the user already has".
- **No voice and no long-term memory** were found in Jan. Its context handling is a one-shot summarizer that compacts old messages (about 500 words, jan: `web-app/src/lib/context-manager.ts`).
- **Stack.** Tauri 2 (Rust backend, `src-tauri/Cargo.toml`, v0.8.5) with a React web app in `web-app/` (TanStack Router, zustand). Windows bundles are NSIS and MSI; Linux bundles are deb and AppImage, with a Flatpak folder. Bundled helper binaries include `jan-llama-worker`, `uv` and `bun` (jan: `src-tauri/tauri.windows.conf.json`, `tauri.linux.conf.json`). The same codebase also targets Android and iOS (`tauri.android.conf.json`, `tauri.ios.conf.json`), which is relevant to a phone companion.

## 6. Licenses

- **Hermes Agent: MIT**, copyright 2025 Nous Research (hermes: `LICENSE`, `pyproject.toml`). MIT code may be copied into an Apache-2.0 project as long as the MIT copyright notice and permission text are kept with the copied parts. It is Python, so direct reuse is unlikely in a TypeScript app anyway; ideas and config shapes are free to use.
- **Jan: Apache-2.0**, copyright 2025 Menlo Research, with an added sentence "Attribution is requested in user-facing documentation" (jan: `LICENSE`). Code may be reused under Apache-2.0 with the usual obligations: keep the license and notices, mark changes. The attribution line is a request, not a condition, but we should honor it. Since Jan is TypeScript, parts of its web app (for example the provider presets, the model-list parser, MCP types) are directly portable. Verify every file's own header and any third-party notices before copying, and note that a UI component library is bundled in `web-app/src/components/ui`.
- This is a reading of the licenses, not legal advice.

## 7. For Lonca

**Copy (behavior).**
- Hermes: small bounded Markdown memory (profile plus notes) that a human can open and edit; a frozen snapshot at session start; full-text search of past chats as a tool, no LLM needed; compaction with a cheap model, protected tail and a pointer back to search; an injection scan on anything written to memory.
- Hermes: command-template voice providers (`{input_path}`, `{output_path}`) as the "plug in any voice model" answer; push-to-talk default; barge-in with a calibrated noise floor and a grace period; sentence-level streaming TTS; cloud silence trimming.
- Hermes: scheduled jobs that post into chat; one base class per chat platform.
- Jan: provider objects with a key chain and fallback on 401/403/429; the tolerant `/models` parser; OS keyring with an encrypted-file fallback; keys never in the persisted settings store; per-thread files (`thread.json` plus `messages.jsonl`); MCP server map and its restart/timeout settings; launching a CLI with a prepared environment.

**Do better.**
- Make shortcuts rebindable with a conflict checker (Hermes does, Jan does not), and show them in one searchable panel.
- Advisors are read-only by design. Give them a separate, explicit memory space per bot so a "Critical" bot's notes never leak into a "Positive" one, and cap how much the bots may talk to each other (cost and loop limits).
- Run advisor chatter on cheap or free providers by default; Hermes spends tokens on background review and a curator, so show spend per bot in the UI.
- Show a clear "what was recalled" indicator and an edit/delete screen for every memory, with a visible source (which chat, which date).
- Keep the Windows story simple: Hermes is Python plus shell tools and heavy to ship; Jan ships big native sidecars. Lonca can stay light by driving existing CLIs and calling HTTP APIs.

**Avoid.**
- Hermes's sheer breadth (thousands of files, many adapters, per-provider special cases) and a 5,800-line compressor; build a small core with plugin points.
- Allowing the agent to rewrite its own prompt-visible memory without limits or scanning.
- Jan's keys in a store that is re-seeded into the webview at boot (a hardening gap even though disk copies are stripped); keep secrets in the main process and hand the renderer only masked values.
- Always-on wake word and full-duplex voice in version one; they need hardware tuning and add privacy risk.
