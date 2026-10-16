import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CoreError,
  defaultSettings,
  type Language,
  type Settings,
  type SettingsPatch,
  SettingsPatchSchema,
  SettingsSchema,
} from '@lonca/protocol';

/** Settings live in one JSON file, written atomically. A damaged file falls back to the defaults. */
export class SettingsStore {
  private current: Settings;

  constructor(
    private readonly file: string,
    language: Language,
  ) {
    this.current = this.load(language);
  }

  private load(language: Language): Settings {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      const parsed = SettingsSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      // Keep what is still valid from an older or partly broken file.
      const patch = SettingsPatchSchema.safeParse(raw);
      return patch.success ? this.merge(defaultSettings(language), patch.data) : defaultSettings(language);
    } catch {
      return defaultSettings(language);
    }
  }

  private merge(base: Settings, patch: SettingsPatch): Settings {
    return { ...base, ...patch, profile: { ...base.profile, ...patch.profile }, v: 1 };
  }

  get(): Settings {
    return this.current;
  }

  update(input: unknown): Settings {
    const patch = SettingsPatchSchema.safeParse(input);
    if (!patch.success) throw new CoreError('invalid_settings', patch.error.message);
    const next = SettingsSchema.safeParse(this.merge(this.current, patch.data));
    if (!next.success) throw new CoreError('invalid_settings', next.error.message);
    this.current = next.data;
    this.save();
    return this.current;
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.current, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.file);
  }
}
