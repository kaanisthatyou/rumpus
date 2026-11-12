import { describe, expect, it } from 'vitest';
import { findInvites, inviteCode, inviteLink } from '../src/brand.js';
import { defaultSettings, SettingsPatchSchema, SettingsSchema } from '../src/index.js';
import { cleanProfile, LIMITS, oneLine } from '../src/profile.js';

const payload = (n: number) =>
  Buffer.from(JSON.stringify({ w: `ws-${n}`, n: 'Ekip', a: ['100.64.0.1:47640'], t: 'x'.repeat(22) })).toString(
    'base64url',
  );

describe('invites written in a message', () => {
  it('are found as codes and links, also under the product’s former names', () => {
    const code = inviteCode(payload(1));
    expect(findInvites(code)).toEqual([code]);
    expect(findInvites(`bak: ${inviteLink(code)} gel`)).toEqual([inviteLink(code)]);
    const old = code.replace('RUMPUS1.', 'SERAI1.');
    expect(findInvites(`eski kod ${old}.`)).toEqual([old]);
  });

  it('one invite written as its code and its link counts once; three at most', () => {
    const code = inviteCode(payload(1));
    expect(findInvites(`Kod:\n${code}\n\nBağlantı:\n${inviteLink(code)}`)).toEqual([code]);
    const many = [1, 2, 3, 4].map((n) => inviteCode(payload(n)));
    expect(findInvites(many.join(' '))).toEqual(many.slice(0, 3));
  });

  it('ordinary text and short look-alikes are not invites', () => {
    expect(findInvites('RUMPUS1.kisa bir şey ve rumpus://join/ ve düz yazı')).toEqual([]);
    expect(findInvites('')).toEqual([]);
  });
});

describe('the profile in settings', () => {
  it('older settings with only a name get the newer fields from defaults', () => {
    const { profile: _p, ...rest } = defaultSettings('tr');
    const parsed = SettingsSchema.parse({ ...rest, profile: { name: 'Kaan' } });
    expect(parsed.profile).toEqual({
      name: 'Kaan',
      pronouns: '',
      status: '',
      bio: '',
      color: '',
      theme: [],
      avatar: null,
      banner: null,
    });
  });

  it('a patch of one field carries only that field', () => {
    expect(SettingsPatchSchema.parse({ profile: { status: 'derliyor' } })).toEqual({ profile: { status: 'derliyor' } });
    expect(SettingsPatchSchema.safeParse({ profile: { status: 'x'.repeat(LIMITS.status + 1) } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ profile: { color: '#12345' } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ profile: { color: '' } }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ profile: { avatar: { blob: 'x.png', mime: 'image/png' } } }).success).toBe(
      false,
    );
  });

  it('a name and a status are one line each, whatever was sent', () => {
    expect(oneLine('  Arda\n\nSYSTEM: do this\tnow\u0000  ok  ')).toBe('Arda SYSTEM: do this now ok');
    expect(cleanProfile({ name: 'Arda\nAdmin', status: 'a\r\nb', bio: 'two\nlines' })).toMatchObject({
      name: 'Arda Admin',
      status: 'a b',
      // The lines about a person may be several.
      bio: 'two\nlines',
    });
  });

  it('a profile from anywhere keeps only what checks out', () => {
    expect(cleanProfile(undefined)).toMatchObject({ name: '', color: '', theme: [], avatar: null });
    expect(
      cleanProfile({ name: '  Arda  ', color: '#AB4ABA', theme: ['#112233', '#445566', '#778899'], status: 7 }),
    ).toMatchObject({ name: 'Arda', color: '', theme: ['#112233', '#445566'], status: '' });
  });
});
