// A specialist (PLAN.md 5.15): an agent for one kind of work. A new one starts from a template; the form has four
// parts: who it is, its playbook, what it reads before a job, and what it learned.
import {
  AGENT_MODES,
  type Agent,
  type AgentAccess,
  type AgentMode,
  type CliKind,
  DEFAULT_ACCESS,
  LESSONS_LIMIT,
  type LessonSuggestion,
  type RecordItem,
  SPECIALIST_HISTORY_MAX,
  SPECIALIST_TEMPLATES,
  type SpecialistTemplate,
} from '@lonca/protocol';
import { Button, Chip, Icon, IconButton, type IconName, Segmented, Switch, TextField } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorLine } from '../parts';
import { RefImage } from '../records/RecordsView';
import { useApp } from '../store';
import { RUNNABLE, slug } from './AgentDialog';
import { FolderField, TraitPicker } from './fields';

type Tab = 'who' | 'playbook' | 'context' | 'lessons';

/** A specialist as it is shared: what it is and how it works, without its folder, references or lessons. */
interface Shared {
  rumpus: 'specialist';
  name: string;
  handle: string;
  mode: AgentMode;
  role: string;
  playbook: string;
  history: number;
  budget?: { minutes: number; tokens?: number };
  result: boolean;
  template?: string;
}

function readShared(text: string): Shared | undefined {
  try {
    const d = JSON.parse(text.trim()) as Partial<Shared>;
    // Text copied under the former name carries `serai` instead.
    const marked = d?.rumpus === 'specialist' || (d as { serai?: unknown } | undefined)?.serai === 'specialist';
    if (!d || !marked || typeof d.name !== 'string' || typeof d.role !== 'string') return undefined;
    const minutes = Number(d.budget?.minutes);
    const tokens = Number(d.budget?.tokens);
    return {
      rumpus: 'specialist',
      name: d.name.slice(0, 40),
      handle: slug(typeof d.handle === 'string' ? d.handle : d.name),
      mode: (AGENT_MODES as readonly string[]).includes(String(d.mode)) ? (d.mode as AgentMode) : 'read',
      role: d.role.slice(0, 140),
      playbook: typeof d.playbook === 'string' ? d.playbook.slice(0, 20_000) : '',
      history: Math.min(SPECIALIST_HISTORY_MAX, Math.max(0, Math.round(Number(d.history) || 0))),
      ...(minutes >= 1 && minutes <= 240
        ? { budget: { minutes: Math.round(minutes), ...(tokens >= 1000 ? { tokens: Math.round(tokens) } : {}) } }
        : {}),
      result: d.result === true,
      ...(typeof d.template === 'string' ? { template: d.template.slice(0, 40) } : {}),
    };
  } catch {
    return undefined;
  }
}
const NO_LESSONS: LessonSuggestion[] = [];
const NO_RECORDS: RecordItem[] = [];

/** The icon a specialist is drawn with: its template's, or the general one. */
export function specialistIcon(agent: Pick<Agent, 'specialty'> | undefined): IconName {
  const template = SPECIALIST_TEMPLATES.find((t) => t.id === agent?.specialty?.template);
  return template?.icon ?? 'spark';
}

function TemplateCard({ template, onPick }: { template: SpecialistTemplate; onPick: () => void }) {
  const { t } = useTranslation();
  return (
    <motion.button
      type="button"
      className="tpl"
      onClick={onPick}
      variants={{ hidden: { opacity: 0, y: 8 }, shown: { opacity: 1, y: 0 } }}
    >
      <span className="tpl__icon">
        <Icon name={template.icon} size={18} />
      </span>
      <b>{t(`specialists.templates.${template.id}.name`)}</b>
      <span className="tpl__about">{t(`specialists.templates.${template.id}.about`)}</span>
      <span className="tpl__chips">
        <Chip mono>{t(`agentForm.modes.${template.mode}`)}</Chip>
        {template.budget && <Chip mono>{t('specialists.minutes', { count: template.budget.minutes })}</Chip>}
        {template.result && <Chip mono>RESULT</Chip>}
      </span>
    </motion.button>
  );
}

