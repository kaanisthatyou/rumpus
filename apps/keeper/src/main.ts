// The keeper's command line. Logs go to stdout, one line each, for journald or a terminal.
import { hostname } from 'node:os';
import type { InviteCheck, WorkspaceSummary } from '@lonca/protocol';
import {
  defaultHome,
  describe,
  type Keeper,
  KeeperError,
  openKeeper,
  parseArgs,
  readStatus,
  snapshot,
  takeLock,
  USAGE,
} from './keeper.js';

declare const KEEPER_VERSION: string;
const version = typeof KEEPER_VERSION === 'string' ? KEEPER_VERSION : 'dev';

const log = (line: string) => process.stdout.write(`${new Date().toISOString()} ${line}\n`);
// Looked at often, written only when something changed.
const REPORT_MS = 5000;

function start(home: string): Keeper {
  process.on('exit', takeLock(home));
  const peerHost = process.env.LONCA_PEER_HOST;
  const k = openKeeper({
    home,
    ...(peerHost ? { peerHost, peerPort: Number(process.env.LONCA_PEER_PORT) || 0 } : {}),
  });
  const stop = (signal: string) => {
    log(`stopping (${signal})`);
    k.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('unhandledRejection', (e) => log(`error: ${e instanceof Error ? e.message : String(e)}`));
  return k;
}

/**
 * Logs the workspaces and who is reachable, when it changes. While a join waits: says when it is approved and the
 * workspace has arrived, and stops the process when it is turned down.
 */
function watch(k: Keeper, waitingFor?: string, untilJoined = false): void {
  let last: string | undefined;
  let welcomed = false;
  const report = async () => {
    try {
      const lines = await snapshot(k);
      const text = describe(lines).join('\n');
      if (text !== last) {
        for (const line of describe(lines)) log(line);
        if (lines.length === 0) log('in no team workspace yet: `join <code>` with an invite from an admin');
        last = text;
      }
      const asked = waitingFor ? lines.find((w) => w.id === waitingFor) : undefined;
      if (asked && !asked.state && !welcomed && asked.members.length > 1) {
        welcomed = true;
        log(`joined ${asked.name}; this process keeps it while it runs, and "run" (or a service) after`);
        if (untilJoined) {
          // A moment for the first exchanges to finish, then the service takes over.
          setTimeout(() => {
            k.stop();
            process.exit(0);
          }, 3000);
        }
      }
      if (asked?.state === 'denied') {
        log(`the request to join ${asked.name} was turned down`);
        k.stop();
        process.exit(1);
      }
    } catch (e) {
      log(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  // The core starts its workspaces and the peer API a moment after it is made.
  setTimeout(() => void report(), 3000);
  setInterval(() => void report(), REPORT_MS);
}

async function main(): Promise<void> {
  const command = parseArgs(process.argv.slice(2));
  const home = defaultHome();
  switch (command.kind) {
    case 'help':
      process.stdout.write(`${USAGE}\n`);
      return;
    case 'version':
      process.stdout.write(`${version}\n`);
      return;
    case 'status': {
      const s = readStatus(home);
      process.stdout.write(`data:      ${home}\n`);
      process.stdout.write(`device:    ${s.device ?? '(none yet)'}\n`);
      process.stdout.write(`key:       ${s.key ?? '(none yet)'}\n`);
      if (s.workspaces.length === 0) process.stdout.write('workspaces: none\n');
      for (const w of s.workspaces)
        process.stdout.write(`workspace: ${w.name} (${w.id})${w.state ? `, ${w.state}` : ''}\n`);
      return;
    }
    case 'run': {
      const k = start(home);
      log(`keeper ${version}, data in ${home}`);
      // Members see it as a device that keeps the workspace, not as a person.
      await k.call('settings.update', { profile: { keeper: true } });
      watch(k);
      return;
    }
    case 'join': {
      const k = start(home);
      log(`keeper ${version}, data in ${home}`);
      const name = command.name ?? hostname();
      await k.call('settings.update', { profile: { name, keeper: true } });
      const check = await k.call<InviteCheck>('invites.check', { code: command.code });
      if (!check.reachable) log(`warning: the inviter's computer does not answer now; trying anyway`);
      const joined = await k.call<WorkspaceSummary>('invites.join', { code: command.code });
      log(`asked to join ${joined.name} as "${name}"; an admin approves it in the app (members, requests to join)`);
      watch(k, joined.id, command.untilJoined === true);
      return;
    }
  }
}

main().catch((e) => {
  if (e instanceof KeeperError && e.code === 'usage') {
    process.stderr.write(`${e.message}\n\n${USAGE}\n`);
    process.exit(2);
  }
  const code = e instanceof KeeperError ? e.code : '';
  process.stderr.write(`${code ? `${code}: ` : ''}${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
