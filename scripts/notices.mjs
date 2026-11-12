// Writes apps/desktop/build/THIRD-PARTY-NOTICES.txt: the name, version, license and license text of every package
// whose code or fonts end up inside the app (PLAN.md, principle 6: open-source code only with its license notice).
// The bundler strips license comments and leaves no node_modules in the package, so the notices travel as one
// file next to the app. Electron's and Chromium's own notices ship with Electron.
// Usage: node scripts/notices.mjs   (run by `pnpm dist` and the release workflow)
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'apps/desktop/build/THIRD-PARTY-NOTICES.txt');

/** Packages that build, test or type the app but put nothing of their own into it. */
const TOOLS = [
  /^@types\//,
  /^@vitejs\//,
  /^@biomejs\//,
  /^electron$/,
  /^electron-builder$/,
  /^electron-vite$/,
  /^vite$/,
  /^vitest$/,
  /^typescript$/,
  /^playwright-core$/,
  /^@resvg\//,
];
const isTool = (name) => TOOLS.some((t) => t.test(name)) || name.startsWith('@lonca/');

const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** The `node_modules` folder a package's own dependencies are found in (pnpm keeps them beside the package). */
function siblings(dir) {
  const parts = realpathSync(dir).split(sep);
  const at = parts.lastIndexOf('node_modules');
  return at < 0 ? undefined : parts.slice(0, at + 1).join(sep);
}

function licenseText(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying|ofl)(\.(md|txt))?$/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : undefined;
}

const seen = new Map();
function take(dir) {
  const pkg = read(join(dir, 'package.json'));
  const id = `${pkg.name}@${pkg.version}`;
  if (seen.has(id)) return;
  const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'see the package');
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  seen.set(id, {
    name: pkg.name,
    version: pkg.version,
    license,
    home: pkg.homepage ?? repo ?? '',
    text: licenseText(dir),
  });
  const modules = siblings(dir);
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    const next = modules && join(modules, dep);
    if (next && existsSync(join(next, 'package.json'))) take(next);
    else throw new Error(`${id}: dependency ${dep} was not found; run pnpm install`);
  }
}

// What the app is made of: the desktop app's and the packages' dependencies, without the tools.
for (const workspace of ['apps/desktop', 'packages/core', 'packages/protocol', 'packages/ui']) {
  const pkg = read(join(root, workspace, 'package.json'));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (!isTool(dep)) take(join(root, workspace, 'node_modules', dep));
  }
}

const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
const missing = list.filter((p) => !p.text);
const rule = '-'.repeat(78);
const body = [
  'Third-party notices',
  '',
  'The app is licensed under Apache-2.0 (see LICENSE). It contains code and fonts from the packages below, each under',
  'its own license. Electron and Chromium come with their own notices (LICENSE.electron.txt, LICENSES.chromium.html).',
  '',
  ...list.flatMap((p) => [
    rule,
    `${p.name} ${p.version}`,
    `License: ${p.license}`,
    ...(p.home ? [p.home] : []),
    '',
    p.text ?? '(The package ships no license file; the license named above applies.)',
    '',
  ]),
].join('\n');

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${body}\n`);
console.log(
  `${list.length} packages in ${out.slice(root.length + 1)}${missing.length ? `; no license file in: ${missing.map((p) => p.name).join(', ')}` : ''}`,
);
