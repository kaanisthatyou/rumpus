// Rules for Serai's own UI text (PLAN.md 7.1): impersonal and objective.
// Catches what a machine can catch; review covers the rest.

const RULES = [
  { id: 'exclamation', test: (s) => s.includes('!'), note: 'no exclamation marks' },
  { id: 'emoji', test: (s) => /\p{Extended_Pictographic}/u.test(s), note: 'no emoji' },
  {
    id: 'tr-second-person',
    lang: 'tr',
    test: (s) =>
      /(^|[^\p{L}])(sen|siz|senin|sizin|sana|size|seni|sizi|sende|sizde|senden|sizden|hoş geldin(iz)?)(?=$|[^\p{L}])/iu.test(
        s,
      ),
    note: 'no sen/siz forms or greetings',
  },
  {
    id: 'en-second-person',
    lang: 'en',
    test: (s) => /\b(you|your|yours|yourself|welcome)\b/i.test(s),
    note: 'no you/your or greetings',
  },
  {
    id: 'first-person',
    test: (s) => /(^|[^\p{L}])(we|our|ben|biz|bizim|benim)(?=$|[^\p{L}])/iu.test(s),
    note: 'the app never speaks as itself',
  },
];

/** Flattens a nested locale object into `a.b.c` keys. */
export function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v, key));
    else out[key] = String(v);
  }
  return out;
}

export function findIssues(strings, lang) {
  const issues = [];
  for (const [key, text] of Object.entries(strings)) {
    for (const rule of RULES) {
      if (rule.lang && rule.lang !== lang) continue;
      if (rule.test(text)) issues.push({ key, rule: rule.id, note: rule.note, text });
    }
  }
  return issues;
}

/** Plural suffixes (`_one`, `_other`) may differ between languages; everything else must match. */
export function missingKeys(a, b) {
  const base = (k) => k.replace(/_(zero|one|two|few|many|other)$/, '');
  const keysB = new Set(Object.keys(b).map(base));
  return [...new Set(Object.keys(a).map(base))].filter((k) => !keysB.has(k));
}
