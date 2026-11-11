import {
  AGENT_MODES,
  type Agent,
  type AgentAccess,
  type AgentMode,
  type CliKind,
  DEFAULT_ACCESS,
} from '@lonca/protocol';
import { Button, IconButton, Segmented, Switch, TextField } from '@lonca/ui';
import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorLine } from '../parts';
import { useApp } from '../store';
import { FolderField, TraitPicker } from './fields';

/** CLIs Serai can run jobs with today. */
export const RUNNABLE: CliKind[] = ['claude-code', 'codex'];

export const slug = (name: string) =>
  name
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

const DEFAULT_NAMES: Partial<Record<CliKind, string>> = { 'claude-code': 'Claude', codex: 'Codex' };

export function AgentDialog() {
  const { t } = useTranslation();
  const target = useApp((s) => s.agentDialog);
  const close = useCallback(() => useApp.getState().openAgentDialog(undefined), []);
  const clis = useApp((s) => s.clis);
  const saveAgent = useApp((s) => s.saveAgent);
  const deleteAgent = useApp((s) => s.deleteAgent);
  const existing: Agent | undefined = target && target !== 'new' && 'id' in target ? target : undefined;
  const available = useMemo(
    () => (clis ?? []).filter((c) => RUNNABLE.includes(c.kind) && c.state !== 'missing').map((c) => c.kind),
    [clis],
  );
  const initialKind: CliKind =
    existing?.kind ??
    (target && target !== 'new' && 'kind' in target ? target.kind : undefined) ??
    available[0] ??
    'claude-code';

  const [kind, setKind] = useState<CliKind>(initialKind);
  const [name, setName] = useState(existing?.name ?? DEFAULT_NAMES[initialKind] ?? '');
  const [handle, setHandle] = useState(existing?.handle ?? slug(DEFAULT_NAMES[initialKind] ?? ''));
  const [handleTouched, setHandleTouched] = useState(Boolean(existing));
  const [folder, setFolder] = useState(existing?.folder ?? '');
  const [mode, setMode] = useState<AgentMode>(existing?.mode ?? 'read');
  const [model, setModel] = useState(existing?.model ?? '');
  const [instructions, setInstructions] = useState(existing?.instructions ?? '');
  const [traits, setTraits] = useState<string[]>(existing?.traits ?? []);
  const [access, setAccess] = useState<AgentAccess>(existing?.access ?? DEFAULT_ACCESS);
  const [account, setAccount] = useState(existing?.account ?? '');
  const allAccounts = useApp((s) => s.accounts);
  const accounts = useMemo(() => allAccounts.filter((a) => a.kind === kind), [allAccounts, kind]);
  const team = useApp((s) => s.workspace?.kind === 'team');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!target) return null;
  const kinds = existing ? [existing.kind] : available;

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
        aria-label={existing ? t('agentForm.edit') : t('agentForm.new')}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
        onSubmit={async (e) => {
          e.preventDefault();
          await saveAgent({
            ...(existing ? { id: existing.id } : {}),
            kind,
            name,
            handle,
            folder,
            mode,
            ...(model.trim() ? { model: model.trim() } : {}),
            ...(account && accounts.some((a) => a.id === account) ? { account } : {}),
            instructions,
            traits,
            ...(team ? { access } : {}),
          });
        }}
      >
        <header className="agentform__head">
          <h2>{existing ? t('agentForm.edit') : t('agentForm.new')}</h2>
          <IconButton icon="close" label={t('common.close')} onClick={close} />
        </header>
        <div className="agentform__body">
          {kinds.length === 0 ? (
            <p className="muted">{t('agentForm.noCli')}</p>
          ) : (
            <>
              <div className="row-field">
                <span className="row-field__label">{t('agentForm.cli')}</span>
                <Segmented
                  layoutId="agent-cli"
                  label={t('agentForm.cli')}
                  value={kind}
                  onChange={(k) => {
                    setKind(k);
                    if (!existing && (!name || name === DEFAULT_NAMES[kind])) {
                      const n = DEFAULT_NAMES[k] ?? '';
                      setName(n);
                      if (!handleTouched) setHandle(slug(n));
                    }
                  }}
                  options={kinds.map((k) => ({ value: k, label: t(`agent.kind.${k}`) }))}
                />
              </div>
              <div className="agentform__pair">
                <TextField
                  label={t('agentForm.name')}
                  value={name}
                  maxLength={40}
                  required
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!handleTouched) setHandle(slug(e.target.value));
                  }}
                />
                <TextField
                  label={t('agentForm.handle')}
                  value={handle}
                  maxLength={32}
                  required
                  pattern="[a-z0-9][a-z0-9\-]*"
                  hint={t('agentForm.handleHint', { handle: handle || '…' })}
                  onChange={(e) => {
                    setHandleTouched(true);
                    setHandle(slug(e.target.value));
                  }}
                />
              </div>
              <FolderField value={folder} onChange={setFolder} />
              <div className="l-field">
                <span className="l-field__label">{t('agentForm.mode')}</span>
                <Segmented
                  layoutId="agent-mode"
                  label={t('agentForm.mode')}
                  value={mode}
                  onChange={setMode}
                  options={AGENT_MODES.map((m) => ({ value: m, label: t(`agentForm.modes.${m}`) }))}
                />
                <span className={`l-field__hint ${mode === 'full' ? 'is-warn' : ''}`}>
                  {t(`agentForm.modeHint.${mode}`)}
                </span>
              </div>
              {team && (
                <fieldset className="l-field agentform__access">
                  <legend className="l-field__label">{t('agentForm.access.title')}</legend>
                  <Segmented
                    layoutId="agent-who"
                    label={t('agentForm.access.title')}
                    value={access.who}
                    onChange={(who) => setAccess((a) => ({ ...a, who }))}
                    options={[
                      { value: 'me', label: t('agentForm.access.me') },
                      { value: 'members', label: t('agentForm.access.members') },
                    ]}
                  />
                  {access.who === 'members' && (
                    <>
                      <span className="l-field__label">{t('agentForm.access.maxMode')}</span>
                      <Segmented
                        layoutId="agent-max"
                        label={t('agentForm.access.maxMode')}
                        value={access.maxMode}
                        onChange={(maxMode) => setAccess((a) => ({ ...a, maxMode }))}
                        options={AGENT_MODES.map((m) => ({ value: m, label: t(`agentForm.modes.${m}`) }))}
                      />
                      <div className="row-field">
                        <Switch
                          checked={access.approveOthers}
                          onChange={(approveOthers) => setAccess((a) => ({ ...a, approveOthers }))}
                          label={t('agentForm.access.approve')}
                        />
                        <span>{t('agentForm.access.approve')}</span>
                      </div>
                    </>
                  )}
                  <span className="l-field__hint">{t(`agentForm.access.hint.${access.who}`)}</span>
                </fieldset>
              )}
              {accounts.length > 0 && (
                <div className="l-field">
                  <label className="l-field__label" htmlFor="agent-account">
                    {t('accounts.agentField')}
                  </label>
                  <select
                    id="agent-account"
                    className="l-input"
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                  >
                    <option value="">{t('accounts.default')}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <span className="l-field__hint">{t('accounts.agentHint')}</span>
                </div>
              )}
              <TextField
                label={t('agentForm.model')}
                value={model}
                maxLength={80}
                hint={t('agentForm.modelHint')}
                onChange={(e) => setModel(e.target.value)}
              />
              <TraitPicker value={traits} onChange={setTraits} />
              <div className="l-field">
                <label className="l-field__label" htmlFor="agent-instructions">
                  {t('agentForm.instructions')}
                </label>
                <textarea
                  id="agent-instructions"
                  className="l-input agentform__text"
                  value={instructions}
                  maxLength={20000}
                  onChange={(e) => setInstructions(e.target.value)}
                />
                <span className="l-field__hint">{t('agentForm.instructionsHint')}</span>
              </div>
            </>
          )}
          <ErrorLine />
        </div>
        <footer className="agentform__foot">
          {existing ? (
            <Button variant="danger" icon="close" onClick={() => void deleteAgent(existing.id)}>
              {t('agentForm.delete')}
            </Button>
          ) : (
            <span />
          )}
          <span className="grow" />
          <Button variant="quiet" onClick={close}>
            {t('agentForm.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={kinds.length === 0 || !name.trim() || !handle}>
            {t('agentForm.save')}
          </Button>
        </footer>
      </motion.form>
    </motion.div>
  );
}
