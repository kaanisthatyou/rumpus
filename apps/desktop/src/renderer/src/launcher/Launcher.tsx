import { Avatar, Button, Icon, Mark, slide, TextField } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccentPicker,
  AgentList,
  AppearancePreview,
  DataFolder,
  ErrorLine,
  LanguagePicker,
  MotionPicker,
  TailscaleRow,
  ThemePicker,
} from '../parts';
import { useApp } from '../store';

const STEPS = ['language', 'appearance', 'profile', 'data', 'agents', 'team'] as const;
type Step = (typeof STEPS)[number];

function StepBody({
  step,
  name,
  setName,
  nameError,
}: {
  step: Step;
  name: string;
  setName: (v: string) => void;
  nameError: boolean;
}) {
  const { t } = useTranslation();
  switch (step) {
    case 'language':
      return <LanguagePicker />;
    case 'appearance':
      return (
        <div className="stack">
          <div className="row-field">
            <span className="row-field__label">{t('launcher.appearance.theme')}</span>
            <ThemePicker id="launch" />
          </div>
          <div className="row-field">
            <span className="row-field__label">{t('launcher.appearance.accent')}</span>
            <AccentPicker />
          </div>
          <div className="row-field">
            <span className="row-field__label">{t('launcher.appearance.motion')}</span>
            <MotionPicker id="launch" />
          </div>
          <AppearancePreview />
        </div>
      );
    case 'profile':
      return (
        <div className="profile">
          <Avatar name={name} size={56} />
          <TextField
            label={t('launcher.profile.name')}
            placeholder={t('launcher.profile.placeholder')}
            value={name}
            maxLength={40}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            {...(nameError ? { error: t('launcher.profile.required') } : {})}
          />
        </div>
      );
    case 'data':
      return <DataFolder />;
    case 'agents':
      return <AgentList />;
    case 'team':
      return (
        <div className="stack">
          <TailscaleRow />
          <p className="muted">{t('launcher.team.solo')}</p>
        </div>
      );
  }
}

export function Launcher() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patch);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState(settings?.profile.name ?? '');
  const [nameError, setNameError] = useState(false);
  const step = STEPS[index] ?? 'language';
  const last = index === STEPS.length - 1;

  const go = (next: number) => {
    setDir(next > index ? 1 : -1);
    setIndex(next);
  };

  const onNext = async (e?: FormEvent) => {
    e?.preventDefault();
    if (step === 'profile') {
      const clean = name.trim();
      if (!clean) {
        setNameError(true);
        return;
      }
      setNameError(false);
      await patch({ profile: { name: clean } });
    }
    if (last) await patch({ onboarded: true });
    else go(index + 1);
  };

  return (
    <motion.main
      className="launch"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.985, transition: { duration: 0.2 } }}
    >
      <aside className="launch__aside">
        <div className="launch__brand">
          <Mark size={36} />
          <div>
            <h1>Lonca</h1>
            <p>{t('launcher.tagline')}</p>
          </div>
        </div>
        <ol className="launch__steps">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={i === index ? 'is-current' : i < index ? 'is-done' : ''}
              aria-current={i === index ? 'step' : undefined}
            >
              <span className="launch__num l-mono">{i < index ? <Icon name="check" size={12} /> : i + 1}</span>
              {t(`launcher.steps.${s}`)}
              {i === index && <motion.span layoutId="step-bar" className="launch__bar" />}
            </li>
          ))}
        </ol>
      </aside>

      <form className="launch__panel" onSubmit={(e) => void onNext(e)}>
        <div className="launch__count l-mono">{t('launcher.step', { n: index + 1, total: STEPS.length })}</div>
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.section
            key={step}
            className="launch__body"
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <h2>{t(`launcher.steps.${step}`)}</h2>
            <p className="launch__lead">{t(`launcher.${step}.body`)}</p>
            <StepBody step={step} name={name} setName={setName} nameError={nameError} />
          </motion.section>
        </AnimatePresence>
        <ErrorLine />
        <footer className="launch__foot">
          {index > 0 ? (
            <Button variant="quiet" icon="chevronLeft" onClick={() => go(index - 1)}>
              {t('common.back')}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" variant="primary" size="lg">
            {last ? t('common.finish') : t('common.continue')}
          </Button>
        </footer>
      </form>
    </motion.main>
  );
}
