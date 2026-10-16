import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module without types
import { findIssues, flatten, missingKeys } from '../copy-rules.mjs';

const rules = (text: string, lang: string) => findIssues({ k: text }, lang).map((i: { rule: string }) => i.rule);

describe('copy rules', () => {
  it('accepts impersonal text', () => {
    expect(rules('Davet gönderildi.', 'tr')).toEqual([]);
    expect(rules('Bağlantı kurulamadı: Tailscale kapalı.', 'tr')).toEqual([]);
    expect(rules('Code copied.', 'en')).toEqual([]);
    // "-siz" as a suffix is not the pronoun.
    expect(rules('Şifresiz bağlantı', 'tr')).toEqual([]);
  });

  it('flags exclamation marks, emoji, address and first person', () => {
    expect(rules('Harika, davet gönderildi!', 'tr')).toContain('exclamation');
    expect(rules('Hazır 🎉', 'tr')).toContain('emoji');
    expect(rules('Hoş geldin Kaan', 'tr')).toContain('tr-second-person');
    expect(rules('Ayarların senin için kaydedildi', 'tr')).toContain('tr-second-person');
    expect(rules('Your code was copied', 'en')).toContain('en-second-person');
    expect(rules('We could not connect', 'en')).toContain('first-person');
  });

  it('flattens nested keys and finds missing ones, ignoring plural suffixes', () => {
    const tr = flatten({ a: { b: 'x', n_one: '1', n_other: '2' }, c: 'y' });
    const en = flatten({ a: { b: 'x', n_one: '1', n_other: '2' } });
    expect(Object.keys(tr)).toEqual(['a.b', 'a.n_one', 'a.n_other', 'c']);
    expect(missingKeys(tr, en)).toEqual(['c']);
    expect(missingKeys(en, tr)).toEqual([]);
  });
});
