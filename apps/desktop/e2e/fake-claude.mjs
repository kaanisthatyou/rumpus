#!/usr/bin/env node
// A stand-in for Claude Code in tests: the same CLI surface Lonca uses (--version, auth status --json, and the
// stream-json conversation), without a model or an account. A message with "slow" or "yavaş" takes seconds,
// so a test can steer or stop it. Messages sent during a turn wait as turns of their own, like the real CLI.
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('9.9.9 (Claude Code)');
  process.exit(0);
}
if (args[0] === 'auth') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' }));
  process.exit(0);
}

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resume = args.indexOf('--resume');
const session = resume >= 0 ? args[resume + 1] : `fake-${Date.now()}`;
const queue = [];
let started = false;
let busy = false;
let n = 0;

createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  queue.push(msg.message.content.map((b) => b.text ?? '').join(''));
  if (!busy) void run();
});

async function run() {
  busy = true;
  while (queue.length > 0) {
    const text = queue.shift();
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
