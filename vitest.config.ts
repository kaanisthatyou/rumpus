import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'scripts/test/**/*.test.ts'],
    environment: 'node',
    // Generous: on Windows a full parallel run spawns many processes (git, signing) and slow tests get starved.
    testTimeout: 45_000,
  },
});
