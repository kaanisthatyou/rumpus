// Checks every locale file against the impersonal copy rules and for missing keys. Exit code 1 on problems.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findIssues, flatten, missingKeys } from './copy-rules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['apps/desktop/src/renderer/src/locales'];
let problems = 0;

for (const rel of dirs) {
  const dir = join(root, rel);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const locales = Object.fromEntries(
    files.map((f) => [f.replace('.json', ''), flatten(JSON.parse(readFileSync(join(dir, f), 'utf8')))]),
  );
  for (const [lang, strings] of Object.entries(locales)) {
    for (const i of findIssues(strings, lang)) {
      problems += 1;
      console.log(`${rel}/${lang}.json  ${i.key}: ${i.note}\n    "${i.text}"`);
    }
    for (const [other, otherStrings] of Object.entries(locales)) {
      if (other === lang) continue;
      for (const key of missingKeys(strings, otherStrings)) {
        problems += 1;
        console.log(`${rel}/${other}.json  missing key ${key} (present in ${lang}.json)`);
      }
    }
  }
}

if (problems > 0) {
  console.log(`\n${problems} copy problem(s). Rules: PLAN.md, section 7.1.`);
  process.exit(1);
}
console.log('copy ok');
