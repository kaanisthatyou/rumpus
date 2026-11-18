// The report toast (PLAN.md 5.21): when a report arrives, Bub comes up over the lower right corner of the screen,
// floating a little, with the report's card beside it; under the pointer it raises its hand. A click opens the
// report in the main window. It leaves on its own after a while, but not while the pointer is on it. Its window
// is see-through and never takes the keyboard; only Bub and the card take the mouse.
import { Bub, Icon } from '@lonca/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { ReportToast } from '../../../shared/bridge';

const STAY_MS = 9000;

export function Toast() {
  const [toast, setToast] = useState<ReportToast>();
  const [shown, setShown] = useState(false);
  const [over, setOver] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const overRef = useRef(false);

  const leave = () => {
    clearTimeout(timer.current);
    setShown(false);
  };
  const arm = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!overRef.current) leave();
    }, STAY_MS);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: subscribed once; the handlers only set state
  useEffect(() => {
    const show = (next: ReportToast) => {
      const root = document.documentElement;
      root.dataset.theme = next.look.theme;
      root.dataset.accent = next.look.accent;
      root.dataset.motion = next.look.motion;
      setToast(next);
      setShown(true);
      arm();
    };
    const off = window.lonca.toast.onShow(show);
    void window.lonca.toast.pending().then((next) => next && show(next));
    return () => {
      off();
      clearTimeout(timer.current);
    };
  }, []);

  const solid = (on: boolean) => {
    overRef.current = on;
    setOver(on);
    void window.lonca.toast.solid(on);
    if (!on) arm();
  };

  return (
    <div className="toast-stage">
      <AnimatePresence
        onExitComplete={() => {
          setOver(false);
          overRef.current = false;
          void window.lonca.toast.solid(false);
          void window.lonca.toast.hide();
        }}
      >
        {shown && toast && (
          <motion.div
            key={toast.id}
            className={`toast ${over ? 'is-over' : ''}`}
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1, transition: { type: 'spring', stiffness: 380, damping: 28 } }}
            exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
            onMouseEnter={() => solid(true)}
            onMouseLeave={() => solid(false)}
          >
            <button
              type="button"
              className="toast__card"
              onClick={() => {
                clearTimeout(timer.current);
                setShown(false);
                void window.lonca.toast.open(toast.id);
              }}
            >
              <span className="toast__kind l-mono">
                <Icon name="report" size={12} />
                {toast.labels.kind}
                {toast.code && <span className="toast__code">#{toast.code}</span>}
              </span>
              <b className="toast__title">{toast.title}</b>
              <span className="toast__by">
                {toast.by}
                {toast.decisions > 0 && <span className="toast__ask">{toast.labels.decisions}</span>}
                {toast.count > 1 && <span className="toast__more">{toast.labels.more}</span>}
              </span>
              <span className="toast__open">
                {toast.labels.open}
                <Icon name="chevronRight" size={12} />
              </span>
            </button>
            <button type="button" className="toast__x" aria-label={toast.labels.close} onClick={leave}>
              <Icon name="close" size={11} />
            </button>
            <span className="toast__bub" aria-hidden="true">
              <Bub pose={over ? 'wave' : 'wink'} size={over ? 84 : 76} />
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
