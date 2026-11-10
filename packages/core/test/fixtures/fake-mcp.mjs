// A stand-in MCP server over stdio for tests: two tools, one that only reads and one that writes.
// `notes` reports whether FAKE_TOKEN reached it and whether a variable Serai must not pass on did.
import { createInterface } from 'node:readline';

const notes = [];
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
process.stdout.write('a log line that is not JSON\n');

createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  const reply = (result) => send({ jsonrpc: '2.0', id: m.id, result });
  switch (m.method) {
    case 'initialize':
      return reply({
        protocolVersion: m.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-notes', version: '1.2.3' },
      });
    case 'tools/list':
      return reply({
        tools: [
          {
            name: 'list_notes',
            description: 'Lists the notes.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true },
          },
          {
            name: 'add_note',
            description: 'Adds a note.',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          },
        ],
      });
    case 'tools/call': {
      const { name, arguments: args } = m.params;
      if (name === 'add_note') {
        notes.push(String(args.text));
        return reply({ content: [{ type: 'text', text: `added: ${args.text}` }] });
      }
      if (name === 'list_notes') {
        const env = `token=${process.env.FAKE_TOKEN ?? 'none'} leaked=${process.env.GITHUB_TOKEN ? 'yes' : 'no'}`;
        return reply({ content: [{ type: 'text', text: `${notes.join(', ') || 'no notes'} (${env})` }] });
      }
      return send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: `unknown tool ${name}` } });
    }
    default:
      return send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not found' } });
  }
});
