# Claude Desktop: behavior study for Lonca v2

Target: Claude Desktop 2.37337.1 (Windows, Electron). Static analysis only: the app was never launched. The asar was unpacked with REA and read as minified JavaScript. Facts are tagged **[bundle]** (seen in shipped code, module named) or **[public]** (public MCPB spec). Paths are inside `app.asar`; "main chunk" means the 7 MB `.vite/build/index.chunk-*.js` that holds main-process logic (chunk names are build hashes). This is a description of behavior for clean-room design; nothing is copied.

## 1. Extensions and connectors

### 1.1 Two kinds
- **Local extensions**: a packaged MCP server run on the user's machine, shipped as `.mcpb` (legacy `.dxt` still accepted). [bundle: main chunk, extension installer]
- **Remote connectors**: an MCP URL (streamable HTTP or SSE) with OAuth. [bundle: main chunk MCP client, `.vite/build/mcp-runtime/directMcpHost.js`]

### 1.2 Package format (MCPB)
A zip with `manifest.json` at the root, validated by a schema. [bundle: manifest schema, main chunk]
- Identity: `manifest_version` (legacy `dxt_version`), `name`, `version`, `description`, `author{name,email,url}`.
- Presentation: `display_name`, `long_description`, `icon`, `screenshots`, `homepage`, `documentation`, `support`, `repository`, `keywords`, `license`, `privacy_policies`, free `_meta`.
- `server`: `type` node, python, binary or uv; `entry_point`; `mcp_config{command,args,env,platform_overrides}` (overrides keyed by OS replace command/args/env).
- `tools`, `prompts` (declared), with `*_generated` flags for runtime-produced lists.
- `compatibility`: platforms, runtime version ranges, minimum client version. The app turns this into `{compatible, requirements[{name,met}]}` for the directory UI.
- `user_config`: map of key to `{type: string|number|boolean|directory|file, title, description, required, default, multiple, sensitive, min, max}`.
- [public] agrees, and adds `localization` and `uv` servers (dependencies in `pyproject.toml`, no bundled venv). The public page says nothing on signing.

Substitution in command/args/env [bundle: config builder; public agrees]: the install folder, `user_config.KEY` (manifest default if unset; arrays expand to several args; booleans become "true"/"false"), HOME/DESKTOP/DOCUMENTS/DOWNLOADS, and the path separator. If a `required` value is missing, no launch config is built: the extension installs but stays disabled until the user fills it.

### 1.3 Secrets
[bundle: extension settings code, main chunk]
- Per-extension settings JSON in an "extension settings" folder under app data: `isEnabled` plus `userConfig`.
- Keys marked `sensitive` are encrypted with Electron `safeStorage` (DPAPI/keychain) and stored as marker prefix + base64, array items one by one.
- Weakness: if safeStorage is unavailable the code logs a warning and stores plaintext. Lonca must not do this.
- On read, the manifest says which keys are sensitive; a decrypt failure marks the config "degraded", drops those values and asks again. Reinstall keeps old settings.

### 1.4 Directory list
[bundle: directory client, shape only]
- A first-party HTTP API scoped to the signed-in organization; two gates (org policy and a remote switch) can disable it. Responses cached ~5 minutes.
- List: `{entries[], total, limit, offset}`, query `search/limit/offset`. Entry: `id`, `icon_url`, `upload_date`, full `manifest`, `signature_info`, optional internal flag.
- Detail adds file size and download count. A versions call returns `[{version, upload_date, file_size}]`. A download call takes an optional version and returns the `.mcpb`.
- Ids: registry ids are plain. Local installs get a source prefix (local.mcpb / local.dxt / local.unpacked) plus slug(author).slug(name). A package must match its requested install slot.

