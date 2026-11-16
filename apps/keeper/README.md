# rumpus-keeper

An always-on member for Rumpus team workspaces: Rumpus's core without a window and without agents, for a machine
that stays up (a home server, a small cloud VM, a Raspberry Pi).

Rumpus has no server. Every member's app keeps the whole workspace and syncs with whoever is online, so two members
who are never online at the same time would not see each other's messages until they were. The keeper fixes that by
being one more member that is always online: what Arda writes at night reaches the keeper, and Kaan's app takes it
from there in the morning, even if Arda's computer is off by then.

It is not a relay or a hosted service (PLAN.md 6.5):

- It runs on a member's own machine, joins with an invite like a person, and an admin approves it.
- It holds what any member holds and nothing else; Viewer is enough, since it never posts or runs agents.
- Every event it passes on is signed by its author, and every app checks the signature again; a keeper cannot write
  in someone else's name.
- Removing it is removing a member (Members → the trash icon).

## Requirements

- Node 22.13 or later (it uses `node:sqlite`), any platform and architecture; nothing else to install.
- Tailscale on the machine, in the same tailnet as the members (or the machine shared with them). Other members
  reach it on its Tailscale address, TCP port 47640; a firewall there allows that port on the Tailscale interface.

## Build

```sh
pnpm --filter @lonca/keeper build      # apps/keeper/dist/keeper.mjs, one file
```

## Join a workspace

1. In Rumpus, an admin makes an invite (Viewer is enough) and copies the code.
2. On the machine: `node keeper.mjs join <code> --name "Home server"`. It asks to join and waits.
3. The admin approves the request in Rumpus. The keeper logs `joined <workspace>`, then who is online.
4. Ctrl+C, then run it as a service (below). It keeps every workspace it joined; `join` again for another one.

`node keeper.mjs status` reads its files without starting it (data folder, device, workspaces).

## As a service (systemd)

```ini
# /etc/systemd/system/rumpus-keeper.service
[Unit]
Description=Rumpus keeper (always-on workspace member)
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
User=rumpus
Environment=LONCA_HOME=/var/lib/rumpus-keeper
ExecStart=/usr/bin/node /opt/rumpus-keeper/keeper.mjs run
Restart=always
RestartSec=10
MemoryMax=512M
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/rumpus-keeper

[Install]
WantedBy=multi-user.target
```

Run the `join` step as the same user with the same `LONCA_HOME`, with the service stopped (one keeper per data
folder; a second one stops at once). With ufw: `ufw allow in on tailscale0 to any port 47640 proto tcp`.

## Environment

| Variable | Meaning |
|---|---|
| `LONCA_HOME` | Data folder (default `~/.rumpus-keeper`): its key (`identity.json`, readable by its user only), settings, workspaces |
| `LONCA_PEER_HOST` | Listen on this address instead of the Tailscale one (tests) |
| `LONCA_PEER_PORT` | And this port (default 47640) |

The private key sits in a file readable only by the keeper's user, since a server has no keychain to seal it with.
Whoever can read that file can act as the keeper: post messages under its name with its permission level (Viewer:
no agents, no board).
