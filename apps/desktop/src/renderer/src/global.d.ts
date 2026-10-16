import type { LoncaBridge } from '../../shared/bridge';

declare global {
  interface Window {
    lonca: LoncaBridge;
  }
}
