// Bundles the keeper into one file that runs on Node 22.13 or later (node:sqlite without a flag), on any platform
// and architecture: no native modules, nothing to install next to it.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/keeper.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // cross-spawn is CommonJS and requires Node's own modules.
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __keeperRequire } from 'node:module';\nconst require = __keeperRequire(import.meta.url);",
  },
  define: { KEEPER_VERSION: JSON.stringify(version) },
  legalComments: 'none',
  logLevel: 'info',
});