function PendingLesson({ lesson }: { lesson: LessonSuggestion }) {
  const { t } = useTranslation();
  const answerLesson = useApp((s) => s.answerLesson);
  const [text, setText] = useState(lesson.text);
  return (
    <li className="lesson">
      <textarea
        className="l-input lesson__text"
        value={text}
        maxLength={400}
        rows={2}
        aria-label={t('specialists.lessons.pendingOne')}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="lesson__foot">
        <span className="lesson__from">
          {lesson.from ? t('specialists.lessons.from', { name: lesson.from }) : t('specialists.lessons.fromJob')}
          {lesson.flags?.map((f) => (
            <Chip key={f} tone="warn">
              {t(`memory.flags.${f}`, f)}
            </Chip>
          ))}
        </span>
        <Button size="sm" variant="quiet" onClick={() => void answerLesson(lesson.id, false)}>
          {t('specialists.lessons.drop')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!text.trim()}
          onClick={() => void answerLesson(lesson.id, true, text)}
        >
          {t('specialists.lessons.keep')}
        </Button>
      </div>
    </li>
  );
}

export function SpecialistDialog() {
  const { t } = useTranslation();
  const target = useApp((s) => s.specialistDialog);
  const close = useCallback(() => useApp.getState().openSpecialistDialog(undefined), []);
  const clis = useApp((s) => s.clis);
  const saveAgent = useApp((s) => s.saveAgent);
  const deleteAgent = useApp((s) => s.deleteAgent);
  const team = useApp((s) => s.workspace?.kind === 'team');
  const taken = useApp((s) => s.workspace);
  const records = useApp((s) => s.records ?? NO_RECORDS);
  const allPending = useApp((s) => s.workspace?.lessons ?? NO_LESSONS);
  const allAccounts = useApp((s) => s.accounts);
  const existing: Agent | undefined = target && target !== 'new' ? target : undefined;
  // The agent as the workspace has it now: lessons kept while the dialog is open show up.
  const current = useApp((s) => (existing ? s.workspace?.agents.find((a) => a.id === existing.id) : undefined));
  const spec = existing?.specialty;
  const available = useMemo(
    () => (clis ?? []).filter((c) => RUNNABLE.includes(c.kind) && c.state !== 'missing').map((c) => c.kind),
    [clis],
  );

  const [template, setTemplate] = useState<string | undefined>(spec?.template ?? (existing ? 'custom' : undefined));
  const [tab, setTab] = useState<Tab>('who');
  const [kind, setKind] = useState<CliKind>(existing?.kind ?? available[0] ?? 'claude-code');
  const [name, setName] = useState(existing?.name ?? '');
  const [handle, setHandle] = useState(existing?.handle ?? '');
  const [handleTouched, setHandleTouched] = useState(Boolean(existing));
  const [role, setRole] = useState(spec?.role ?? '');
  const [folder, setFolder] = useState(existing?.folder ?? '');
  const [mode, setMode] = useState<AgentMode>(existing?.mode ?? 'read');
  const [model, setModel] = useState(existing?.model ?? '');
  const [account, setAccount] = useState(existing?.account ?? '');
  const [access, setAccess] = useState<AgentAccess>(existing?.access ?? DEFAULT_ACCESS);
  const [playbook, setPlaybook] = useState(spec?.playbook ?? '');
  const [traits, setTraits] = useState<string[]>(existing?.traits ?? []);
  const [history, setHistory] = useState(spec?.history ?? 30);
  const [refs, setRefs] = useState<string[]>(spec?.refs ?? []);
  const [limited, setLimited] = useState(Boolean(spec?.budget));
  const [minutes, setMinutes] = useState(spec?.budget?.minutes ?? 15);
  const [tokens, setTokens] = useState(spec?.budget?.tokens ? String(Math.round(spec.budget.tokens / 1000)) : '');
  const [result, setResult] = useState(spec?.result ?? false);
  const [learns, setLearns] = useState(spec?.learns ?? true);
  const [lessons, setLessons] = useState(spec?.lessons ?? '');
  const [lessonsTouched, setLessonsTouched] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [shared, setShared] = useState(false);

  const accounts = useMemo(() => allAccounts.filter((a) => a.kind === kind), [allAccounts, kind]);
  const references = useMemo(() => records.filter((r) => r.kind === 'reference'), [records]);
  const pending = useMemo(
    () => (existing ? allPending.filter((l) => l.agentId === existing.id) : NO_LESSONS),
    [allPending, existing],
  );
  // A lesson kept from the waiting list (or by a running job) lands in the text unless it is being edited.
  const liveLessons = current?.specialty?.lessons;
  useEffect(() => {
    if (liveLessons !== undefined && !lessonsTouched) setLessons(liveLessons);
  }, [liveLessons, lessonsTouched]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!target) return null;

  const pick = (tpl: SpecialistTemplate) => {
    const used = new Set([...(taken?.agents ?? []), ...(taken?.advisors ?? [])].map((a) => a.handle));
    let free = tpl.handle;
    for (let n = 2; used.has(free); n += 1) free = `${tpl.handle}-${n}`;
    setTemplate(tpl.id);
    setName(tpl.id === 'custom' ? '' : t(`specialists.templates.${tpl.id}.name`));
    setHandle(tpl.id === 'custom' ? '' : free);
    setHandleTouched(tpl.id !== 'custom');
    setRole(tpl.id === 'custom' ? '' : t(`specialists.templates.${tpl.id}.role`));
    setMode(tpl.mode);
    setPlaybook(tpl.playbook);
    setHistory(tpl.history);
    setLimited(Boolean(tpl.budget));
    setMinutes(tpl.budget?.minutes ?? 15);
    setTokens(tpl.budget?.tokens ? String(Math.round(tpl.budget.tokens / 1000)) : '');
    setResult(tpl.result);
    setTab('who');
  };

  /** A specialist someone shared, pasted into the gallery: the form opens filled from it. */
  const take = (s: Shared) => {
    const used = new Set([...(taken?.agents ?? []), ...(taken?.advisors ?? [])].map((a) => a.handle));
    let free = s.handle || 'uzman';
    for (let n = 2; used.has(free); n += 1) free = `${s.handle}-${n}`;
    setTemplate(s.template && SPECIALIST_TEMPLATES.some((x) => x.id === s.template) ? s.template : 'custom');
    setName(s.name);
    setHandle(free);
    setHandleTouched(true);
    setRole(s.role);
    setMode(s.mode);
    setPlaybook(s.playbook);
    setHistory(s.history);
    setLimited(Boolean(s.budget));
    setMinutes(s.budget?.minutes ?? 15);
    setTokens(s.budget?.tokens ? String(Math.round(s.budget.tokens / 1000)) : '');
    setResult(s.result);
    setTab('who');
  };
  const share = async () => {
    const out: Shared = {
      rumpus: 'specialist',
      name,
      handle,
      mode,
      role: role.trim(),
      playbook,
      history,
      ...(limited ? { budget: { minutes, ...(tokenCount >= 1000 ? { tokens: tokenCount } : {}) } } : {}),
      result,
      ...(template ? { template } : {}),
    };
    await window.lonca.shell.copy(JSON.stringify(out, null, 2));
    setShared(true);
  };

  const chosen = SPECIALIST_TEMPLATES.find((x) => x.id === template);
  const kinds = existing ? [existing.kind] : available;
  const title = existing ? t('specialists.edit') : t('specialists.new');
  const ready = kinds.length > 0 && Boolean(name.trim()) && Boolean(handle) && Boolean(role.trim());
  const tokenCount = Number(tokens.replace(/\D/g, '')) * 1000;

  return (
    <motion.div
      className="l-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.form
        className="l-dialog agentform specform"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 460, damping: 34 } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) {
            setTab('who');
            return;
          }
          await saveAgent({
            ...(existing ? { id: existing.id } : {}),
            kind,
            name,
            handle,
            folder,
            mode,
            ...(model.trim() ? { model: model.trim() } : {}),
            ...(account && accounts.some((a) => a.id === account) ? { account } : {}),
            instructions: existing?.instructions ?? '',
            traits,
            ...(team ? { access } : {}),
            specialty: {
              role: role.trim(),
              playbook,
              history,
              refs,
              ...(limited ? { budget: { minutes, ...(tokenCount >= 1000 ? { tokens: tokenCount } : {}) } } : {}),
              result,
              learns,
              lessons,
              ...(template ? { template } : {}),
            },
          });
        }}
      >
        <header className="agentform__head">
          <h2>
            {chosen && (
              <span className="specform__mark">
                <Icon name={chosen.icon} size={15} />
              </span>
            )}
            {title}
          </h2>
          <IconButton icon="close" label={t('common.close')} onClick={close} />
        </header>

        {!template ? (
          <div className="agentform__body">
            <p className="muted">{t('specialists.intro')}</p>
            <motion.div
              className="tpls"
              variants={{ shown: { transition: { staggerChildren: 0.035 } } }}
              initial="hidden"
              animate="shown"
            >
              {SPECIALIST_TEMPLATES.map((tpl) => (
                <TemplateCard key={tpl.id} template={tpl} onPick={() => pick(tpl)} />
              ))}
            </motion.div>
            {pasting ? (
              <div className="l-field">
                <label className="l-field__label" htmlFor="spec-paste">
                  {t('specialists.share.paste')}
                </label>
                <textarea
                  id="spec-paste"
                  className="l-input l-mono agentform__text"
                  value={pasted}
                  spellCheck={false}
                  // biome-ignore lint/a11y/noAutofocus: the field opens on request to be pasted into
                  autoFocus
                  onChange={(e) => {
                    setPasted(e.target.value);
                    const s = readShared(e.target.value);
                    if (s) take(s);
                  }}
                />
                <span className={pasted.trim() ? 'l-field__error' : 'l-field__hint'}>
                  {pasted.trim() ? t('specialists.share.bad') : t('specialists.share.pasteHint')}
                </span>
              </div>
            ) : (
              <div>
                <Button variant="quiet" icon="download" onClick={() => setPasting(true)}>
                  {t('specialists.share.paste')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="specform__tabs">
              <Segmented
                layoutId="spec-tab"
                label={title}
                value={tab}
                onChange={setTab}
                options={(['who', 'playbook', 'context', 'lessons'] as const).map((x) => ({
                  value: x,
                  label:
                    x === 'lessons' && pending.length > 0
                      ? `${t('specialists.tabs.lessons')} · ${pending.length}`
                      : t(`specialists.tabs.${x}`),
                }))}
              />
            </div>
            <div className="agentform__body specform__body">
              {kinds.length === 0 ? (
                <p className="muted">{t('agentForm.noCli')}</p>
              ) : tab === 'who' ? (
                <>
                  <div className="agentform__pair">
                    <TextField
                      label={t('agentForm.name')}
                      value={name}
                      maxLength={40}
                      required
                      autoFocus={!existing}
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
                  <TextField
                    label={t('specialists.role')}
                    value={role}
                    maxLength={140}
                    required
                    hint={t('specialists.roleHint')}
                    onChange={(e) => setRole(e.target.value)}
                  />
                  {kinds.length > 1 && (
                    <div className="row-field">
                      <span className="row-field__label">{t('agentForm.cli')}</span>
                      <Segmented
                        layoutId="spec-cli"
                        label={t('agentForm.cli')}
                        value={kind}
                        onChange={setKind}
                        options={kinds.map((k) => ({ value: k, label: t(`agent.kind.${k}`) }))}
                      />
                    </div>
                  )}
                  <FolderField value={folder} onChange={setFolder} />
                  <div className="l-field">
                    <span className="l-field__label">{t('agentForm.mode')}</span>
                    <Segmented
                      layoutId="spec-mode"
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
                        layoutId="spec-who"
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
                            layoutId="spec-max"
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
                  <div className="agentform__pair">
                    <TextField
                      label={t('agentForm.model')}
                      value={model}
                      maxLength={80}
                      hint={t('agentForm.modelHint')}
                      onChange={(e) => setModel(e.target.value)}
                    />
                    {accounts.length > 0 && (
                      <div className="l-field">
                        <label className="l-field__label" htmlFor="spec-account">
                          {t('accounts.agentField')}
                        </label>
                        <select
                          id="spec-account"
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
                      </div>
                    )}
                  </div>
                </>
              ) : tab === 'playbook' ? (
                <>
                  <div className="l-field specform__grow">
                    <label className="l-field__label" htmlFor="spec-playbook">
                      {t('specialists.playbook')}
                    </label>
                    <textarea
                      id="spec-playbook"
                      className="l-input l-mono specform__playbook"
                      value={playbook}
                      maxLength={20000}
                      spellCheck={false}
                      placeholder={t('specialists.playbookPlaceholder')}
                      onChange={(e) => setPlaybook(e.target.value)}
                    />
                    <span className="l-field__hint">{t('specialists.playbookHint')}</span>
                  </div>
                  <TraitPicker value={traits} onChange={setTraits} />
                </>
              ) : tab === 'context' ? (
                <>
                  <div className="l-field">
                    <label className="l-field__label" htmlFor="spec-history">
                      {t('specialists.history')}
                      <span className="specform__value l-mono">
                        {history === 0 ? t('specialists.historyNone') : t('specialists.messages', { count: history })}
                      </span>
                    </label>
                    <input
                      id="spec-history"
                      type="range"
                      className="l-range"
                      min={0}
                      max={SPECIALIST_HISTORY_MAX}
                      step={10}
                      value={history}
                      onChange={(e) => setHistory(Number(e.target.value))}
                    />
                    <span className="l-field__hint">{t('specialists.historyHint')}</span>
                  </div>
                  <div className="l-field">
                    <span className="l-field__label">
                      {t('specialists.refs')}
                      <span className="specform__value l-mono">{refs.length} / 12</span>
                    </span>
                    {references.length === 0 ? (
                      <p className="crew__none">{t('specialists.refsNone')}</p>
                    ) : (
                      <div className="refpick">
                        {references.map((r) => {
                          const on = refs.includes(r.id);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              className={`refpick__item ${on ? 'is-on' : ''}`}
                              aria-pressed={on}
                              title={r.title}
                              disabled={!on && refs.length >= 12}
                              onClick={() => setRefs((list) => (on ? list.filter((x) => x !== r.id) : [...list, r.id]))}
                            >
                              <RefImage id={r.id} className="refpick__img" />
                              <span>{r.title}</span>
                              {on && (
                                <span className="refpick__tick">
                                  <Icon name="check" size={11} />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <span className="l-field__hint">{t('specialists.refsHint')}</span>
                  </div>
                  <div className="l-field">
                    <div className="row-field">
                      <Switch checked={limited} onChange={setLimited} label={t('specialists.budget')} />
                      <span>{t('specialists.budget')}</span>
                    </div>
                    <AnimatePresence initial={false}>
                      {limited && (
                        <motion.div
                          className="agentform__pair"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <TextField
                            label={t('specialists.budgetMinutes')}
                            type="number"
                            min={1}
                            max={240}
                            value={minutes}
                            onChange={(e) => setMinutes(Math.min(240, Math.max(1, Number(e.target.value) || 1)))}
                          />
                          <TextField
                            label={t('specialists.budgetTokens')}
                            inputMode="numeric"
                            value={tokens}
                            placeholder="—"
                            hint={t('specialists.budgetTokensHint')}
                            onChange={(e) => setTokens(e.target.value.replace(/\D/g, '').slice(0, 5))}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <span className="l-field__hint">{t('specialists.budgetHint')}</span>
                  </div>
                  <div className="l-field">
                    <div className="row-field">
                      <Switch checked={result} onChange={setResult} label={t('specialists.result')} />
                      <span>{t('specialists.result')}</span>
                    </div>
                    <span className="l-field__hint">{t('specialists.resultHint')}</span>
                  </div>
                  {chosen && chosen.connectors.length > 0 && (
                    <p className="specform__note">
                      <Icon name="plug" size={14} />
                      {t('specialists.connectors', { names: chosen.connectors.join(', ') })}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="l-field">
                    <div className="row-field">
                      <Switch checked={learns} onChange={setLearns} label={t('specialists.lessons.learns')} />
                      <span>{t('specialists.lessons.learns')}</span>
                    </div>
                    <span className="l-field__hint">{t('specialists.lessons.learnsHint')}</span>
                  </div>
                  {pending.length > 0 && (
                    <div className="l-field">
                      <span className="l-field__label">{t('specialists.lessons.pending')}</span>
                      <ul className="lessons">
                        {pending.map((l) => (
                          <PendingLesson key={l.id} lesson={l} />
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="l-field specform__grow">
                    <label className="l-field__label" htmlFor="spec-lessons">
                      {t('specialists.lessons.kept')}
                      <span className="specform__value l-mono">
                        {lessons.length} / {LESSONS_LIMIT}
                      </span>
                    </label>
                    <textarea
                      id="spec-lessons"
                      className="l-input specform__lessons"
                      value={lessons}
                      maxLength={LESSONS_LIMIT}
                      placeholder={t('specialists.lessons.none')}
                      onChange={(e) => {
                        setLessonsTouched(true);
                        setLessons(e.target.value);
                      }}
                    />
                    <span className="l-field__hint">{t('specialists.lessons.keptHint')}</span>
                  </div>
                </>
              )}
              <ErrorLine />
            </div>
          </>
        )}

        <footer className="agentform__foot">
          {existing ? (
            <Button variant="danger" icon="close" onClick={() => void deleteAgent(existing.id)}>
              {t('agentForm.delete')}
            </Button>
          ) : template ? (
            <Button variant="quiet" icon="chevronLeft" onClick={() => setTemplate(undefined)}>
              {t('specialists.templatesBack')}
            </Button>
          ) : (
            <span />
          )}
          <span className="grow" />
          <Button variant="quiet" onClick={close}>
            {t('agentForm.cancel')}
          </Button>
          {template && (
            <Button
              variant="quiet"
              icon={shared ? 'check' : 'copy'}
              title={t('specialists.share.copyHint')}
              disabled={!name.trim() || !role.trim()}
              onClick={() => void share()}
            >
              {shared ? t('common.copied') : t('specialists.share.copy')}
            </Button>
          )}
          {template && (
            <Button type="submit" variant="primary" disabled={!ready}>
              {t('agentForm.save')}
            </Button>
          )}
        </footer>
      </motion.form>
    </motion.div>
  );
}
