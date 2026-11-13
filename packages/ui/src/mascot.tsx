// The product's mark and its mascot (brand/README.md). The mark is a speech bubble whose face is a terminal
// prompt and a cursor; Bub is the same bubble come alive, used as a picture where a page is empty. Both take their
// colors from `--mark-body` and `--mark-face` (styles.css): the accent on the dark theme, graphite on the light one.
// Neither ever says anything: they are pictures, not a voice of the app (PLAN.md 7.1).
import type { ReactNode } from 'react';

const BODY =
  'M152 88H360A96 96 0 0 1 456 184V284A96 96 0 0 1 360 380H276L170 456Q142 474 146 442L154 380H152A96 96 0 0 1 56 284V184A96 96 0 0 1 152 88Z';
const TILT = 'rotate(-6 256 256)';

const line = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Body() {
  return <path d={BODY} fill="var(--mark-body)" />;
}

/** The prompt and the cursor: the face of the mark. */
function Face() {
  return (
    <>
      <path d="M170 180l62 54-62 54" {...line} stroke="var(--mark-face)" strokeWidth={46} />
      <rect x={308} y={176} width={48} height={116} rx={24} fill="var(--mark-face)" />
    </>
  );
}

/** The product's mark: the bubble with its face, tilted. Decorative; the name is always written next to it. */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg className="l-mark" width={size} height={size} viewBox="44 68 420 420" aria-hidden="true">
      <g transform={TILT}>
        <Body />
        <Face />
      </g>
    </svg>
  );
}

export type BubPose = 'wink' | 'wave' | 'sleep';

/** Each pose's drawing and the box it fills (measured from brand/bub, so every pose sits tight in its box). */
const POSES: Record<BubPose, { box: [number, number, number, number]; draw: () => ReactNode }> = {
  wink: {
    box: [44, 68, 420, 420],
    draw: () => (
      <g transform={TILT}>
        <Body />
        <Face />
        <path d="M238 318q28 26 56 0" {...line} stroke="var(--mark-face)" strokeWidth={24} />
      </g>
    ),
  },
  wave: {
    box: [40, 40, 562, 448],
    draw: () => (
      <g transform={TILT}>
        <path d="M440 250q62 -20 70 -96" {...line} stroke="var(--mark-body)" strokeWidth={36} />
        <Body />
        <Face />
        <path d="M238 318q28 26 56 0" {...line} stroke="var(--mark-face)" strokeWidth={24} />
        <path d="M548 118l22-26M560 176l34-8" {...line} stroke="var(--mark-body)" strokeWidth={20} />
      </g>
    ),
  },
  sleep: {
    box: [45, -12, 540, 481],
    draw: () => (
      <g transform="rotate(4 256 256)">
        <Body />
        <path d="M168 240h66M300 240h64" {...line} stroke="var(--mark-face)" strokeWidth={40} />
        <path d="M246 322h40" {...line} stroke="var(--mark-face)" strokeWidth={22} />
        <path d="M452 64h44l-44 50h44" {...line} stroke="var(--mark-body)" strokeWidth={22} />
        <path d="M520 -14h30l-30 34h30" {...line} stroke="var(--mark-body)" strokeWidth={16} />
      </g>
    ),
  },
};

/**
 * Bub, the mascot, as a picture for an empty page: `wink` (the default), `wave` (a place to start), `sleep`
 * (nothing is running). `size` is its height. It never moves on its own: it comes in with the page around it.
 */
export function Bub({ pose = 'wink', size = 96 }: { pose?: BubPose; size?: number }) {
  const { box, draw } = POSES[pose];
  return (
    <svg
      className={`l-bub l-bub--${pose}`}
      width={Math.round((size * box[2]) / box[3])}
      height={size}
      viewBox={box.join(' ')}
      aria-hidden="true"
    >
      {draw()}
    </svg>
  );
}
