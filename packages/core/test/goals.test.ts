import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent, Channel, Goal, Job } from '@lonca/protocol';
import { describe, expect, it } from 'vitest';
import { Goals, parsePlan } from '../src/goals.js';
import { newId } from '../src/ids.js';
import { WorkspaceStore } from '../src/store.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5));
};

function setup(checks: boolean[] = []) {
  const store = new WorkspaceStore(join(tmp('lonca-goal-'), 'lonca.db'), 'dev');
  const channel: Channel = { id: 'c1', name: 'genel', kind: 'channel', topic: '', created: 1 };
  const agent: Agent = {
    id: 'ag',
    kind: 'claude-code',
    name: 'Claude',
    handle: 'claude',
    folder: tmp('lonca-goal-work-'),
    mode: 'edit',
    instructions: '',
    created: 1,
  };
  store.commit({ type: 'channel.created', data: channel });
  store.commit({ type: 'agent.saved', data: agent });
  const started: { prompt: string; job: Job }[] = [];
  const stopped: string[] = [];
  const steps: string[] = [];
  let busy = false;
  let now = 1_000_000;
  const goals = new Goals({
    store,
    jobs: {
      startWith: async (a, c, request, prompt) => {
        const job: Job = {
          id: newId(),
          channelId: c.id,
          agentId: a.id,
          requestId: request.id,
          state: 'running',
          steps: [],
          usage: { in: 0, cached: 0, out: 0 },
          started: now,
        };
        started.push({ prompt, job });
        return job;
      },
      busy: () => busy,
      stop: (id) => {
        stopped.push(id);
        return true;
      },
    },
    me: () => ({ id: 'dev', name: 'Kaan', language: 'tr' }),
    emitGoal: () => {},
    emitMessage: () => {},
    runCheck: async () => ({ ok: checks.shift() ?? true, output: 'FAIL src/a.test.ts' }),
    onStep: (_g, step) => steps.push(step.text),
    now: () => now,
    retryMs: 5,
  });
  /** The latest job ends with an answer. */
  const finish = (text: string, state: Job['state'] = 'done') => {
    const last = started.at(-1);
    if (!last) throw new Error('no job');
    now += 60_000;
    store.commit({
      type: 'message.posted',
      data: {
        id: newId(),
        channelId: 'c1',
        author: { kind: 'agent', id: 'ag', name: 'Claude' },
        text,
        created: now,
        jobId: last.job.id,
      },
    });
    goals.onJob({ ...last.job, state, ended: now, usage: { in: 1000, cached: 50, out: 200 } });
  };
  const goal = () => goals.list()[0] as Goal;
  return {
    store,
    goals,
    started,
    stopped,
    steps,
    finish,
    goal,
    setBusy: (b: boolean) => {
      busy = b;
    },
  };
}

const input = (over: Record<string, unknown> = {}) => ({
  channelId: 'c1',
  agentId: 'ag',
  text: 'Login ekranını bitir',
  budget: { steps: 10, minutes: 60 },
  check: 'pnpm test',
  ...over,
});

describe('parsePlan', () => {
  it('reads numbered lists, falls back to bullets, drops the rest', () => {
    expect(parsePlan('Plan:\n1. Formu yaz\n2) **Testleri** ekle\n\nNot: hızlı')).toEqual([
      'Formu yaz',
      'Testleri ekle',
    ]);
    expect(parsePlan('- a\n* b')).toEqual(['a', 'b']);
    expect(parsePlan('Plan yok')).toEqual([]);
  });
});

