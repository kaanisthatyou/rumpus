#!/usr/bin/env node
// A stand-in for Claude Code in tests: the same CLI surface Rumpus uses (--version, auth status --json, and the
// stream-json conversation), without a model or an account. A message with "slow" or "yavaş" takes seconds,
// so a test can steer or stop it. Messages sent during a turn wait as turns of their own, like the real CLI.
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('9.9.9 (Claude Code)');
  process.exit(0);
}
if (args[0] === 'auth') {
  // An extra account (its own config folder) is signed out until its own login ran.
  console.log(
    JSON.stringify(
      process.env.CLAUDE_CONFIG_DIR
        ? { loggedIn: false }
        : { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' },
    ),
  );
  process.exit(0);
}

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resume = args.indexOf('--resume');
const session = resume >= 0 ? args[resume + 1] : `fake-${Date.now()}`;
const queue = [];
// Rumpus's MCP endpoint, as Claude Code would get it from --mcp-config.
const mcpAt = args.indexOf('--mcp-config');
const mcp = mcpAt >= 0 ? JSON.parse(args[mcpAt + 1]).mcpServers?.rumpus : undefined;
let rpcId = 0;
async function callTool(name, toolArgs) {
  const res = await fetch(mcp.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...mcp.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: toolArgs } }),
  });
  const body = await res.json();
  return body.result?.content?.map((c) => c.text ?? '').join(String.fromCharCode(10)) ?? `error ${res.status}`;
}
async function listTools() {
  const res = await fetch(mcp.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...mcp.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/list', params: {} }),
  });
  return ((await res.json()).result?.tools ?? []).map((t) => t.name);
}
async function callAndShow(id, name, toolArgs) {
  out({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name: `mcp__rumpus__${name}`, input: toolArgs }] },
  });
  const result = await callTool(name, toolArgs);
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: result }] } });
  return result;
}
let started = false;
let busy = false;
let n = 0;

// Answers to permission questions (control_request can_use_tool), by request id.
const waiting = new Map();
const canAsk = args.includes('--permission-prompt-tool');
let asked = 0;
function ask(toolUseId, input) {
  const id = `q${++asked}`;
  out({
    type: 'control_request',
    request_id: id,
    request: {
      subtype: 'can_use_tool',
      tool_name: 'Bash',
      input,
      description: 'Build the project',
      tool_use_id: toolUseId,
    },
  });
  return new Promise((resolve) => waiting.set(id, resolve));
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.type === 'control_response') {
    const id = msg.response?.request_id;
    waiting.get(id)?.(msg.response?.response?.behavior === 'allow');
    waiting.delete(id);
    return;
  }
  queue.push(msg.message.content.map((b) => b.text ?? '').join(''));
  if (!busy) void run();
});

