// Entry for Electron's main process: providers and their keys, without the rest of the core.
export {
  type CompleteOptions,
  complete,
  type Endpoint,
  listModels,
  ProviderError,
  type ProviderErrorCode,
  parseModels,
} from './client.js';
export { type Cipher, ProviderVault } from './vault.js';
