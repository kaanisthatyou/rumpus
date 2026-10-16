// The page's connection to the core: a MessagePort handed over by the preload script after every load.
import {
  type CoreEvents,
  type ErrorCode,
  type EventName,
  type Frame,
  isNotice,
  isResponse,
  type MethodName,
  type Params,
  type Result,
} from '@lonca/protocol';

export class RpcError extends Error {
  constructor(
    readonly code: ErrorCode | 'core_offline',
    message: string,
  ) {
    super(message);
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: RpcError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const CALL_TIMEOUT_MS = 30_000;

class CoreClient {
  private port: MessagePort | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly queue: Frame[] = [];
  private readonly listeners = new Map<string, Set<(data: unknown) => void>>();
  private readonly connectListeners = new Set<() => void>();

  constructor() {
    window.addEventListener('message', (event) => {
      if (event.source !== window || (event.data as { lonca?: unknown } | null)?.lonca !== 'port') return;
      const port = event.ports[0];
      if (port) this.attach(port);
    });
  }

  private attach(port: MessagePort): void {
    this.port?.close();
    this.port = port;
    port.onmessage = (e) => this.receive(e.data);
    port.start();
    for (const frame of this.queue.splice(0)) port.postMessage(frame);
    for (const l of this.connectListeners) l();
  }

  private receive(frame: unknown): void {
    if (isResponse(frame)) {
      const p = this.pending.get(frame.id);
      if (!p) return;
      this.pending.delete(frame.id);
      clearTimeout(p.timer);
      if ('error' in frame) p.reject(new RpcError(frame.error.code, frame.error.message));
      else p.resolve(frame.result);
    } else if (isNotice(frame)) {
      for (const l of this.listeners.get(frame.event) ?? []) l(frame.data);
    }
  }

  /** Runs whenever a (new) connection to the core is ready, e.g. after the core restarted. */
  onConnect(listener: () => void): () => void {
    this.connectListeners.add(listener);
    return () => this.connectListeners.delete(listener);
  }

  call<M extends MethodName>(method: M, params?: Params<M>): Promise<Result<M>> {
    const id = this.nextId++;
    const frame: Frame = { id, method, params };
    return new Promise<Result<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError('core_offline', method));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      if (this.port) this.port.postMessage(frame);
      else this.queue.push(frame);
    });
  }

  on<E extends EventName>(event: E, listener: (data: CoreEvents[E]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const l = listener as (data: unknown) => void;
    set.add(l);
    return () => set.delete(l);
  }
}

export const core = new CoreClient();
