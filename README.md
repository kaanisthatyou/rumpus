# Lonca

An open-source desktop hub where people and the CLI coding agents they already have work together.

Lonca does not ship an agent of its own. It drives the CLIs installed and signed in on each computer (Claude Code,
Codex, OpenCode, ...), shows their work live, and puts channels, a task board, goals, projects, saved ideas and
references, memory and advisor bots around them. Alone it needs nothing else; a team connects over Tailscale, with
no server or account in between.

**Status: 0.8.0-alpha.0** (2026-10-19), Phase 4 of the plan under way. The plan, its decisions and every phase's
status are in [PLAN.md](PLAN.md).

## What it does

- **Channels and agents.** Write to an agent in its own channel or `@mention` it anywhere; each job is a live card
  (steps, tokens, cost) with a live view, steering and stop. Agents run read-only, with edits, or fully, as their
  owner sets; approvals wait on a person.
- **Board and goals.** `/todo` makes a card that runs as a job; `/goal` lets an agent plan, get approval, and work step
  by step until a done check passes, optionally in its own git worktree.
- **Projects.** A git repository each member points at their own clone of: branch, changes, pull and push, a status
  page (where it stands, milestones, next) that agents keep current, and areas (who mostly works on what).
- **Hand-over.** An agent working on a person's request can hand self-contained parts to other agents and collect
  their answers; a part is never handed on.
- **Advisors.** Bots on the person's own API keys (Groq, Anthropic, Gemini, OpenRouter, local servers, ...) that
  read the conversation and the project and give honest takes; `/meclis` for a round table, `/özet` for a summary.
- **Records and memory.** Ideas, reference images, saved commands, small human-edited memory, full-text search.
- **Team.** Workspaces shared by invite code with roles, synced peer to peer over Tailscale with signed events;
  members' agents run on their owners' computers under their limits. `/durum` shows every computer's CLIs, logins
  and quota.
- **Several logins per CLI**, a **phone companion** over Tailscale with pushes, and **quick entry** from anywhere
  with `Ctrl Alt Space`.
- Turkish and English, light and dark.

## Develop

Needs Node 22+ and pnpm 12.

```
pnpm install
pnpm dev          the app with hot reload
pnpm check        Biome, TypeScript, unit tests, UI copy rules
pnpm e2e          build, then run the real app against stand-ins for Claude Code and a model provider
pnpm dist         build the installer (apps/desktop/release)
```

Each run of the app can use its own data folder: `LONCA_HOME=<folder>`. `LONCA_LANG=tr|en` overrides the system
language on first start.

## Layout

```
apps/desktop        Electron app: main process, core utility process, preload, renderer, e2e tests
packages/protocol   types and schemas shared by the core and its clients
packages/core       core logic: store and sync, jobs and CLI drivers, advisors, goals, projects, MCP gateway
packages/ui         design system: tokens, components, icons, motion
docs/research       studies behind the plan
```

## License

Apache-2.0. See [LICENSE](LICENSE).
