// The board: /todo cards in four columns. Cards move by drag and drop or by their buttons; a card with an agent
// becomes a job with one click and follows the job's outcome.
import { CARD_STATUSES, type Card, type CardStatus } from '@lonca/protocol';
import { Button, Chip, Icon, IconButton } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../store';

/** Cards this window has just moved by hand (id → when); a move that follows within a moment is the person's own. */
const byHand = new Map<string, number>();
const BY_HAND_MS = 3000;
const MARK_MS = 1800;

/**
 * The cards whose column changed without this window doing it (an agent through its tools, a job that started or
 * ended, another member): marked for a moment, so the move is seen as someone's.
 */
function useMoved(cards: Card[]): ReadonlySet<string> {
  const before = useRef<Map<string, CardStatus> | undefined>(undefined);
  const [moved, setMoved] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const prev = before.current;
    before.current = new Map(cards.map((c) => [c.id, c.status]));
    if (!prev) return;
    const ids = cards
      .filter((c) => prev.has(c.id) && prev.get(c.id) !== c.status)
      .filter((c) => Date.now() - (byHand.get(c.id) ?? 0) > BY_HAND_MS)
      .map((c) => c.id);
    if (ids.length === 0) return;
    setMoved((s) => new Set([...s, ...ids]));
    setTimeout(() => setMoved((s) => new Set([...s].filter((id) => !ids.includes(id)))), MARK_MS);
  }, [cards]);
  return moved;
}

function CardView({ card, moved }: { card: Card; moved: boolean }) {
  const { t } = useTranslation();
  const agents = useApp((s) => s.workspace?.agents ?? []);
  const job = useApp((s) => (card.jobId ? s.jobs[card.jobId] : undefined));
  const updateCard = useApp((s) => s.updateCard);
  const deleteCard = useApp((s) => s.deleteCard);
  const runCard = useApp((s) => s.runCard);
  const openJob = useApp((s) => s.openJob);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const agent = card.assignee?.kind === 'agent' ? agents.find((a) => a.id === card.assignee?.id) : undefined;
  const running = job?.state === 'running';

  return (
    <motion.li
      layout
      layoutId={`card-${card.id}`}
      className={`card ${running ? 'is-running' : ''} ${moved ? 'is-moved' : ''}`}
      draggable={!editing}
      onDragStart={(e) => {
        const ev = e as unknown as React.DragEvent;
        ev.dataTransfer.setData('text/lonca-card', card.id);
        ev.dataTransfer.effectAllowed = 'move';
      }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 460, damping: 36 }}
    >
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) void updateCard(card.id, { title: title.trim() });
            setEditing(false);
          }}
        >
          <input
            className="l-input card__edit"
            // biome-ignore lint/a11y/noAutofocus: editing opens on request and typing is the next step
            autoFocus
            value={title}
            aria-label={t('board.new')}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          />
        </form>
      ) : (
        <button type="button" className="card__title" onDoubleClick={() => setEditing(true)}>
          {card.title}
        </button>
      )}
      <div className="card__meta">
        <label className="card__assign">
          <span className="l-sr">{t('board.assign')}</span>
          <select
            value={agent?.id ?? ''}
            onChange={(e) => void updateCard(card.id, { assigneeAgentId: e.target.value || null })}
          >
            <option value="">{t('board.nobody')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.handle}
              </option>
            ))}
          </select>
        </label>
        {job && <Chip mono>{t(`job.state.${job.state}`)}</Chip>}
        <span className="grow" />
        {job && <IconButton size="sm" icon="search" label={t('board.openJob')} onClick={() => void openJob(job.id)} />}
        {agent && !running && card.status !== 'done' && (
          <Button size="sm" icon="chevronRight" onClick={() => void runCard(card.id)}>
            {t('board.run')}
          </Button>
        )}
        <IconButton size="sm" icon="trash" label={t('board.delete')} onClick={() => void deleteCard(card.id)} />
      </div>
    </motion.li>
  );
}

function Column({ status, cards, moved }: { status: CardStatus; cards: Card[]; moved: ReadonlySet<string> }) {
  const { t } = useTranslation();
  const updateCard = useApp((s) => s.updateCard);
  const createCard = useApp((s) => s.createCard);
  const [over, setOver] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <section
      className={`col ${over ? 'is-over' : ''}`}
      aria-label={t(`board.status.${status}`)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/lonca-card')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/lonca-card');
        if (id) {
          byHand.set(id, Date.now());
          void updateCard(id, { status });
        }
      }}
    >
      <header className="col__head">
        <span className={`col__dot col__dot--${status}`} />
        <b>{t(`board.status.${status}`)}</b>
        <span className="l-mono">{cards.length}</span>
      </header>
      {status === 'todo' && (
        <form
          className="col__new"
          onSubmit={async (e) => {
            e.preventDefault();
            const text = draft.trim();
            if (!text) return;
            const handle = /(^|\s)@([a-z0-9][a-z0-9-]*)/.exec(text)?.[2];
            const title = text.replace(/(^|\s)@[a-z0-9][a-z0-9-]*/g, ' ').trim() || text;
            if (await createCard(title, handle ? { agentHandle: handle } : {})) setDraft('');
          }}
        >
          <Icon name="plus" size={14} />
          <input
            value={draft}
            aria-label={t('board.new')}
            placeholder={t('board.newPlaceholder')}
            onChange={(e) => setDraft(e.target.value)}
          />
        </form>
      )}
      <ul className="col__list">
        <AnimatePresence initial={false}>
          {cards.map((c) => (
            <CardView key={c.id} card={c} moved={moved.has(c.id)} />
          ))}
        </AnimatePresence>
        {cards.length === 0 && status !== 'todo' && <li className="col__empty">{t('board.empty')}</li>}
      </ul>
    </section>
  );
}

export function Board() {
  const { t } = useTranslation();
  const cards = useApp((s) => s.cards);
  const moved = useMoved(cards);
  return (
    <main className="chat board">
      <header className="chat__head">
        <h2>
          <Icon name="tasks" size={15} />
          {t('shell.tasks')}
        </h2>
        <span className="chat__topic">{t('board.hint')}</span>
      </header>
      <div className="board__cols">
        {CARD_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            moved={moved}
            cards={cards.filter((c) => c.status === status).sort((a, b) => b.updated - a.updated)}
          />
        ))}
      </div>
    </main>
  );
}
