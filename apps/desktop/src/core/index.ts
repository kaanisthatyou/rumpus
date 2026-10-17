// Entry of the core utility process. The main process sends one MessagePort per window; each becomes a peer.
import { Core, PortLlm } from '@lonca/core';
import type { Frame } from '@lonca/protocol';
import type { MessagePortMain } from 'electron';

const appDir = process.env.LONCA_APP_DIR;
if (!appDir) throw new Error('LONCA_APP_DIR is not set');
const locale = (process.env.LONCA_LOCALE ?? 'en').toLowerCase();

// Model providers are served by the main process, which holds their keys.
const llm = new PortLlm((m) => process.parentPort.postMessage(m));
const core = new Core({ appDir, language: locale.startsWith('tr') ? 'tr' : 'en', llm });

process.parentPort.on('message', (event: { data: unknown; ports: MessagePortMain[] }) => {
  const port = event.ports[0];
  if (!port) {
    llm.receive(event.data);
    return;
  }
  let listener: (frame: unknown) => void = () => {};
  port.on('message', (e) => listener(e.data));
  core.attach({
    send: (frame: Frame) => port.postMessage(frame),
    onFrame: (l) => {
      listener = l;
    },
    onClose: (l) => port.on('close', l),
  });
  port.start();
});
