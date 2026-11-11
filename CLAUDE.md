# Rumpus — rules for Claude

An open-source (Apache-2.0) desktop hub where people and the CLI coding agents they already have work together.
It is the general version of roblox-factory's Fabrika app. Owners: Kaan and Arda. This repo is separate on
purpose; never change roblox-factory for it.

- Reply to the user in **Turkish**. Everything in the repo is **English**. The UI has both languages
  (`apps/desktop/src/renderer/src/locales/tr.json` and `en.json`, always both).
- The product's name is **Rumpus** (`packages/protocol/src/brand.ts`, and `{{app}}` in the locale files); `lonca` is
  the code name and stays in package names (`@lonca/*`), environment variables (`LONCA_*`), `window.lonca`, wire
  headers and file names. Never write the product's name into UI strings or prompts by hand.
- **Read `PLAN.md` first**: decisions, principles, phases, and what the current phase contains. Research behind it
  is in `docs/research/`.
- Rumpus has **no agent of its own**. It drives the user's own CLIs (Claude Code, Codex, OpenCode...). Model calls
  of its own are only for advisors, memory upkeep and voice, on the user's API keys.
- **No relay and no hosted server**, now or later: solo needs nothing, teams connect over Tailscale.

## Layout

| What | Where |
|---|---|
| Contract between core and clients: settings schema, RPC methods and events, error codes | `packages/protocol` |
| Core logic, transport-agnostic: CLI detection, settings, workspace store (`node:sqlite`), CLI drivers, jobs, prompts, RPC server | `packages/core` |
| Design system "Grafit & tek vurgu": tokens, base CSS, components, line icons, motion presets | `packages/ui` |
| Electron main process: window, security, updater, IPC for what only main can do | `apps/desktop/src/main` |
| The core as an Electron utility process (one MessagePort per window) | `apps/desktop/src/core` |
| Preload bridge (`window.lonca`) | `apps/desktop/src/preload`, types in `src/shared/bridge.ts` |
| The UI: launcher, shell, settings, store, RPC client | `apps/desktop/src/renderer` |
| Real-app tests (launcher, shell, settings, restart; update from a local feed) | `apps/desktop/e2e` |
| Copy rules check, icon renderer | `scripts/` |

## Rules

- **Principles in PLAN.md section 3 are the product.** Safe defaults (agents read-only and owner-only), the owner's
  machine decides what an agent may do, only a person's message starts work, Rumpus never reads or copies a CLI's
  login files, no "Sign in with Claude/Gemini". Do not weaken them.
- **UI copy is impersonal** (PLAN.md 7.1): no `sen`/`siz` or `you`/`your`, no `!`, no emoji, no greetings or
  praise, the app never speaks as itself. Buttons are plain verbs or nouns. `pnpm check:copy` enforces part of it.
- Every refusal is a code (`CoreError('not_installed')`, list in `packages/protocol`) with a line in both locales
  under `errors.`.
- Icons are line SVGs from `packages/ui/src/icons.tsx`; never emoji or symbol characters as icons. Native controls
  (`<button>`, `<input type="radio">` in a `<label>`) over ARIA roles on divs.
- Motion explains state changes, stays short, and respects `prefers-reduced-motion` and the Motion setting.
- Renderer: sandboxed, context-isolated; it talks to the core over the MessagePort and to main only through
  `window.lonca`. Main checks that IPC comes from the app's own page. Keep it that way.
- Supply chain: pnpm installs only versions older than 7 days (`minimumReleaseAge`) and pins them exactly. Install
  scripts run only for packages in `allowBuilds` (`pnpm-workspace.yaml`).

## After a change

