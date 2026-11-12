# Security

## Reporting a problem

Please report a vulnerability privately, through **Security → Report a vulnerability** on the repository's GitHub
page (GitHub's private vulnerability reporting), not in a public issue. A report that says what a lower-trust party
can do, to whom, and how to reproduce it on one's own computers is the most useful kind. Expect a first answer
within a week. Rumpus is alpha software kept by a small team; there is no bug bounty.

Only the latest release gets fixes.

## What Rumpus trusts, and what it does not

The whole model is in [PLAN.md](PLAN.md), sections 3 (principles) and 6.8. In short:

- **The person at the computer and their own paired phone** have full authority over that computer's Rumpus. A
  paired phone can do everything the desktop window can, including giving agents work.
- **Other members of a workspace, and friends,** are lower trust. What they send is display data or a request
  under this computer's own rules: every event is signed and checked against the sender's membership certificate
  and permission level; an agent runs only on its owner's computer, under limits only its owner sets; another
  member's request is capped at read-only unless the owner raised it; profiles, roles, names and pictures are
  cleaned on arrival and never decide what anyone may do.
- **Agents, advisors and connectors** act for a person and are not trusted with more than that person gave them.
  Channel text, records and other agents' output reach an agent marked as untrusted; only a person's message
  starts work; no instruction text can widen an agent's mode, folders or tools.
- **The network.** Rumpus listens for other people's apps only on the computer's Tailscale address, and calls out
  to other apps only at an IP and port in Tailscale's ranges. There is no relay and no hosted service. Model
  providers and connectors are reached only as the person configured them.
- **Secrets** (provider keys, connector tokens, the device key) are sealed with the operating system's secret store
  and stay in the main process. Rumpus never reads or copies a CLI's login files.

Things that are **not** vulnerabilities in this model: a person, or anyone who already runs code as them on their
own computer, doing something with their own Rumpus; an owner's own agent in full mode running commands; a member
reading what their workspace shares with every member.

## Builds

Releases are built by the tag-driven workflow in `.github/workflows/release.yml` from this repository, with its
actions pinned to commits and dependencies pinned and installed only once a week old (`pnpm-workspace.yaml`).
Windows builds are not code-signed yet; the app updates itself from this repository's GitHub releases.
