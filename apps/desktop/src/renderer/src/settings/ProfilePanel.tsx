// Settings → Profile: how this person presents themselves, with the card others see beside it. Text is kept
// when a field is left; colors and pictures at once.
import { LIMITS } from '@lonca/protocol';
import { Counter, Switch, TextField } from '@lonca/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileView } from '../people/ProfileCard';
import { ColorPick, PicturePick, personOf } from '../people/people';
import { useApp } from '../store';

const DEFAULT_THEME = ['#3e9bdc', '#ab4aba'];
const TEXT_FIELDS = ['name', 'pronouns', 'status', 'bio'] as const;

export function ProfilePanel() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const workspace = useApp((s) => s.workspace);
  const patch = useApp((s) => s.patch);
  const setPicture = useApp((s) => s.setPicture);
  const profile = settings?.profile;
  const [draft, setDraft] = useState({
    name: profile?.name ?? '',
    pronouns: profile?.pronouns ?? '',
    status: profile?.status ?? '',
    bio: profile?.bio ?? '',
  });
  // What was saved elsewhere (another window, a refusal that put the old value back) shows here too: a field
  // follows its own saved value only. The settings change as a whole whenever any field is kept, and following
  // them as a whole wiped what was being typed in the next field (the first e2e runs caught it).
  const saved = useRef(profile);
  useEffect(() => {
    if (!profile) return;
    const before = saved.current;
    saved.current = profile;
    const changed = TEXT_FIELDS.filter((f) => profile[f] !== before?.[f]);
    if (changed.length > 0) setDraft((d) => ({ ...d, ...Object.fromEntries(changed.map((f) => [f, profile[f]])) }));
  }, [profile]);

  // The preview shows what is being typed, before it is kept.
  const person = useMemo(() => {
    const base = personOf(workspace, settings, workspace?.me.id ?? '');
    return {
      ...base,
      name: draft.name.trim() || base.name,
      profile: { ...base.profile, ...draft },
      color: profile?.color || base.color,
    };
  }, [workspace, settings, draft, profile?.color]);

  if (!settings || !profile) return null;
  const keep = (field: keyof typeof draft) => {
    const value = field === 'bio' ? draft.bio : draft[field].trim();
    if (field === 'name' && !value) {
      setDraft((d) => ({ ...d, name: profile.name }));
      return;
    }
    if (value !== profile[field]) void patch({ profile: { [field]: value } });
  };
  const text = (field: 'name' | 'pronouns' | 'status', max: number, placeholder?: string) => (
    <TextField
      label={t(`profile.${field}`)}
      value={draft[field]}
      maxLength={max}
      counted
      {...(placeholder ? { placeholder } : {})}
      onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
      onBlur={() => keep(field)}
      onKeyDown={(e: { key: string }) => e.key === 'Enter' && keep(field)}
    />
  );
  const themed = profile.theme.length === 2;
  const theme = themed ? profile.theme : DEFAULT_THEME;
  return (
    <div className="pform">
      <div className="pform__form stack">
        <p className="muted">{t('profile.intro')}</p>
        <section className="set">
          {text('name', LIMITS.personName)}
          {text('pronouns', LIMITS.pronouns)}
          {text('status', LIMITS.status, t('profile.statusPlaceholder'))}
          <div className="l-field">
            <span className="l-field__top">
              <label className="l-field__label" htmlFor="profile-bio">
                {t('profile.bio')}
              </label>
              <Counter value={draft.bio.length} max={LIMITS.bio} />
            </span>
            <textarea
              id="profile-bio"
              className="l-input pform__bio"
              rows={4}
              maxLength={LIMITS.bio}
              value={draft.bio}
              onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
              onBlur={() => keep('bio')}
            />
          </div>
        </section>
        <section className="set">
          <h4>{t('profile.pictures')}</h4>
          <PicturePick
            label={t('profile.avatar')}
            shape="avatar"
            has={Boolean(profile.avatar)}
            onPick={(data) => setPicture('avatar', data)}
          />
          <PicturePick
            label={t('profile.banner')}
            shape="banner"
            has={Boolean(profile.banner)}
            onPick={(data) => setPicture('banner', data)}
          />
          <p className="muted">{t('profile.pictureHint')}</p>
        </section>
        <section className="set">
          <h4>{t('profile.color')}</h4>
          <ColorPick
            label={t('profile.color')}
            value={profile.color}
            none={t('profile.colorNone')}
            onChange={(color) => void patch({ profile: { color } })}
          />
          <p className="muted">{t('profile.colorHint')}</p>
        </section>
        <section className="set">
          <h4>{t('profile.theme')}</h4>
          <div className="row-field">
            <Switch
              checked={themed}
              onChange={(on) => void patch({ profile: { theme: on ? DEFAULT_THEME : [] } })}
              label={t('profile.themeOn')}
            />
            <span>{t('profile.themeOn')}</span>
          </div>
          {themed && (
            <div className="pform__theme">
              {(['themeFirst', 'themeSecond'] as const).map((key, i) => (
                <div key={key} className="row-field">
                  <span className="row-field__label">{t(`profile.${key}`)}</span>
                  <ColorPick
                    label={t(`profile.${key}`)}
                    value={theme[i] ?? ''}
                    onChange={(color) => void patch({ profile: { theme: theme.map((c, n) => (n === i ? color : c)) } })}
                  />
                </div>
              ))}
            </div>
          )}
          <p className="muted">{t('profile.themeHint')}</p>
        </section>
      </div>
      <aside className="pform__preview" aria-label={t('profile.preview')}>
        <h4>{t('profile.preview')}</h4>
        <ProfileView person={person} />
      </aside>
    </div>
  );
}
