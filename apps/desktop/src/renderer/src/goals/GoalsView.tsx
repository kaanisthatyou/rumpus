// The goals of the workspace: open ones first, each with its channel and progress.
import { Button, Icon } from '@lonca/ui';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../store';
import { GoalCard, goalIsOpen } from './GoalCard';

export function GoalsView() {
  const { t } = useTranslation();
  const goals = useApp((s) => s.goals);
  const workspace = useApp((s) => s.workspace);
  const openChannel = useApp((s) => s.openChannel);
  const sorted = [...goals].sort((a, b) => Number(goalIsOpen(b)) - Number(goalIsOpen(a)) || b.created - a.created);
  return (
    <main className="chat">
      <header className="chat__head">
        <h2>
          <Icon name="target" size={15} />
          {t('shell.goals')}
        </h2>
        <span className="chat__topic">{t('goal.viewHint')}</span>
      </header>
      {sorted.length === 0 ? (
        <section className="empty">
          <span className="empty__icon">
            <Icon name="target" size={22} />
          </span>
          <p className="empty__title">{t('shell.empty.goals')}</p>
          <p className="empty__sub">{t('goal.emptyHint')}</p>
        </section>
      ) : (
        <div className="feed goals">
          {sorted.map((g) => {
            const channel = workspace?.channels.find((c) => c.id === g.channelId);
            return (
              <motion.div key={g.id} className="goals__item" layout="position">
                <div className="goals__where">
                  <Button size="sm" variant="quiet" onClick={() => void openChannel(g.channelId)}>
                    #{channel?.name ?? '—'}
                  </Button>
                  <span className="muted l-mono">{new Date(g.created).toLocaleString()}</span>
                </div>
                <GoalCard goal={g} agent={workspace?.agents.find((a) => a.id === g.agentId)} />
              </motion.div>
            );
          })}
        </div>
      )}
    </main>
  );
}
