# Lonca v2 platform research: connectors, voice, team networking

Date: 2026-10-16. Primary sources where I could fetch them. **(unverified)** marks claims from memory or aggregator pages; check before coding. Search returned mostly aggregators for voice and catalog terms, so A and C are stronger than B.

---

## A. Connector store

### A1. Catalogs

**Official MCP Registry** ([registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/docs), [repo](https://github.com/modelcontextprotocol/registry)).
- Preview since 2025-09-08; the v0.1 API was frozen on 2025-10-24 (no breaking changes until GA/v1). I could not confirm whether v1 shipped in 2026: pin to the `v0.1` paths and expect possible data resets (the README says so).
- Read API is a public REST list/search (`GET /v0.1/servers?search=...`, cursor paging) **(exact path unverified, see /docs)**. Publishing uses `mcp-publisher` with namespace proof: GitHub OAuth/OIDC (`io.github.user/name`) or DNS/HTTP challenge (`com.example/name`). The verified namespace is a usable trust signal.
- `server.json`: name, description, version, plus `packages[]` (npm, PyPI, NuGet, OCI, MCPB; runtime hint, arguments, declared env vars, some secret) and/or `remotes[]` (streamable-http or SSE URL, declared headers). Remotes are the one-click-friendly entries.
- Data license is not stated on the README; read the repo LICENSE before mirroring. Live queries with a few hours of cache are low risk.

**Others** (no embedding terms found; assume "link, do not mirror" until each is read):
- [Docker MCP Catalog](https://docs.docker.com/ai/mcp-catalog-and-toolkit/catalog.md): verified servers as images; needs Docker, so not a default.
- Glama: public directory API and per-server license tags; terms not found. Smithery and mcp.so: terms not found; Smithery is also a hosted gateway, so avoid routing users through it by default.

**MCPB** ([repo](https://github.com/modelcontextprotocol/mcpb), [Anthropic docs](https://claude.com/docs/connectors/building/mcpb)), formerly DXT: a zip with `manifest.json` (spec seen at v0.3) plus the server; type `node` (deps vendored), `binary`, or `uv`; `user_config` declares settings/secrets so the host builds the form. It is the closest thing to one-click for local servers. Node bundles can run on Electron's own Node (`ELECTRON_RUN_AS_NODE=1`), so no separate Node is needed for them.

### A2. Connecting in a desktop app

**Remote + OAuth.** Current spec: [MCP authorization 2026-07-28](https://modelcontextprotocol.io/specification/latest/basic/authorization). Client duties:
1. 401 with `WWW-Authenticate: resource_metadata=...`, read RFC 9728 protected-resource metadata, then authorization-server metadata (RFC 8414 and OIDC discovery).
2. Get a `client_id`: pre-registered, else **Client ID Metadata Document** (our HTTPS URL is the client_id; the AS fetches our JSON), else Dynamic Client Registration. CIMD is SHOULD; DCR is now deprecated but still common.
3. PKCE, `resource` (RFC 8707) on authorize and token requests, scopes from the challenge, and validate `iss` (RFC 9207) against the recorded issuer.
4. Bearer on every request; refresh tokens kept confidential.

Lonca must host one stable CIMD JSON (static page) listing its redirect URIs, keep a DCR fallback, and offer "paste client ID" as a last resort.

**Redirect in Electron:** use a **loopback** redirect (`http://127.0.0.1:<random port>/callback`, RFC 8252) and the system browser (`shell.openExternal`), never an embedded window. It needs no protocol registration on Windows or Linux. Some auth servers are strict about ports/schemes **(varies)**. A `lonca://` custom scheme needs `setAsDefaultProtocolClient`, `second-instance` handling and a `.desktop` MIME entry, and some servers refuse it; use it only as a fallback.

**Local stdio:** the spec says stdio servers take credentials from the environment, not OAuth. Most registry packages are `npx`/`uvx`. Recommendation: **do not bundle Node or uv.** Detect them on PATH; if missing, download pinned, checksum-verified portable copies into app data on demand (Node ~30 MB, uv ~15-20 MB **(approx)**). OCI entries show only when Docker is detected.

**Secrets:** [`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage). Windows uses DPAPI (protects from other users, not other apps of the same user). Linux uses libsecret or KWallet; with no secret store it returns backend `basic_text` (hardcoded password, effectively plaintext). Check `getSelectedStorageBackend()` at startup and warn, or require an app passphrase in that case. Store encrypted blobs in Lonca's own DB, one per connector.

### A3. One run, per CLI

Lonca owns the connection list and generates a per-run config so a run sees only the chosen connectors:
- **Claude Code:** `--mcp-config <file> --strict-mcp-config`; remote entries `{type:"http", url, headers}`. Lonca does OAuth itself, refreshes, writes the Bearer header into a temp file, deletes it after (Fabrika already uses `--strict-mcp-config`).
- **Codex:** servers are `[mcp_servers.<name>]` in `config.toml` ([overview](https://www.tembo.io/blog/codex-cli-mcp)). Per run: a throwaway `CODEX_HOME` with a generated config (copy the auth file), or `-c` overrides **(syntax unverified)**. Pass bearer tokens through env vars.
- **Gemini CLI:** `mcpServers` in `settings.json`; project `.gemini/settings.json` overrides user settings; `--allowed-mcp-server-names` filters ([docs](https://geminicli.com/docs/tools/mcp-server/)). Use a per-run working dir with generated settings.
- Fallback for CLIs that cannot be scoped: one local MCP proxy on 127.0.0.1 with a per-run token that fans out to the chosen servers (secrets never leave Lonca, one audit point). Not needed for v1.

### A4. Recommendation (v1)

- **Curated list** (~30 entries in a JSON file shipped with releases): each points at a registry `server.json` name and adds Lonca notes (icon, category, tested CLIs, secrets). Only these get "Verified by Lonca".
- **Registry search** (live, cached) shown as "Community, unreviewed" with namespace status and a warning that local servers run with the user's permissions.
- "One click" per type: remote no-auth = write entry; remote OAuth = browser, loopback callback; remote API key = one secret field; MCPB = download, hash check, `user_config` form; npx/uvx = runtime check (offer download), env form from `server.json`; every flow ends with a Test button (`initialize` + `tools/list`).
- Enable connectors per workspace/channel with a tool allow-list and an approval before first use. Defer: own registry mirror, MCP proxy, ratings.

---

## B. Voice

### B1. Options

**Local STT**
- **whisper.cpp** (MIT): best Windows+Linux fit. Models: tiny 75 MB, base 142 MB, small 466 MB, large-v3-turbo ~1.6 GB (quantized ~0.55-0.9 GB). Base/small run faster than real time on modern CPUs; turbo on CPU is near or below real time (one vendor-run figure: real-time factor ~4.3 on one thread, [AlphaNeural](https://app.alphaneural.io/models/mihuai/turkish-stt)). Ship as a **sidecar binary** (`whisper-server`/`whisper-cli`), not a node addon: no ABI rebuilds, crash isolation, swappable CUDA/Vulkan build. Turkish: supported; small is OK for dictation, large-v3(-turbo) clearly better; fine-tunes exist ([BuzzASR](https://huggingface.co/BuzzASR/turkish), self-reported 12.4% WER).
- **sherpa-onnx** (Apache-2.0): prebuilt addon and binaries for Windows/Linux; runs Whisper, Parakeet, Moonshine, streaming models; includes Silero VAD and TTS (Piper, Kokoro). Strong option if we want one runtime for STT+VAD+TTS.
- **Parakeet-tdt-0.6b-v3**: very fast on CPU but covers 25 European languages; Turkish does not appear to be among them **(check the model card)**. **Moonshine**: English, Spanish, Arabic, Chinese, Japanese, Korean, Ukrainian, Vietnamese ([summary](https://www.mintlify.com/moonshine-ai/moonshine/models/available-models)); no Turkish. Neither can be the default for a Turkish team.
- **transformers.js/WebGPU** in the renderer: no sidecar, but uneven WebGPU on Linux and a renderer-bound lifecycle. Not default.

**Cloud STT:** Groq (Whisper large-v3-turbo, OpenAI-compatible, fast), OpenAI, Deepgram, ElevenLabs Scribe; all fine for Turkish. Prices change; keep providers configurable.

**TTS**
- **Piper** (MIT; voices carry their own licenses): Turkish voices exist (dfki, fahrettin, fettah, [listing](https://tts.ai/voices/piper/?lang=tr), aggregator, confirm in the Piper voice repo). ~60 MB per medium voice, real time on CPU, quality is serviceable.
- **Kokoro** (Apache-2.0, 82M): great English, but languages are English, Japanese, Chinese, French, Italian, Portuguese, Spanish, Hindi ([aggregator](https://tts.ai/voices/kokoro/?lang=tr)); no Turkish. Optional English voice.
- **Cloud TTS:** ElevenLabs (best quality, WebSocket streaming), OpenAI, Gemini; all handle Turkish.

**OpenAI-compatible endpoints** are the common plug: `POST /v1/audio/transcriptions` (multipart `file`, `model`, `language`) and `POST /v1/audio/speech` (JSON `model`, `input`, `voice`, `response_format`, streamed audio back). Groq, speaches/faster-whisper-server, LocalAI, whisper.cpp's server and Kokoro-FastAPI speak it **(unverified per project)**. One "Custom voice server" setting (base URL, key, model, voice) lets users bring their own; Lonca's own local engines sit behind the same internal interface.

### B2. Electron mechanics

- **Hotkey:** `globalShortcut` fires on press only (no key-up), so default to **toggle** (press to start, press to stop). True hold-to-talk needs a native key hook such as `uiohook-napi` **(unverified)**. Wayland restricts global shortcuts and key hooks (an XDG portal is the proper route **(Electron support unverified)**), so also offer an in-window button/key that needs no global hook.
- **Capture:** `getUserMedia` + AudioWorklet to 16 kHz mono PCM; enable echo cancellation while TTS plays.
- **VAD:** Silero VAD (MIT, ~2 MB ONNX) via sherpa-onnx or `@ricky0123/vad-web`: auto-stop in toggle mode, trim silence before Whisper (less hallucination), barge-in to cut TTS.
- **Playback:** ask cloud TTS for `pcm`/`opus` streaming and play from the first chunk through an AudioWorklet; for local TTS synthesize per sentence and queue.
- Whisper is not truly streaming; live captions need chunking with overlap and are optional. Transcribe-on-release is enough for v1.

### B3. Recommendation

- **In the installer:** Silero VAD model (~2 MB) and the voice client code only.
- **On demand (size shown at first use):** whisper.cpp sidecar (~5-15 MB) with **`small` multilingual quantized as default model** (~250-470 MB) and `large-v3-turbo` quantized as the upgrade for GPU/many cores; Piper (or sherpa-onnx) plus a Turkish voice (~60 MB) and an English voice.
- **Optional:** Groq Whisper and ElevenLabs/OpenAI TTS (keys in safeStorage); custom OpenAI-compatible server. Engine order: custom, chosen cloud, local.
- Default hotkey: toggle. Avoid Parakeet/Moonshine/Kokoro as Turkish defaults and node-addon Whisper.

---

## C. Team networking

### C1. What Fabrika does today (`team.py`, `web.py`)

- **Team link:** each app listens on its own Tailscale IP (100.x) and dials the other; newline-delimited JSON over TCP, one shared token in `app/team.json`; simultaneous dials are resolved by keeping the connection dialed by the alphabetically first user. A hybrid logical clock (`ord`) orders chat across skewed clocks; edits are newer `rev`s of the same id.
- **Tailscale handling:** finds the exe (PATH, `C:\Program Files\Tailscale`), reads `tailscale status --json` (IP, state, HTTPS name), detects the tray app via `tasklist`, and `tailscale_up()` starts the tray app then `tailscale up`; no admin needed. UI states: `no-tailscale`, `tailscale-off`.
- **Phone:** `web.py` listens only on the Tailscale IP; `tailscale serve --bg --https=<port+1> http://127.0.0.1:<port>` adds HTTPS (required for PWA install) with a second loopback listener that reads the caller from the Serve header. Pairing = QR with a per-PC key (`?k=`), stored as HttpOnly cookie and in the start URL (iOS home-screen apps lose cookies). New key unpairs all phones. A custom header on API calls blocks cross-site posts.
- Limits for a public product: one flat shared secret, everyone must be in one tailnet, no roles.

### C2. Smoother Tailscale

- **Detect and guide:** reuse the flow above plus one-button states: not installed (download link or `winget install Tailscale.Tailscale`), not logged in, wrong tailnet (explain inviting users or node sharing).
- **`tailscale serve`** for the phone PWA as today; needs MagicDNS + HTTPS enabled on the tailnet; fall back to `http://100.x` in a plain browser tab.
- **Embedding ([tsnet](https://tailscale.com/kb/1244/tsnet/)):** a Go library giving a program its own userspace tailnet node. It would be a Go sidecar (per-OS/arch build, ~20-30 MB **(approx)**) exposing a local port; no driver or admin rights, no conflict with an installed Tailscale, but every Lonca node logs in separately (counts toward device limits). Worth it only if "install Tailscale" proves the main drop-off. Not v1. (libtailscale: not researched.)
- **[Headscale](https://github.com/juanfont/headscale):** self-hosted control server for the official clients; document as an advanced option, do not build on it.
- **Alternatives:** [iroh](https://www.iroh.computer/) (QUIC, hole punching, relays, keys as node IDs; needs a Rust sidecar or bindings, **maturity unverified**). WebRTC data channels work in Electron but need signaling plus STUN/TURN, i.e. infrastructure anyway, which is the relay below.

### C3. Optional relay (choice at install: local storage default, or relay)

- Clients keep an outbound **wss** connection (no inbound ports) and exchange encrypted envelopes addressed to a team ID; the relay keeps ciphertext in a capped queue so offline members catch up.
- **E2EE:** the creator generates a random 256-bit team key locally and puts it in the invite code's **URL fragment** (`https://join.example/#<key>`, never sent to the relay). Payloads, attachments and metadata (channel names, authors) are sealed with an AEAD (XChaCha20-Poly1305, libsodium) with HKDF-derived per-message keys. Removing a member means rotating the key and sealing the new one to each remaining member's public key. Known limit: a shared symmetric key gives no forward secrecy; accept for v1 and say so (MLS later).
- **Relay sees:** team ID, client IPs, connection times, message sizes/timing, device IDs, member count. **Cannot see:** content, files, channel or user names. It can drop, delay or replay, so envelopes carry a device-signed sequence number clients verify; it cannot forge, since senders sign with device keys.
- **Self-hostable:** one small binary (Node or Go) + SQLite, Docker image, Apache-2.0, same code for any hosted default. Relay auth uses a token derived from the team key with a different HKDF label, so the relay authorizes connections without learning the key. Add rate limits and per-team quotas.
- Without a relay, data lives with the peers and sync happens over Tailscale when both are online; with a relay anyone can be offline.

### C4. Invites and roles

- Each team has an **admin Ed25519 key**; its public key is the team identity. Each device has its own keypair.
- An **invite** is a signed token `{team, role, exp, jti, inviter, addr}` shown as a code or link. Roles: Admin, Editor, Viewer.
- **Expiring:** `exp` checked by the verifier. **One-time:** the verifier keeps used `jti`s and burns on first use. In peer mode the inviting admin's app verifies; it then issues a **membership certificate** `{team, device pubkey, role, issued, expiry}` signed by the admin key. A relay may also enforce one-use as a convenience, but is never trusted for roles.
- **Verifiable roles:** members present their certificate; peers check the signature and refuse actions above the role. Revocation = signed revocation list plus team-key rotation; short certificate lifetimes (e.g. 30 days, silently renewed) make it bite for peers who missed the list.
- Honest limit: with a shared team key, a Viewer holds the key and could encrypt messages; enforcement is by signed certificates that honest clients check. Require a valid role certificate and device signature on every event for real read-only.
- Use >=128-bit codes, and add an admin approval step ("Ayse wants to join as Editor") on top of one-time use; it is the cheapest strong protection.

### C5. Phone companion

As Fabrika: PWA served by the desktop app on loopback, exposed with `tailscale serve`, paired by QR, with a custom CSRF header and a service worker that only draws "PC unreachable". Improve with a per-phone token (revoke one phone) instead of one key per PC. In relay mode the phone would be its own member talking to the relay; later.

### C6. Recommendation

- **v1:** solo needs nothing. Team = direct peer sync over Tailscale with Fabrika's detect/guide flow, signed-certificate roles, approved expiring one-time invites; phone PWA via `tailscale serve`.
- **v1.5:** optional self-hostable wss relay with E2EE (key in the invite fragment), same message format and certificates, so the install choice is only a transport switch.
- **Later if needed:** tsnet sidecar, iroh, Headscale docs. Skip WebRTC.
