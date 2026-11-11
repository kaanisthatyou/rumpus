// The UI's strings as a test reads them: the locale file with the product's name filled in for `{{app}}`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = 'Rumpus';

export function locale(lang) {
  const file = join(here, '../src/renderer/src/locales', `${lang}.json`);
  return JSON.parse(readFileSync(file, 'utf8').replaceAll('{{app}}', APP));
}
