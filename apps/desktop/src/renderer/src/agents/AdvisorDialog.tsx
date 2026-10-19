// Adding or editing an advisor (PLAN.md 5.4): personality, provider and model, where and how often it speaks,
// its daily budget and the project folder it looks at.
import {
  type Advisor,
  CHATTER,
  type Chatter,
  PERSONALITIES,
  PERSONALITY_PROMPTS,
  type Personality,
  type ProviderInfo,
} from '@lonca/protocol';
import { Button, Icon, IconButton, Segmented, TextField } from '@lonca/ui';
import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorLine } from '../parts';
import { core } from '../rpc';
import { useApp } from '../store';
import { slug } from './AgentDialog';

const BUDGETS = [20_000, 100_000, 500_000, 2_000_000];
const NONE: ProviderInfo[] = [];

export function AdvisorDialog() {
  const { t } = useTranslation();
  const target = useApp((s) => s.advisorDialog);
  const close = useCallback(() => useApp.getState().openAdvisorDialog(undefined), []);
  const providers = useApp((s) => s.providers?.providers ?? NONE);
  const allChannels = useApp((s) => s.workspace?.channels);
  const channels = useMemo(() => (allChannels ?? []).filter((c) => c.kind === 'channel'), [allChannels]);
  const saveAdvisor = useApp((s) => s.saveAdvisor);
  const deleteAdvisor = useApp((s) => s.deleteAdvisor);
  const existing: Advisor | undefined = target && target !== 'new' ? target : undefined;

  const firstName = t('advisorForm.defaultName.critical');
  const [personality, setPersonality] = useState<Personality>(existing?.personality ?? 'critical');
  const [name, setName] = useState(existing?.name ?? firstName);
  const [handle, setHandle] = useState(existing?.handle ?? slug(firstName));
  const [handleTouched, setHandleTouched] = useState(Boolean(existing));
  const [prompt, setPrompt] = useState(existing?.prompt ?? PERSONALITY_PROMPTS.critical);
  const [providerId, setProviderId] = useState(existing?.providerId ?? providers[0]?.id ?? '');
  const provider = providers.find((p) => p.id === providerId);
  const [model, setModel] = useState(existing?.model ?? provider?.models[0] ?? '');
  const [inChannels, setInChannels] = useState<string[]>(existing?.channels ?? []);
  const [chatter, setChatter] = useState<Chatter>(existing?.chatter ?? 'low');
  const [budget, setBudget] = useState(existing?.dailyTokens ?? 100_000);
  const [folder, setFolder] = useState(existing?.folder ?? '');
  const mine = useApp((s) => existing !== undefined && existing.owner === s.workspace?.me.id);
  const [notes, setNotes] = useState<string>();
  useEffect(() => {
    if (!existing || !mine) return;
    void core
      .call('advisors.notes', { id: existing.id })
      .then(setNotes)
      .catch(() => {});
  }, [existing, mine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!target) return null;

  const pickPersonality = (p: Personality) => {
    // The prompt follows the preset until it is edited by hand.
    if (prompt.trim() === PERSONALITY_PROMPTS[personality].trim()) setPrompt(PERSONALITY_PROMPTS[p]);
    const before = t(`advisorForm.defaultName.${personality}`);
    if (!existing && (!name.trim() || name === before)) {
      const next = t(`advisorForm.defaultName.${p}`);
      setName(next);
      if (!handleTouched) setHandle(slug(next));
    }
    setPersonality(p);
  };

  return (
    <motion.div
      className="l-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.form
        className="l-dialog agentform"
        role="dialog"
        aria-modal="true"
        aria-label={existing ? t('advisorForm.edit') : t('advisorForm.new')}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (existing && mine && notes !== undefined)
            await core.call('advisors.saveNotes', { id: existing.id, text: notes }).catch(() => {});
          await saveAdvisor({
            ...(existing ? { id: existing.id } : {}),
            name,
            handle,
            personality,
            prompt,
            providerId,
            model: model.trim(),
            channels: inChannels,
            chatter,
            dailyTokens: budget,
            ...(folder ? { folder } : {}),
          });
        }}
      >
        <header className="agentform__head">
          <h2>{existing ? t('advisorForm.edit') : t('advisorForm.new')}</h2>
          <IconButton icon="close" label={t('common.close')} onClick={close} />
        </header>
        <div className="agentform__body">
          <p className="muted">{t('advisorForm.intro')}</p>
          {providers.length === 0 ? (
            <p className="advform__none">
              <Icon name="key" size={14} />
              <span>{t('advisorForm.noProvider')}</span>
            </p>
          ) : (
            <>
              <div className="l-field">
                <span className="l-field__label">{t('advisorForm.personality')}</span>
                <Segmented
                  layoutId="advisor-personality"
                  label={t('advisorForm.personality')}
                  value={personality}
                  onChange={pickPersonality}
                  options={PERSONALITIES.map((p) => ({ value: p, label: t(`advisorForm.personalities.${p}`) }))}
                />
              </div>
              <div className="agentform__pair">
                <TextField
                  label={t('advisorForm.name')}
                  value={name}
                  maxLength={40}
                  required
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!handleTouched) setHandle(slug(e.target.value));
                  }}
                />
                <TextField
                  label={t('advisorForm.handle')}
                  value={handle}
                  maxLength={32}
                  required
                  pattern="[a-z0-9][a-z0-9\-]*"
                  hint={t('advisorForm.handleHint', { handle: handle || '…' })}
                  onChange={(e) => {
                    setHandleTouched(true);
                    setHandle(slug(e.target.value));
                  }}
                />
              </div>
              <div className="l-field">
                <label className="l-field__label" htmlFor="advisor-prompt">
                  {t('advisorForm.prompt')}
                </label>
                <textarea
                  id="advisor-prompt"
                  className="l-input agentform__text"
                  value={prompt}
                  maxLength={8000}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                <span className="l-field__hint">{t('advisorForm.promptHint')}</span>
              </div>
              <div className="agentform__pair">
                <div className="l-field">
                  <label className="l-field__label" htmlFor="advisor-provider">
                    {t('advisorForm.provider')}
                  </label>
                  <select
                    id="advisor-provider"
                    className="l-input"
                    value={providerId}
                    onChange={(e) => {
                      setProviderId(e.target.value);
                      const next = providers.find((p) => p.id === e.target.value);
                      if (next && !next.models.includes(model)) setModel(next.models[0] ?? '');
                    }}
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <TextField
                  label={t('advisorForm.model')}
                  value={model}
                  maxLength={160}
                  required
                  list="advisor-models"
                  spellCheck={false}
                  hint={provider?.models.length ? t('advisorForm.modelHint') : t('advisorForm.modelNoList')}
                  onChange={(e) => setModel(e.target.value)}
                />
                <datalist id="advisor-models">
                  {provider?.models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <div className="l-field">
                <span className="l-field__label">{t('advisorForm.chatter')}</span>
                <Segmented
                  layoutId="advisor-chatter"
                  label={t('advisorForm.chatter')}
                  value={chatter}
                  onChange={setChatter}
                  options={CHATTER.map((c) => ({ value: c, label: t(`advisorForm.chatterLevels.${c}`) }))}
                />
                <span className="l-field__hint">{t(`advisorForm.chatterHint.${chatter}`)}</span>
              </div>
              <fieldset className="l-field advform__channels">
                <legend className="l-field__label">{t('advisorForm.channels')}</legend>
                <div className="advform__checks">
                  {channels.map((c) => (
                    <label key={c.id} className="advform__check">
                      <input
                        type="checkbox"
                        checked={inChannels.includes(c.id)}
                        onChange={(e) =>
                          setInChannels((prev) =>
                            e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                          )
                        }
                      />
                      <span>#{c.name}</span>
                    </label>
                  ))}
                </div>
                <span className="l-field__hint">{t('advisorForm.channelsHint')}</span>
              </fieldset>
              <div className="l-field">
                <span className="l-field__label">{t('advisorForm.budget')}</span>
                <Segmented
                  layoutId="advisor-budget"
                  label={t('advisorForm.budget')}
                  value={String(budget)}
                  onChange={(v) => setBudget(Number(v))}
                  options={[...new Set([...BUDGETS, budget])]
                    .sort((a, b) => a - b)
                    .map((b) => ({ value: String(b), label: t('advisorForm.tokens', { count: b / 1000 }) }))}
                />
                <span className="l-field__hint">{t('advisorForm.budgetHint')}</span>
              </div>
              <div className="l-field">
                <span className="l-field__label">{t('advisorForm.folder')}</span>
                <div className="folder__path l-card">
                  <Icon name="folder" />
                  <span className="l-mono">{folder || '—'}</span>
                  {folder && (
                    <Button size="sm" variant="quiet" onClick={() => setFolder('')}>
                      {t('advisorForm.noFolder')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={async () => {
                      const dir = await window.lonca.shell.pickFolder();
                      if (dir) setFolder(dir);
                    }}
                  >
                    {t('agentForm.pick')}
                  </Button>
                </div>
                <span className="l-field__hint">{t('advisorForm.folderHint')}</span>
              </div>
              {notes !== undefined && (
                <div className="l-field">
                  <label className="l-field__label" htmlFor="advisor-notes">
                    {t('advisorForm.notes')}
                  </label>
                  <textarea
                    id="advisor-notes"
                    className="l-input agentform__text"
                    value={notes}
                    maxLength={2000}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                  <span className="l-field__hint">{t('advisorForm.notesHint')}</span>
                </div>
              )}
            </>
          )}
          <ErrorLine />
        </div>
        <footer className="agentform__foot">
          {existing ? (
            <Button variant="danger" icon="close" onClick={() => void deleteAdvisor(existing.id)}>
              {t('advisorForm.delete')}
            </Button>
          ) : (
            <span />
          )}
          <span className="grow" />
          <Button variant="quiet" onClick={close}>
            {t('agentForm.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={providers.length === 0 || !name.trim() || !handle || !providerId || !model.trim()}
          >
            {t('agentForm.save')}
          </Button>
        </footer>
      </motion.form>
    </motion.div>
  );
}