1. `pnpm check` (Biome, TypeScript, Vitest, copy rules).
2. `pnpm e2e`: the real app with a temporary `LONCA_HOME`: `e2e/smoke.mjs` (launcher, shell, settings, restart)
   and `e2e/channel.mjs` (agents, jobs, live view, steer and stop, board, palette, projects, restart) against
   `e2e/fake-claude.mjs`, a stand-in for Claude Code that costs no quota; `e2e/specialists.mjs` (a specialist from a template, its lesson and RESULT, the overview, unread marks, a
   routine); `e2e/advisors.mjs` (providers, advisors)
   against `e2e/fake-provider.mjs`, a stand-in OpenAI-compatible server; `e2e/team.mjs` (two apps, invite, join,
   sync) with `LONCA_PEER_HOST=127.0.0.1` instead of Tailscale; `e2e/phone.mjs` (pairing a narrow window as a
   phone) with `LONCA_PHONE_PORT=0` instead of `tailscale serve`; `e2e/layout.mjs` (an agent without a folder,
   character presets, the look settings, the crew strip and the hidden channel list in a 960 px window) with
   `LONCA_DESKTOP_DIR=<folder>` instead of the real desktop. For a layout change also run `node e2e/tour.mjs`
   (after a build; not part of `pnpm e2e`): it walks every page at 960, 1280 and 1440 px and only takes
   screenshots (`test-results/tour-<width>-<page>.png`). Look at the screenshots in
   `apps/desktop/test-results/` before saying a UI change works. Spend real CLI quota only for a short probe: `e2e/real-specialist.mjs` (one Haiku job) for changes to specialists;
   `e2e/real-claude.mjs` (two Haiku turns) for driver changes, `LONCA_REAL_CODEX=<folder> vitest run
   packages/core/test/real-cli.test.ts` for Codex (no login needed, no tokens).
3. Packaging changes: `pnpm dist`, then `E2E_EXE=release/win-unpacked/Rumpus.exe node e2e/smoke.mjs` in
   `apps/desktop`. Updater changes: `e2e/update.mjs` (see its header).

## Gotchas

- Scripted edits: write the script to a file (the Write tool) and run it; a shell heredoc loses backslashes and
  breaks on apostrophes, and `String.replace` with a string replacement expands `$\`` and `$'`. After a broken
  edit never run `biome check --write` on the file: its fixes rewrite what the parser misread.
- A command line that ends in `| tail` or `| grep` hides a failing `pnpm check`; send the output to a file and
  chain the commit with `&&`.

- A Zustand selector must return a stable value: no `.filter`, `.map`, `?? []` or object literals inside
  `useApp((s) => …)`. A new array on every call makes React re-render forever and the window stays blank (it
  happened twice). Select the stored value and derive with `useMemo`, or fall back to a module-level constant.

- The middle column (`.chat`) is a container for container queries (`shell/layout.css`), which can also make it
  the containing block of anything `position: fixed` inside it. Dialogs and overlays are rendered from `App.tsx`,
  outside it; keep it that way. Lay a page out with `@container page (max-width: …)`, not with the window's width:
  the page's room depends on the channel list and the crew panel, not only on the window.
- Two radios with the same label in one dialog break the e2e scripts' `choose(name)` (it happened with "Açık" for
  the light theme and a shown panel): give options distinct words.
- An update test must never install what it downloaded: the local test feed turns off install-on-quit. If a test
  build gets installed anyway, remove it with its own uninstaller from PowerShell.
- Git Bash rewrites `/S`-style arguments into paths. Run Windows installers, `taskkill` and similar from
  PowerShell (or set `MSYS_NO_PATHCONV=1`).
- Playwright's `page.screenshot` can hang on Electron windows; the e2e scripts use `webContents.capturePage()`.
- electron-builder's icon converter can fail for lack of memory; `pnpm icon` builds `icon.png` and `icon.ico`
  itself from `apps/desktop/build/icon.svg`.
- Releases: tag `v<version>` (matching `apps/desktop/package.json`) and the Release workflow publishes the
  installers. While the repo is private, installed apps cannot read the releases, so auto-update works only
  after the repo goes public (planned after Phase 1).
