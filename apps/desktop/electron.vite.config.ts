import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Workspace packages are TypeScript sources: bundle them instead of loading them from node_modules.
const WORKSPACE = ['@lonca/core', '@lonca/protocol', '@lonca/ui'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: WORKSPACE },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          core: resolve('src/core/index.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: WORKSPACE },
      rollupOptions: {
        // Sandboxed preloads cannot be ES modules.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve('src/renderer/index.html') },
    },
  },
});
