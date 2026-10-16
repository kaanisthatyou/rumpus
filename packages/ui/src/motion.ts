// Motion presets. Springs for things that arrive or are pressed, a plain ease-out for things that move.
import type { Transition, Variants } from 'motion/react';

export const spring: Transition = { type: 'spring', stiffness: 520, damping: 34, mass: 0.9 };
export const softSpring: Transition = { type: 'spring', stiffness: 320, damping: 32 };
export const easeOut: Transition = { duration: 0.25, ease: [0.2, 0.8, 0.2, 1] };

/** A list whose items pop in one after another. */
export const stagger: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

export const popIn: Variants = {
  hidden: { opacity: 0, y: 6, scale: 0.985 },
  shown: { opacity: 1, y: 0, scale: 1, transition: spring },
};

/** Steps of a flow sliding in the direction of travel. */
export const slide: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 28 }),
  center: { opacity: 1, x: 0, transition: softSpring },
  exit: (dir: number) => ({ opacity: 0, x: dir * -28, transition: { duration: 0.15 } }),
};
