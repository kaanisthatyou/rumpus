// Whose computer runs an agent: in a team lonca, jobs run on the owner's computer with the owner's CLI login.
import { type Agent, handleOf, type Job, type Message, type WorkspaceState } from '@lonca/protocol';

/** The owner's name when the agent belongs to another member; undefined for this device's own agents. */
export function remoteOwner(agent: Agent | undefined, ws: WorkspaceState | undefined): string | undefined {
  if (!agent?.owner || ws?.kind !== 'team' || agent.owner === ws.me.id) return undefined;
  return ws.members?.find((m) => m.device === agent.owner)?.name ?? '?';
}

/**
 * Whether a job runs on this computer: its agent is this device's. Approvals, steering and stopping are the
 * owner's, so only such a job may ask this person for anything.
 */
export function runsHere(job: Job, ws: WorkspaceState | undefined): boolean {
  if (ws?.kind !== 'team') return true;
  const owner = ws.agents.find((a) => a.id === job.agentId)?.owner;
  return !owner || owner === ws.me.id;
}

/** Whether a job is this person's business: it runs here, or this person asked for it. */
export function concernsMe(job: Job, ws: WorkspaceState | undefined): boolean {
  return runsHere(job, ws) || (Boolean(job.by) && job.by === ws?.me.id);
}

/** An agent's name for a notification, with its owner's when it is another member's ("Test (Arda)"). */
export function agentLabel(agent: Agent | undefined, ws: WorkspaceState | undefined): string {
  const owner = remoteOwner(agent, ws);
  return owner ? `${agent?.name ?? ''} (${owner})` : (agent?.name ?? '');
}

/**
 * Who a message that deserves a notification is from, by the name the workspace knows them under (not the one
 * the message carries); undefined when it deserves none. Another member's message always does. An agent's or an
 * advisor's does when it is another member's and names this person, and it is announced with whose it is, so
 * nobody's bot speaks under someone else's name.
 */
export function senderOf(m: Message, ws: WorkspaceState): string | undefined {
  if (ws.kind !== 'team') return undefined;
  const nameOf = (device: string) => ws.members?.find((x) => x.device === device)?.name;
  const a = m.author;
  if (a.kind === 'person') return a.id === ws.me.id ? undefined : (nameOf(a.id) ?? a.name);
  if (a.kind !== 'agent' && a.kind !== 'advisor') return undefined;
  const bot = a.kind === 'agent' ? ws.agents.find((x) => x.id === a.id) : ws.advisors.find((x) => x.id === a.id);
  if (!bot?.owner || bot.owner === ws.me.id) return undefined;
  const handle = handleOf(ws.me.name);
  if (!handle || !m.text.toLowerCase().includes(`@${handle}`)) return undefined;
  return `${bot.name} (${nameOf(bot.owner) ?? '?'})`;
}
