// The core's view of model providers. In the app the main process answers (it holds the keys); tests pass a fake.
import type { LlmRequest, LlmResult, ProvidersState } from '@lonca/protocol';

export interface Llm {
  state(): ProvidersState;
  onChange(listener: (state: ProvidersState) => void): void;
  complete(req: LlmRequest, opts?: { signal?: AbortSignal; onDelta?: (text: string) => void }): Promise<LlmResult>;
}

export class LlmError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'LlmError';
  }
}

/** No providers: what the core uses when nothing else is given. */
export const noLlm: Llm = {
  state: () => ({ providers: [], protection: 'none' }),
  onChange: () => {},
  complete: () => Promise.reject(new LlmError('provider_no_key')),
};

/** The core side of the main process's provider service, over the utility process's parent port. */
export class PortLlm implements Llm {
  private current: ProvidersState = { providers: [], protection: 'none' };
  private readonly listeners: ((state: ProvidersState) => void)[] = [];
  private readonly pending = new Map<
    number,
    { resolve: (r: LlmResult) => void; reject: (e: Error) => void; onDelta?: (text: string) => void }
  >();
  private next = 1;

  constructor(private readonly post: (message: unknown) => void) {}

  /** Feed every message from the parent port here; returns whether it was a provider message. */
  receive(m: unknown): boolean {
    const msg = m as {
      type?: string;
      id?: number;
      state?: ProvidersState;
      text?: string;
      result?: LlmResult;
      code?: string;
      message?: string;
    };
    switch (msg?.type) {
      case 'providers':
        if (msg.state) {
          this.current = msg.state;
          for (const l of this.listeners) l(msg.state);
        }
        return true;
      case 'llm:delta':
        this.pending.get(msg.id ?? 0)?.onDelta?.(msg.text ?? '');
        return true;
      case 'llm:done': {
        const p = this.pending.get(msg.id ?? 0);
        this.pending.delete(msg.id ?? 0);
        if (p && msg.result) p.resolve(msg.result);
        return true;
      }
      case 'llm:error': {
        const p = this.pending.get(msg.id ?? 0);
        this.pending.delete(msg.id ?? 0);
        p?.reject(new LlmError(msg.code ?? 'internal', msg.message));
        return true;
      }
      default:
        return false;
    }
  }

  state(): ProvidersState {
    return this.current;
  }

  onChange(listener: (state: ProvidersState) => void): void {
    this.listeners.push(listener);
  }

  complete(req: LlmRequest, opts: { signal?: AbortSignal; onDelta?: (text: string) => void } = {}): Promise<LlmResult> {
    const id = this.next++;
    return new Promise<LlmResult>((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new LlmError('provider_cancelled'));
      this.pending.set(id, { resolve, reject, ...(opts.onDelta ? { onDelta: opts.onDelta } : {}) });
      opts.signal?.addEventListener('abort', () => this.post({ type: 'llm:cancel', id }), { once: true });
      this.post({ type: 'llm', id, req, ...(opts.onDelta ? { stream: true } : {}) });
    });
  }
}