### 1.5 Lifecycle
[bundle: installer functions, main chunk]
1. **Entry points**: directory download; Extensions menu (install from file, install unpacked folder, open folders); a preview that reads manifest and icon without extracting. UNC paths refused.
2. **Staging**: copy to a private temp dir (mode 600); a worker reads manifest and signature; a native "install?" dialog (uv extensions warn that dependencies will be fetched).
3. **Gates**: global extensions switch; signature required by policy; can-install check against a vendor API (hash, manifest, signature, source) for block/allow lists; identity match; unpacked installs need developer mode allowed.
4. **Materialize**: unzip in a worker with a size cap into staging, then atomic move to `<appdata>/Claude Extensions/<id>` (copy fallback). Per-extension lock.
5. **Record**: `extensions-installations.json` stores per id version, content hash, time, cert fingerprint, manifest, signature info, source. It is re-checked at startup; under strict policy, extensions with no record are blocked ("unrecorded").
6. **Enable**: on by default unless required config is missing; reinstall restores prior state. The MCP config is rebuilt and servers are reconnected.
7. **Disable**: flip `isEnabled`, stop the server, rebuild config. An org block remembers the previous state so it can be restored.
8. **Update**: versions fetched (cached 30 min), semver compare, newest offered; `local.*` never updates; an auto-update switch exists. An update is the install path with settings kept.
9. **Uninstall**: stop servers, delete folder, settings file and metadata, clear caches; a missing folder is cleaned up gracefully.

### 1.6 Signing
[bundle: `.vite/build/heavy-work-worker/`]
- The signature is appended to the zip: start marker, PKCS#7 signed-data, end marker. A worker (pure-JS crypto) checks the signed digest equals SHA-256 of the original bytes and reads the cert chain.
- Result `signed | unsigned | self-signed` plus publisher, issuer, validity, fingerprint, shown in dialogs and the directory.
- Chain trust seems to use an external process call; I did not trace it.

### 1.7 How local extensions run
[bundle: main chunk transport, `mcp-runtime/nodeHost.js`]
- **Node**: by default no system Node is needed. The server starts in an Electron *utility process* running a small host script, with stdio bridged to a normal MCP stdio client. The host patches `child_process` so a server cannot re-launch "Electron as Node"; the error tells the user to install Node and switch off the built-in option (Extensions settings, Advanced; also an app-config key).
- **Python**: only via `uv`. The app downloads a `uv` binary on first use (with progress), runs `uv sync` in the extension folder, and launches from that venv; policy can force system Python.
- **Binary**: run from the install folder, picked via `platform_overrides`.
- Env hygiene: a long deny list of variables that inject code into node, python, ruby, perl, java, dotnet and shells is applied to spawned processes. Copy this.
- Per-server logs are reachable from a Developer menu.

### 1.8 Remote connectors and OAuth
[bundle: OAuth client in main chunk]
- Standard MCP SDK flow: protected-resource and authorization-server discovery, PKCE, dynamic client registration (or an HTTPS client-metadata-document id), refresh. The desktop is a public client (no secret) and names itself with its version.
- **Custom (user-added) connectors**: a one-shot loopback HTTP server. Checks: Host header, `state`, no repeated `code/state/error` parameters, Referer host must match the identity provider or a short allowlist; strict CSP; a plain "close this tab" page. Sign-in opens in the system browser or an in-app window (org setting can force the browser).
- **Hosted connectors / Claude Code sessions**: a custom scheme `claude://…/mcp-auth-callback/…`. The app registers as default protocol client; the OS sends the URL to the single running instance (single-instance lock); a setting can disable deep links.
- Tokens and client info are kept per server-URL key in an encrypted store; a "stale client" probe re-registers a revoked client. GitHub and Microsoft 365 connectors are bundled servers under `resources/`; Microsoft sign-in has its own broker worker.

### 1.9 Per-tool permissions
The chat prompt UI is the hosted web app, so it is not in the bundle. What exists:
- Policy values per tool: always allow, ask each time, ask once per session, blocked; stored as server to tool to policy, settable by an organization. [bundle: policy schema, main chunk]
- Agent sessions: a broker forwards each request (tool, arguments, reason, display name, "default to no", option to hide always-allow) to the UI, re-notifies pending cards, can answer "allow once" from an OS notification, and denies when the transport is gone. Arguments are shown for review with recipient fields (to, cc, bcc, subject) first and a warning when the same field is spelled two ways, an anti-spoofing trick worth copying. [bundle: main chunk, `index.chunk-C4qJSrNf.js`]
- Sites: Always allow / Allow once / Cancel dialogs, extra wording for local-network hosts; always-allow degrades to once if a site check is unavailable. Folders: trusted-folder lists.

## 2. Shortcuts, quick entry, dictation

