// Entry of the core utility process. The main process sends one MessagePort per window; each becomes a peer.
import { Core, PortLlm, PortSealer, PortSigner } from '@lonca/core';
import type { Frame } from '@lonca/protocol';
import type { MessagePortMain } from 'electron';

const appDir = process.env.LONCA_APP_DIR;
if (!appDir) throw new Error('LONCA_APP_DIR is not set');
const locale = (process.env.LONCA_LOCALE ?? 'en').toLowerCase();

// Model providers are served by the main process, which holds their keys.
const llm = new PortLlm((m) => process.parentPort.postMessage(m));
// The device key signs in the main process too.
const signer = new PortSigner((m) => process.parentPort.postMessage(m));
// Connectors' secrets are sealed there as well.
const sealer = new PortSealer((m) => process.parentPort.postMessage(m));
// Other members reach this app on its Tailscale address; tests point two apps at loopback instead.
const peerHost = process.env.LONCA_PEER_HOST;
const core = new Core({
  appDir,
  ...(process.env.LONCA_DESKTOP_DIR ? { desktopDir: process.env.LONCA_DESKTOP_DIR } : {}),
  language: locale.startsWith('tr') ? 'tr' : 'en',
  llm,
  signer,
  sealer,
  // Tests search a stand-in registry on loopback instead of the official one.
  ...(process.env.LONCA_REGISTRY_URL ? { registry: process.env.LONCA_REGISTRY_URL } : {}),
  ...(peerHost ? { peer: { host: peerHost, port: Number(process.env.LONCA_PEER_PORT) || 0 } } : {}),
  // Phones: the built UI; tests serve it on a loopback port without tailscale serve.
  web: {
    ...(process.env.LONCA_WEB_DIR ? { dir: process.env.LONCA_WEB_DIR } : {}),
    ...(process.env.LONCA_PHONE_PORT !== undefined
      ? { port: Number(process.env.LONCA_PHONE_PORT) || 0, https: false }
      : {}),
  },
});

process.parentPort.on('message', (event: { data: unknown; ports: MessagePortMain[] }) => {
  const port = event.ports[0];
  if (!port) {
    if (!llm.receive(event.data) && !signer.receive(event.data)) sealer.receive(event.data);
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
