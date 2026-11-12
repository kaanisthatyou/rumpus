// Whose a job and a message are, for sounds and notifications: nobody is told about what is not theirs, and
// nobody's agent is announced under someone else's name.
import type { Advisor, Agent, Job, Message, WorkspaceState } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import { agentLabel, concernsMe, runsHere, senderOf } from '../src/renderer/src/agents/owner';

const agent = (id: string, name: string, owner: string): Agent => ({
  id,
  kind: 'claude-code',
  name,
  handle: name.toLowerCase(),
  folder: '',
  mode: 'read',
  instructions: '',
  owner,
  created: 1,
});

const team: WorkspaceState = {
  id: 'w',
  name: 'Ekip',
  kind: 'team',
  me: { id: 'K', name: 'Kaan' },
  channels: [],
  agents: [agent('a-kaan', 'Claude', 'K'), agent('a-arda', 'Test', 'A')],
  advisors: [
    { id: 'd-arda', name: 'Eleştirel', owner: 'A' } as Advisor,
    { id: 'd-kaan', name: 'Olumlu', owner: 'K' } as Advisor,
  ],
  spend: {},
  active: [],
  members: [
    { device: 'K', name: 'Kaan', role: 'admin', me: true },
    { device: 'A', name: 'Arda B.', role: 'editor', me: false },
  ],
};
const personal: WorkspaceState = {
  ...team,
  kind: 'personal',
  members: undefined as never,
  agents: [agent('a', 'Claude', 'K')],
};

const job = (agentId: string, by?: string): Job => ({
  id: 'j',
  channelId: 'c',
  agentId,
  requestId: 'm',
  ...(by ? { by } : {}),
  state: 'attention',
  steps: [],
  usage: { in: 0, cached: 0, out: 0 },
  started: 1,
});

const message = (author: Message['author'], text: string): Message => ({
  id: 'm',
  channelId: 'c',
  author,
  text,
  created: 1,
});

describe('whose a job is', () => {
  it('a job runs here when its agent is this device’s; in the personal workspace every job does', () => {
    expect(runsHere(job('a-kaan'), team)).toBe(true);
    expect(runsHere(job('a-arda'), team)).toBe(false);
    expect(runsHere(job('a'), personal)).toBe(true);
    expect(runsHere(job('gone'), undefined)).toBe(true);
  });

  it('another member’s job concerns this person only when they asked for it', () => {
    expect(concernsMe(job('a-arda'), team)).toBe(false);
    expect(concernsMe(job('a-arda', 'A'), team)).toBe(false);
    expect(concernsMe(job('a-arda', 'K'), team)).toBe(true);
    // Arda asked Kaan's agent: it runs on Kaan's computer, so it is Kaan's business too.
    expect(concernsMe(job('a-kaan', 'A'), team)).toBe(true);
  });

  it('an agent of another member is announced with its owner', () => {
    expect(agentLabel(team.agents[0], team)).toBe('Claude');
    expect(agentLabel(team.agents[1], team)).toBe('Test (Arda B.)');
    expect(agentLabel(undefined, team)).toBe('');
  });
});

describe('who a notification is from', () => {
  it('another member, under the name the workspace knows them by, not the one the message carries', () => {
    expect(senderOf(message({ kind: 'person', id: 'A', name: 'Kaan' }, 'selam'), team)).toBe('Arda B.');
    expect(senderOf(message({ kind: 'person', id: 'K', name: 'Kaan' }, 'selam'), team)).toBeUndefined();
    // Someone no longer in the list keeps the name they wrote under.
    expect(senderOf(message({ kind: 'person', id: 'Z', name: 'Zeynep' }, 'selam'), team)).toBe('Zeynep');
  });

  it('another member’s agent or advisor only when it names this person, and then with whose it is', () => {
    expect(senderOf(message({ kind: 'agent', id: 'a-arda', name: 'Test' }, 'bitti'), team)).toBeUndefined();
    expect(senderOf(message({ kind: 'agent', id: 'a-arda', name: 'Test' }, '@kaan bitti'), team)).toBe(
      'Test (Arda B.)',
    );
    expect(senderOf(message({ kind: 'advisor', id: 'd-arda', name: 'Eleştirel' }, 'Bence @Kaan haklı'), team)).toBe(
      'Eleştirel (Arda B.)',
    );
    // This person's own agent and advisor never notify them as if someone else spoke.
    expect(senderOf(message({ kind: 'agent', id: 'a-kaan', name: 'Claude' }, '@kaan bitti'), team)).toBeUndefined();
    expect(senderOf(message({ kind: 'advisor', id: 'd-kaan', name: 'Olumlu' }, '@kaan'), team)).toBeUndefined();
    expect(senderOf(message({ kind: 'system' }, '@kaan'), team)).toBeUndefined();
  });

  it('nothing in the personal workspace', () => {
    expect(senderOf(message({ kind: 'person', id: 'A', name: 'Arda' }, 'selam'), personal)).toBeUndefined();
  });
});
