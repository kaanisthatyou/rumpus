// Bellek (PLAN.md 5.7): small Markdown sections people keep, and the suggestions agents make, which wait for a person.
import {
  type MemorySection,
  type MemoryState,
  type MemorySuggestion,
  PERSONAL_SECTIONS,
  WORKSPACE_SECTIONS,
} from '@lonca/protocol';
import { Button, Chip, Icon } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../store';

function Section({ section, state, readOnly }: { section: MemorySection; state: MemoryState; readOnly: boolean }) {
  const { t } = useTranslation();
  const saveMemory = useApp((s) => s.saveMemory);
  const stored =
    section === 'profile' || section === 'notes'
      ? state.personal[section]
      : state.workspace[section as 'decisions' | 'conventions' | 'glossary'];
  const [text, setText] = useState(stored);
  useEffect(() => setText(stored), [stored]);
  const limit = state.limits[section];
  const id = `memory-${section}`;
  return (
    <div className="mem__section">
      <div className="mem__head">
        <label htmlFor={id}>
          <b>{t(`memory.sections.${section}`)}</b>
        </label>
        <span className="grow" />
        <span className={`mem__count l-mono ${text.length > limit ? 'is-over' : ''}`}>
          {text.length} / {limit}
        </span>
      </div>
      <p className="muted mem__hint">{t(`memory.hints.${section}`)}</p>
      <textarea
        id={id}
        className="l-input mem__text"
        value={text}
        readOnly={readOnly}
        onChange={(e) => setText(e.target.value)}
      />
      {!readOnly && text !== stored && (
        <div className="mem__actions">
          <Button size="sm" variant="quiet" onClick={() => setText(stored)}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={text.length > limit}
            onClick={() => void saveMemory(section, text)}
          >
            {t('memory.save')}
          </Button>
        </div>
      )}
    </div>
  );
}

function Suggestion({ s, readOnly }: { s: MemorySuggestion; readOnly: boolean }) {
  const { t } = useTranslation();
  const acceptMemory = useApp((st) => st.acceptMemory);
  const rejectMemory = useApp((st) => st.rejectMemory);
  const channel = useApp((st) => st.workspace?.channels.find((c) => c.id === s.source.channelId));
  const [text, setText] = useState(s.text);
  return (
    <motion.li
      layout
      className="mem__sugg l-card"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
    >
      <div className="mem__head">
        <Icon name="layers" size={14} />
        <span>
          {t('memory.suggested', { name: s.source.name, section: t(`memory.sections.${s.section}`) })}
          {channel ? ` · #${channel.name}` : ''}
        </span>
        <span className="grow" />
        {s.flags?.map((f) => (
          <Chip key={f} tone="warn">
            {t(`memory.flags.${f}`, f)}
          </Chip>
        ))}
      </div>
      <textarea
        className="l-input mem__text mem__text--sugg"
        aria-label={t('memory.suggestionText')}
        value={text}
        readOnly={readOnly}
        onChange={(e) => setText(e.target.value)}
      />
      {s.flags?.length ? <p className="mem__warn">{t('memory.flagged')}</p> : null}
      <div className="mem__actions">
        <Button size="sm" variant="quiet" onClick={() => void rejectMemory(s.id)}>
          {t('memory.reject')}
        </Button>
        {!readOnly && (
          <Button size="sm" variant="primary" onClick={() => void acceptMemory(s.id, text)}>
            {t('memory.accept')}
          </Button>
        )}
      </div>
    </motion.li>
  );
}

export function MemoryView() {
  const { t } = useTranslation();
  const memory = useApp((s) => s.memory);
  const workspace = useApp((s) => s.workspace);
  const viewer = workspace?.kind === 'team' && workspace.role !== 'editor' && workspace.role !== 'admin';
  return (
    <main className="chat">
      <header className="chat__head">
        <h2>
          <Icon name="layers" size={15} />
          {t('shell.memory')}
        </h2>
        <span className="chat__topic">{t('memory.topic')}</span>
      </header>
      {memory ? (
        <div className="feed mem">
          {memory.suggestions.length > 0 && (
            <section aria-label={t('memory.suggestions')}>
              <h3 className="mem__group">{t('memory.suggestions')}</h3>
              <ul className="mem__list">
                <AnimatePresence initial={false}>
                  {memory.suggestions.map((s) => (
                    <Suggestion
                      key={s.id}
                      s={s}
                      readOnly={viewer && !(PERSONAL_SECTIONS as readonly string[]).includes(s.section)}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          )}
          <section aria-label={t('memory.personal')}>
            <h3 className="mem__group">{t('memory.personal')}</h3>
            <p className="muted">{t('memory.personalHint')}</p>
            {PERSONAL_SECTIONS.map((s) => (
              <Section key={s} section={s} state={memory} readOnly={false} />
            ))}
          </section>
          <section aria-label={t('memory.shared')}>
            <h3 className="mem__group">{t('memory.shared')}</h3>
            <p className="muted">{workspace?.kind === 'team' ? t('memory.sharedTeam') : t('memory.sharedPersonal')}</p>
            {WORKSPACE_SECTIONS.map((s) => (
              <Section key={s} section={s} state={memory} readOnly={viewer} />
            ))}
          </section>
        </div>
      ) : null}
    </main>
  );
}