[bundle: main chunk shortcut registry, `quickWindow.js`, app-config schema]
- **Global shortcuts**: one registry validates an accelerator (known key names, F1 to F24, numpad, must include a modifier), unregisters the old one, and on failure restores the previous binding and reverts the preference. Windows default is Ctrl+Alt+Space. On Linux Wayland the app needs the desktop GlobalShortcuts portal, probes for it and reports "unsupported" otherwise. Lonca needs that fallback plan.
- **Quick entry**: macOS uses a native overlay (double-tap Option by default). Elsewhere it is a frameless, transparent, always-on-top, skip-taskbar window loaded from a local page. It hides on blur, remembers position per monitor (match by label+size, else primary), moves sideways to stay on screen as it grows, lists recent chats, and sends submit (text and files) to the main window. Setting values: off, the default key, or a custom accelerator.
- **Dictation**, two pieces:
  1. Composer dictation with its own shortcut (default, off, custom). Quick entry has a separate dictation shortcut, off by default.
  2. A system-wide hold-to-talk helper (off by default): hold keys to talk, dictate into the focused field, or take a note. It probes the focused app, inserts at the caret, has per-app allow/exclude lists and custom terms, and shows a HUD with a level meter.
  Audio is captured natively (48 kHz mono 16-bit PCM) and streamed over a WebSocket to the vendor's server-side speech-to-text; interim text is forwarded. No local model found.
- **In-app shortcuts** are menu accelerators (new side chat, command palette, close pane, find, reopen closed session, open folder, settings, zoom, a shortcuts sheet); the shell only dispatches events to the hosted UI. No user keymap file was found in the shell.

## 3. Settings, memory, projects
- Settings panes live in the hosted web UI, so their layout is not in the bundle. The shell keeps a schema-validated app-config JSON (broken keys filtered, "degraded" flag) and a preferences object, plus managed policy from the OS (registry, MDM profile, or a file under `/etc`) and from the organization.
- Shell-level options: launch at login, tray/menu bar, quick entry and dictation shortcuts, hardware acceleration and Chromium flags, built-in-Node switch, extension signature and auto-update policy, notification levels and sound, keep-awake, trusted folders, per-account bypass-permissions option, scheduled tasks, VM resources.
- Chat memory and Projects are server-side. Locally, agent modes keep plain files: per-space `memory` folders, a global instructions file, session folders, and imports of project instructions, `CLAUDE.md` and `AGENTS.md`.

## 4. Recommendations for Lonca

**Copy**
- Zip + manifest packages with `user_config` forms (sensitive, file/dir pickers, required), substitution, and import of public MCPB files as-is.
- Show signature, publisher and compatibility before install; keep an install record (hash, source, version) and re-check at startup.
- Stage, verify, atomic move, per-extension lock; keep settings across updates.
- Loopback OAuth with the strict Host/state/parameter/Referer checks, PKCE, public client; a custom-scheme deep link for hosted callbacks.
- Four-value tool policy with org override; show real arguments, recipients first.
- Quick-entry window that remembers monitor and hides on blur; shortcut registry with rollback; explicit Wayland fallback.
- Env deny list when spawning servers.

**Do better**
- Never fall back to plaintext secrets: use libsecret / DPAPI / Keychain, else an encrypted file with a passphrase.
- Optional sandbox for local servers and per-extension network and folder grants shown at install.
- Open, mirrorable directory (static signed index) so teams can self-host; team allowlists and shared connector configs.
- Write one install to every CLI agent's own MCP config (Claude Code, Codex, Gemini CLI).
- Team-visible audit log of tool decisions; editable shortcut map; optional local speech-to-text.

**Avoid**
- A hosted settings UI over a local shell (no offline use, hard to audit).
- Two sign-in paths with different security and no hint to the user.
- Vendor-API dependence for install policy; per-step telemetry.
- Relying on the Electron-as-Node trick; ship a pinned, documented Node download or use system Node.

## Not determined statically
- Certificate trust anchors and the external command in signature checks.
- Directory and can-install API behavior beyond the shapes above; remote-switch defaults.
- The chat-lane permission dialog UI (hosted).
- Speech service languages and quality; OS audio engine used.
- Any local cache of memory or projects beyond the folders named.
