# Contributing

Rumpus is alpha software with a written plan: [PLAN.md](PLAN.md) holds the decisions, the principles and what each
phase contains. Read its sections 2 and 3 before proposing a change; a change that bends a principle (safe
defaults, the owner's computer decides, only a person starts work, no credential handling, no relay) needs a
discussion in an issue first.

## Setting up

Node 22 or newer and pnpm 12.

```
pnpm install
pnpm dev          the app with hot reload
pnpm check        Biome, TypeScript, unit tests, UI copy rules
pnpm e2e          build, then drive the real app against stand-ins (no CLI quota, no network)
```

`LONCA_HOME=<folder>` gives a run its own data folder, so a development copy never touches an installed one.

## Before a pull request

- `pnpm check` and `pnpm e2e` pass. A change to the UI comes with a look at the screenshots the e2e scripts leave
  in `apps/desktop/test-results/`.
- Everything in the repository is English. The UI has Turkish and English; a new string goes into both locale
  files (`apps/desktop/src/renderer/src/locales/`).
- **UI copy is impersonal** (PLAN.md 7.1): no "you", no exclamation marks, no emoji, buttons are plain verbs or
  nouns. `pnpm check:copy` enforces part of it.
- Every refusal is an error code with a line in both locales, not free text.
- New dependencies are pinned exactly and at least a week old; nothing from closed-source apps goes in.
- What another computer sends (a member's event, a friend's request, a connector's answer) is checked where it is
  used, not trusted because of where it came from. See [SECURITY.md](SECURITY.md).

The layout of the repository and the notes that saved time before are in [CLAUDE.md](CLAUDE.md); they are written
for coding agents and are just as useful to people.

## License

Contributions are accepted under the repository's license, Apache-2.0.
