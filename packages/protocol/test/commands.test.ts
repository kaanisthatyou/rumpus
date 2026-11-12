import { describe, expect, it } from 'vitest';
import { COMMAND_KEYS, commandName, commandNames, parseCommand } from '../src/commands.js';

describe('slash commands', () => {
  it('offers each command under a name of the language', () => {
    expect(commandName('digest', 'tr')).toBe('/özet');
    expect(commandName('digest', 'en')).toBe('/summary');
    expect(commandName('council', 'en')).toBe('/council');
    expect(commandName('status', 'en')).toBe('/status');
    expect(commandName('remember', 'en')).toBe('/remember');
    expect(commandName('newSession', 'en')).toBe('/new-session');
    expect(commandName('race', 'tr')).toBe('/yarış');
    // an unknown language reads English
    expect(commandName('council', 'de')).toBe('/council');
  });

  it('answers to the Turkish and the English name in either language', () => {
    for (const key of COMMAND_KEYS) {
      for (const name of commandNames(key)) expect(parseCommand(`${name} x`)).toEqual({ key, rest: 'x' });
    }
    expect(parseCommand('/meclis fiyatlandırma')).toEqual({ key: 'council', rest: 'fiyatlandırma' });
    expect(parseCommand('/council pricing')).toEqual({ key: 'council', rest: 'pricing' });
    expect(parseCommand('/summary 6 @davut')).toEqual({ key: 'digest', rest: '6 @davut' });
    expect(parseCommand('/ozet hafta')).toEqual({ key: 'digest', rest: 'hafta' });
    expect(parseCommand('/status')).toEqual({ key: 'status', rest: '' });
    expect(parseCommand('  /durum  ')).toEqual({ key: 'status', rest: '' });
  });

  it('takes capitals of both alphabets and keeps what follows as written', () => {
    expect(parseCommand('/HATIRLA Cuma günleri deploy yok')).toEqual({
      key: 'remember',
      rest: 'Cuma günleri deploy yok',
    });
    expect(parseCommand('/STATUS')).toEqual({ key: 'status', rest: '' });
    expect(parseCommand('/Remember No deploys\non Fridays')).toEqual({
      key: 'remember',
      rest: 'No deploys\non Fridays',
    });
  });

  it('leaves everything else alone', () => {
    expect(parseCommand('hello /status')).toBeUndefined();
    expect(parseCommand('/statuses')).toBeUndefined();
    expect(parseCommand('/')).toBeUndefined();
    expect(parseCommand('/usr/bin is on the PATH')).toBeUndefined();
  });

  it('gives no two commands the same name', () => {
    const all = COMMAND_KEYS.flatMap(commandNames);
    expect(new Set(all).size).toBe(all.length);
  });
});
