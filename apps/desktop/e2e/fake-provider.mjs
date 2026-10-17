// A stand-in OpenAI-compatible provider for the e2e tests: `GET /v1/models` and streamed
// `POST /v1/chat/completions`. Only the key `sk-test-good` is accepted. `answer(body)` decides the reply text.
import { createServer } from 'node:http';

export async function startFakeProvider(answer = () => 'Tamam.') {
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const auth = req.headers.authorization ?? '';
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ path: req.url, body });
    if (auth !== 'Bearer sk-test-good') {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":{"message":"bad key"}}');
      return;
    }
    if (req.url === '/v1/models') {
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'fake-small' }, { id: 'fake-large' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      const text = String(await answer(body));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const part of text.match(/.{1,12}/gs) ?? []) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  return { url, requests, close: () => new Promise((r) => server.close(r)) };
}
