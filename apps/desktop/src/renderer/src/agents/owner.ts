// Whose computer runs an agent: in a team lonca, jobs run on the owner's computer with the owner's CLI login.
import type { Agent, WorkspaceState } from '@lonca/protocol';

/** The owner's name when the agent belongs to another member; undefined for this device's own agents. */
export function remoteOwner(agent: Agent | undefined, ws: WorkspaceState | undefined): string | undefined {
  if (!agent?.owner || ws?.kind !== 'team' || agent.owner === ws.me.id) return undefined;
  return ws.members?.find((m) => m.device === agent.owner)?.name ?? '?';
}