describe('Goals', () => {
  it('plans, waits for approval with comments, runs steps with the check, and finishes', async () => {
    const t = setup([false, true]);
    const created = t.goals.create(input());
    expect(created.state).toBe('planning');
    expect(t.store.message(created.requestId)?.text).toBe('/goal Login ekranını bitir');
    await settle();
    expect(t.started[0]?.prompt).toContain('GOAL MODE: PLAN');
    expect(t.started[0]?.prompt).toContain('pnpm test');

    t.finish('Plan:\n1. Formu yaz\n2. Testleri ekle');
    expect(t.goal().state).toBe('review');
    expect(t.goal().steps.map((s) => s.text)).toEqual(['Formu yaz', 'Testleri ekle']);
    expect(t.goal().used.tokens).toBe(1200);

    const second = t.goal().steps[1]?.id;
    t.goals.approve(t.goal().id, [{ stepId: second, text: 'Vitest kullan' }, { text: 'Kısa tut' }, { text: '  ' }]);
    expect(t.goal().comments).toHaveLength(2);
    await settle();
    expect(t.started[1]?.prompt).toContain('GOAL MODE: STEP 1 of 2');
    expect(t.started[1]?.prompt).toContain('on step 2: Vitest kullan');
    expect(t.started[1]?.prompt).toContain('on the plan: Kısa tut');

    // Step 1 done, the check fails, step 2 hears about it.
    t.finish('Form yazıldı.');
    await settle();
    expect(t.goal().lastCheck?.ok).toBe(false);
    expect(t.steps).toEqual(['Formu yaz']);
    expect(t.started[2]?.prompt).toContain('GOAL MODE: STEP 2 of 2');
    expect(t.started[2]?.prompt).toContain('FAIL src/a.test.ts');

    // Step 2 done, the check passes: the goal is done.
    t.finish('Testler eklendi.');
    await settle();
    expect(t.goal().state).toBe('done');
    expect(t.goal().used.steps).toBe(2);
  });

  it('pauses on the step budget and goes on with more', async () => {
    const t = setup();
    t.goals.create(input({ budget: { steps: 1, minutes: 60 }, check: '' }));
    await settle();
    t.finish('1. a\n2. b');
    t.goals.approve(t.goal().id, []);
    await settle();
    t.finish('a bitti');
    await settle();
    expect(t.goal().state).toBe('paused');
    expect(t.goal().pause).toBe('budget_steps');
    expect(() => t.goals.approve(t.goal().id, [])).toThrow('goal_state');

    t.goals.resume(t.goal().id, { steps: 5 });
    await settle();
    expect(t.goal().budget.steps).toBe(6);
    expect(t.started.at(-1)?.prompt).toContain('STEP 2 of 2');
    t.finish('b bitti');
    await settle();
    expect(t.goal().state).toBe('done');
  });

  it('finishes early on GOAL_DONE with a passing check, and adds a fix step when the plan ends with a failing one', async () => {
    const t = setup([true]);
    t.goals.create(input());
    await settle();
    t.finish('1. a\n2. b\n3. c');
    t.goals.approve(t.goal().id, []);
    await settle();
    t.finish('Hepsi zaten yapılmış.\nGOAL_DONE');
    await settle();
    expect(t.goal().state).toBe('done');

    const u = setup([false, true]);
    u.goals.create(input());
    await settle();
    u.finish('1. tek adım');
    u.goals.approve(u.goal().id, []);
    await settle();
    u.finish('yapıldı');
    await settle();
    expect(u.goal().steps.at(-1)).toMatchObject({ fix: true, state: 'running' });
    expect(u.started.at(-1)?.prompt).toContain('make the done check pass');
    u.finish('düzeltildi');
    await settle();
    expect(u.goal().state).toBe('done');
  });

  it('waits while the agent is busy, pauses when a step fails, stops on request, and recovers after a restart', async () => {
    const t = setup();
    t.setBusy(true);
    t.goals.create(input({ check: '' }));
    await settle();
    expect(t.started).toHaveLength(0);
    t.setBusy(false);
    await settle();
    expect(t.started).toHaveLength(1);
    t.finish('1. a\n2. b');
    t.goals.approve(t.goal().id, []);
    await settle();
    t.finish('olmadı', 'failed');
    expect(t.goal()).toMatchObject({ state: 'paused', pause: 'job_failed' });
    t.goals.resume(t.goal().id);
    await settle();
    expect(t.goal().steps[0]?.state).toBe('running');
    const running = t.started.at(-1)?.job.id;
    t.goals.stop(t.goal().id);
    expect(t.goal().state).toBe('stopped');
    expect(t.stopped).toEqual([running]);

    const u = setup();
    u.goals.create(input({ check: '' }));
    await settle();
    u.goals.recover();
    expect(u.goal()).toMatchObject({ state: 'paused', pause: 'interrupted' });
    expect(() => u.goals.create(input({ text: 'ikinci' }))).not.toThrow();
  });

  it('refuses bad input and a second open goal for the same agent', () => {
    const t = setup();
    expect(() => t.goals.create(input({ agentId: 'nope' }))).toThrow(expect.objectContaining({ code: 'invalid_goal' }));
    expect(() => t.goals.create(input({ text: '  ' }))).toThrow(expect.objectContaining({ code: 'invalid_goal' }));
    expect(() => t.goals.create(input({ check: 'a\nb' }))).toThrow(expect.objectContaining({ code: 'invalid_goal' }));
    expect(() => t.goals.create(input({ budget: { steps: 5, minutes: 10, tokens: 5 } }))).toThrow(
      expect.objectContaining({ code: 'invalid_goal' }),
    );
    t.goals.create(input());
    expect(() => t.goals.create(input())).toThrow('busy');
  });
});
