import { describe, expect, it } from 'vitest';
import {
  type AgentTurn,
  addAnswer,
  addMine,
  KEEP,
  setLines,
  type Turn,
  updateJob,
  view,
} from '../src/renderer/src/shell/island-feed';
import { plain } from '../src/renderer/src/shell/island-text';

describe('island text', () => {
  it('leaves code blocks and Markdown marks out', () => {
    const text =
      'README bir **sahte proje** anlatıyor.\n\n```powershell\nGet-ChildItem -Recurse\n```\n\n- İstek: _not_\n- Test: `14 passed`';
    expect(plain(text)).toBe('README bir sahte proje anlatıyor.\n\n- İstek: not\n- Test: 14 passed');
  });

  it('drops an unfinished code block of a streaming answer', () => {
    expect(plain('Komut:\n```bash\nnpm te')).toBe('Komut:');
  });

  it('keeps underscores inside words and list stars', () => {
    expect(plain('snake_case_name\n* madde')).toBe('snake_case_name\n* madde');
  });
});

describe('island feed', () => {
  const job = (id: string, started: number, state: 'running' | 'done' = 'running', live?: string) => ({
    id,
    state,
    started,
    requestId: `m${id.slice(1)}`,
    ...(live ? { live } : {}),
  });

  it('keeps a job in the place it started however often it changes', () => {
    let list: Turn[] = [];
    list = addMine(list, { id: 'm1', at: 100, where: '#genel', text: '@claude bak' });
    list = updateJob(list, job('j1', 110), 'Claude', '#genel');
    list = addMine(list, { id: 'm2', at: 120, where: '#genel', text: '@kod de bak' });
    list = updateJob(list, job('j2', 130), 'Kod', '#genel');
    list = updateJob(list, job('j1', 110, 'running', 'okuyorum'), 'Claude', '#genel');
    list = setLines(list, 'j1', ['ilk not']);
    list = updateJob(list, job('j1', 110, 'running', 'ikinci'), 'Claude', '#genel');
    expect(list.map((x) => x.key)).toEqual(['m:m1', 'j:j1', 'm:m2', 'j:j2']);
    const first = list[1] as AgentTurn;
    expect(view(first)).toEqual({ main: 'ikinci', notes: ['ilk not'] });
  });

  it('puts the answer in its job and does not repeat it among the notes', () => {
    let list: Turn[] = updateJob([], job('j1', 10, 'running', 'yazıyor'), 'Claude', '#genel');
    list = setLines(list, 'j1', ['bakıyorum', 'Cevap burada.']);
    list = addAnswer(list, { id: 'a1', jobId: 'j1', at: 50, who: 'Claude', where: '#genel', text: 'Cevap burada.' });
    list = updateJob(list, job('j1', 10, 'done'), 'Claude', '#genel');
    expect(list).toHaveLength(1);
    const turn = list[0] as AgentTurn;
    expect(turn.state).toBe('done');
    expect(turn.live).toBeUndefined();
    expect(view(turn)).toEqual({ main: 'Cevap burada.', notes: ['bakıyorum'] });
  });

  it('puts the answer below a message that went into a job already running', () => {
    let list: Turn[] = updateJob([], job('j1', 10), 'Claude', '#genel');
    list = addMine(list, { id: 'later', at: 20, where: '#genel', text: '@claude bir de bunu' });
    list = addAnswer(list, { id: 'a1', jobId: 'j1', at: 30, who: 'Claude', where: '#genel', text: 'ikisi de tamam' });
    expect(list.map((x) => x.key)).toEqual(['m:later', 'j:j1']);
    expect(list[1]?.at).toBe(30);
  });

  it('fills a name that was not known when the job first showed', () => {
    let list: Turn[] = updateJob([], job('j1', 10), '', '');
    list = updateJob(list, job('j1', 10, 'running', 'yazıyor'), 'Claude', '#genel');
    expect(list[0]).toMatchObject({ who: 'Claude', where: '#genel' });
  });

  it('lets an answer of an unknown job stand alone, once', () => {
    const answer = { id: 'a1', jobId: 'x', at: 5, who: 'Claude', where: '#genel', text: 'tamam' };
    const list = addAnswer(addAnswer([], answer), answer);
    expect(list.map((x) => x.key)).toEqual(['a:a1']);
  });

  it('keeps the newest turns only', () => {
    let list: Turn[] = [];
    for (let i = 0; i < KEEP + 5; i++) list = addMine(list, { id: String(i), at: i, where: '#g', text: 't' });
    expect(list).toHaveLength(KEEP);
    expect(list[0]?.key).toBe('m:5');
  });
});
