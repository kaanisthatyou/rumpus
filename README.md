# Lonca

An open-source desktop hub where people and the CLI coding agents they already have work together.

Lonca does not ship an agent of its own. It drives the CLIs installed and signed in on each computer (Claude Code,
Codex, OpenCode, ...), shows their work live, and puts channels, a task board, goals, saved ideas and references,
memory, voice, connectors and advisor bots around them. Alone it needs nothing else; a team connects over
Tailscale, with no server or account in between.

**Status: Phase 0 of the plan** (2026-10-16): an installable, self-updating shell with the first-run setup, CLI
agent detection, settings, and the design system. Channels, jobs and records arrive in Phase 1. The plan, its
decisions and the phases are in [PLAN.md](PLAN.md).

## Develop

Needs Node 22+ and pnpm 12.

```
pnpm install
pnpm dev          the app with hot reload
pnpm check        Biome, TypeScript, unit tests, UI copy rules
pnpm e2e          build, then run the real app through setup, shell, settings and a restart
pnpm dist         build the installer (apps/desktop/release)
```

Each run of the app can use its own data folder: `LONCA_HOME=<folder>`. `LONCA_LANG=tr|en` overrides the system
language on first start.

## Layout

```
apps/desktop        Electron app: main process, core utility process, preload, renderer, e2e tests
packages/protocol   types and schemas shared by the core and its clients
packages/core       core logic: CLI detection, settings, Tailscale status, RPC server
packages/ui         design system: tokens, components, icons, motion
docs/research       studies behind the plan
```

## License

Apache-2.0. See [LICENSE](LICENSE).
