import type { TailscaleInfo } from '@lonca/protocol';
import { run as defaultRun, type Runner, type RunResult, which } from './proc.js';

const WINDOWS_DIRS = ['C:\\Program Files\\Tailscale'];

export function parseTailscaleStatus(r: RunResult): TailscaleInfo {
  if (r.failed || r.timedOut) return { state: 'unknown' };
  try {
    const data = JSON.parse(r.stdout) as {
      BackendState?: string;
      Self?: { HostName?: string; TailscaleIPs?: string[] };
    };
    switch (data.BackendState) {
      case 'Running': {
        const ip = data.Self?.TailscaleIPs?.find((a) => a.includes('.'));
        return {
          state: 'running',
          ...(ip ? { ip } : {}),
          ...(data.Self?.HostName ? { host: data.Self.HostName } : {}),
        };
      }
      case 'NeedsLogin':
      case 'NeedsMachineAuth':
        return { state: 'needs-login' };
      case 'Stopped':
      case 'NoState':
        return { state: 'stopped' };
      default:
        return { state: 'unknown' };
    }
  } catch {
    // The CLI exists but its service is not running: it prints an error instead of JSON.
    return { state: 'stopped' };
  }
}

export async function tailscaleStatus(
  opts: { runner?: Runner; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {},
): Promise<TailscaleInfo> {
  const platform = opts.platform ?? process.platform;
  const path = which('tailscale', platform === 'win32' ? WINDOWS_DIRS : [], opts.env ?? process.env, platform);
  if (!path) return { state: 'missing' };
  const result = await (opts.runner ?? defaultRun)(path, ['status', '--json'], { timeoutMs: 6000 });
  return parseTailscaleStatus(result);
}