async function run() {
  busy = true;
  while (queue.length > 0) {
    const text = queue.shift();
    if (canAsk && /onay iste/i.test(text)) {
      // A command that needs approval: ask Rumpus, then go on with its answer.
      n += 1;
      if (!started) {
        out({ type: 'system', subtype: 'init', session_id: session, tools: ['Bash'] });
        started = true;
      }
      const input = { command: 'npm run build' };
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `a${n}`, name: 'Bash', input }] } });
      const allowed = await ask(`a${n}`, input);
      out({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: `a${n}`, content: allowed ? 'built' : 'denied', is_error: !allowed },
          ],
        },
      });
      const answer = allowed ? 'Derleme tamam.' : 'Derleme reddedildi, komut çalıştırılmadı.';
      out({ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } });
      out({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: answer,
        total_cost_usd: 0,
        usage: { input_tokens: 5, output_tokens: 5 },
        queued_turn_count: queue.length,
      });
      continue;
    }
    if (/dosyaları düzenle/i.test(text)) {
      // Work on files in the agent's folder: a line added to README.md and a new file.
      n += 1;
      if (!started) {
        out({ type: 'system', subtype: 'init', session_id: session, tools: ['Edit', 'Write'] });
        started = true;
      }
      const edits = [
        ['Edit', 'README.md', () => appendFileSync('README.md', 'e2e satırı' + String.fromCharCode(10))],
        ['Write', 'yeni.txt', () => writeFileSync('yeni.txt', 'ajanın yazdığı dosya' + String.fromCharCode(10))],
      ];
      for (const [tool, file, apply] of edits) {
        const id = `f${n}${tool}`;
        out({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id, name: tool, input: { file_path: file } }] },
        });
        apply();
        out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
      }
      const answer = 'Dosyalar düzenlendi.';
      out({ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } });
      out({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: answer,
        total_cost_usd: 0,
        usage: { input_tokens: 8, output_tokens: 4 },
        queued_turn_count: queue.length,
      });
      continue;
    }
    if (mcp && /panoyu güncelle/i.test(text)) {
      // The board through Rumpus's tools: list the cards, move the first one to done, leave a note.
      n += 1;
      if (!started) {
        out({ type: 'system', subtype: 'init', session_id: session, tools: ['mcp__rumpus__list_cards'] });
        started = true;
      }
      const cards = await callAndShow(`l${n}`, 'list_cards', {});
      const first = cards.split(String.fromCharCode(10))[0]?.split(' · ')[0];
      if (first) await callAndShow(`u${n}`, 'update_card', { id: first, status: 'done' });
      await callAndShow(`p${n}`, 'post_progress', { text: 'Pano güncellendi' });
      const answer = first ? `Kart ${first} bitti olarak işaretlendi.` : 'Pano boş.';
      out({ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } });
      out({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: answer,
        total_cost_usd: 0,
        usage: { input_tokens: 10, output_tokens: 5 },
        queued_turn_count: queue.length,
      });
      continue;
    }
    if (mcp && /bağlayıcıya not ekle/i.test(text)) {
      // A connector served through Rumpus: add a note (its policy asks a person), then list the notes.
      n += 1;
      if (!started) {
        out({ type: 'system', subtype: 'init', session_id: session, tools: ['mcp__rumpus__list_cards'] });
        started = true;
      }
      const tools = await listTools();
      const add = tools.find((t) => t.endsWith('__add_note'));
      const list = tools.find((t) => t.endsWith('__list_notes'));
      if (add) await callAndShow(`c${n}`, add, { text: 'e2e notu' });
      const notes = list ? await callAndShow(`d${n}`, list, {}) : 'bağlayıcı yok';
      const answer = `Notlar: ${notes}`;
      out({ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } });
      out({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: answer,
        total_cost_usd: 0,
        usage: { input_tokens: 10, output_tokens: 5 },
        queued_turn_count: queue.length,
      });
      continue;
    }
    // The request is the last line; what comes before it is the channel's history.
    const request = text.split(String.fromCharCode(10)).pop() ?? '';
    if (mcp && /değişikliği incele/i.test(request)) {
      // A specialist's job: keep a lesson when it may, say what it saw of the channel, end with a RESULT line.
      n += 1;
      if (!started) {
        out({ type: 'system', subtype: 'init', session_id: session, tools: ['Read'] });
        started = true;
      }
      const tools = await listTools();
      if (tools.includes('learn_lesson')) {
        await callAndShow(`k${n}`, 'learn_lesson', { lesson: 'Bu projede testler `npm test` ile çalışır.' });
      }
      const saw = /e-posta doğrulaması/.test(text) ? 'Kanalda e-posta doğrulamasından söz edilmiş.' : 'Kanal boş.';
      const answer = [
        'Bir bulgu var: `README.md` güncel değil.',
        '',
        saw,
        '',
        'RESULT {"ok": false, "blockers": 0, "findings": 1}',
      ].join(String.fromCharCode(10));
      out({ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } });
      out({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: answer,
        total_cost_usd: 0,
        usage: { input_tokens: 900, output_tokens: 80 },
        queued_turn_count: queue.length,
      });
      continue;
    }
    if (mcp && /durumu güncelle/i.test(text)) {
      // The project's status page through Rumpus's tools: read it, tick every milestone, rewrite where it stands.
      n += 1;
      if (!started) {
        out({ type: 'system', subtype: 'init', session_id: session, tools: ['mcp__rumpus__read_status'] });
        started = true;
      }
      const page = await callAndShow(`r${n}`, 'read_status', {});
      const milestones = [...page.matchAll(/- \[[ x]\] (.+)/g)].map((m) => ({ text: m[1], done: true }));
      await callAndShow(`s${n}`, 'update_status', {
        left_off: 'Sahte ajan durumu güncelledi.',
        ...(milestones.length ? { milestones } : {}),
      });
      const answer = `Durum sayfası güncellendi (${milestones.length} kilometre taşı).`;
      out({ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } });
      out({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: answer,
        total_cost_usd: 0,
        usage: { input_tokens: 10, output_tokens: 5 },
        queued_turn_count: queue.length,
      });
      continue;
    }
    // Goal mode: a two-step plan, then each step's report; the last step says the goal is done.
    const goalStep = /GOAL MODE: STEP (\d+) of (\d+)/.exec(text);
    if (/GOAL MODE: PLAN/.test(text) || goalStep) {
      n += 1;
      if (!started) {
        out({ type: 'system', subtype: 'init', session_id: session, tools: ['Read'] });
        started = true;
      }
      const heard = /Comments from/.test(text) ? ' (yorum alındı)' : '';
      const answer = goalStep
        ? `Adım ${goalStep[1]} bitti${heard}.${goalStep[1] === goalStep[2] ? '\nGOAL_DONE' : ''}`
        : '1. Formu yaz\n2. Testleri ekle';
      await sleep(200);
      out({ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } });
      out({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: answer,
        total_cost_usd: 0,
        usage: { input_tokens: 800, output_tokens: 60 },
        queued_turn_count: queue.length,
      });
      continue;
    }
    const slow = /yavaş|slow/i.test(text);
    n += 1;
    if (!started) {
      out({ type: 'system', subtype: 'init', session_id: session, tools: ['Read', 'Bash'] });
      started = true;
    }
    out({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.37 },
    });
    out({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', rateLimitType: 'seven_day', utilization: 0.18 },
    });
    out({
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: { usage: { input_tokens: 1200, cache_creation_input_tokens: 300, cache_read_input_tokens: 8800 } },
      },
    });
    out({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: `r${n}`, name: 'Read', input: { file_path: `${process.cwd()}/README.md` } }],
      },
    });
    await sleep(slow ? 1500 : 150);
    out({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: `r${n}`, content: '# Fake project' }] },
    });
    out({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: `b${n}`, name: 'Bash', input: { command: 'npm test' } }] },
    });
    await sleep(slow ? 5000 : 150);
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `b${n}`, content: '14 passed' }] } });
    const last = text.split('\n').pop() ?? '';
    const answer = `README bir **sahte proje** anlatıyor.\n\n- İstek: _${last.slice(0, 80)}_\n- Test: \`14 passed\``;
    for (const part of answer.match(/[\s\S]{1,14}/g) ?? []) {
      out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: part } } });
      await sleep(25);
    }
    out({ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } });
    out({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 420 } } });
    out({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: answer,
      total_cost_usd: 0.0042 * n,
      usage: {
        input_tokens: 1200,
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 8800,
        output_tokens: 420,
      },
      queued_turn_count: queue.length,
    });
  }
  busy = false;
}
