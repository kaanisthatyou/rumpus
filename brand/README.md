# Rumpus brand

Drawn 2026-11-12; in the app since 2026-11-13, when it replaced the arch left from the Serai name. No trademark
search has been made for the mark, as none has for the name (PLAN.md, section 10).

Where it lives in the app:

- The app icon: `apps/desktop/build/icon.svg` is a copy of `logo/app-icon.svg`; `pnpm icon` renders the Windows
  `.ico`, the Linux `.png` and the phone's web-app icons from it. A changed icon reaches an installed app only with
  a new installer.
- In the window: `Mark` and `Bub` in `packages/ui/src/mascot.tsx` (the title bar, the rail, the launcher, quick
  entry, the loading screen; Bub on an empty channel, on the overview when nothing runs, and on an unpaired
  phone). Their colors come from `--mark-body` and `--mark-face`: the accent bubble on the dark theme, graphite on
  the light one, so the mark follows the accent a person picks.

## The mark

A speech bubble whose face is a terminal prompt and a cursor: `>` and `▮`.

- The bubble: Rumpus is a place where people talk, to each other and to agents.
- The prompt and the cursor: the agents are command-line programs. Rumpus drives the CLIs people already have.
- Read as a face it winks, and it is tilted six degrees: a rumpus is a lively noise, not a meeting.

The cursor is the eye that blinks. Wherever the mark is animated, that is its one idle movement.

## Files

| File | For |
|---|---|
| `logo/mark.svg` | Dark grounds: lime bubble, graphite face |
| `logo/mark-on-lime.svg` | Lime grounds: graphite bubble, lime face |
| `logo/mark-mono-ink.svg`, `mark-mono-paper.svg` | One color (print, engraving, a watermark); the face is cut out |
| `logo/wordmark-ink.svg`, `wordmark-paper.svg` | The word alone |
| `logo/lockup-on-dark.svg`, `-on-lime.svg`, `-on-light.svg` | Mark and word together; the usual form |
| `logo/app-icon.svg`, `app-icon-dark.svg` | The app icon (lime tile; the dark tile is the alternative) |
| `logo/favicon.svg` | Browser tab |
| `bub/` | The mascot's poses, each for dark and for lime grounds |
| `png/` | The same, rendered |

## The word

"rumpus", lowercase, in Bricolage Grotesque ExtraBold (OFL; optical size 96, width 100), outlined, tracked at
-30/1000. Each letter is knocked a little out of line (rotations -5, 4, -2, 5, -4, 3 degrees), the same way every
time: the word is a drawing, not typed text. Headlines on the site and the posters use the same face with a
milder version of the same tilt.

## Colors

| Name | Value | Use |
|---|---|---|
| Lime | `#C6F24E` | The mark, and whole grounds in marketing. In the app it stays the one accent |
| Graphite | `#0A0B0D` | Ink on lime; the dark ground |
| Paper | `#E9ECF1` | Text on graphite; tape and stickers |
| Mute | `#969CA7` | Secondary text on graphite |
| Signal | `#FF9F70` | Only for what is refused or removed (the app's diff color) |

These are the app's own tokens (`packages/ui/src/styles.css`). Marketing differs from the app in one thing: it
floods with lime where the app only marks what is live.

## Bub

The mascot is the mark come alive, so it has no legs: it hops on the bubble's tail. Arms appear only when it
holds something. Poses: `wink` (the default), `shout`, `wave`, `sleep`, `placard` (it carries a sign that says NO,
for the things Rumpus refuses). The name is a working name.

In the app Bub only fills a page that has nothing on it yet (`wave` on an empty channel, `wink` on an agent's
empty channel, `sleep` when no job runs). It never speaks, never moves on its own, and never carries the NO sign:
the app's own voice stays impersonal (PLAN.md 7.1). The other poses are for marketing.

## Rules

- Keep clear space of half the bubble's height around the mark or the lockup.
- Smallest sizes: the mark 16 px, the lockup 96 px wide. Below 24 px use `favicon.svg` or the mark, not a pose.
- Lime bubble on dark, graphite bubble on lime or light. Never lime on white, never a third color.
- Do not straighten the tilt, redraw the face, add a mouth to the logo (the mouth belongs to Bub), outline it,
  or set the word in another typeface.

## Voice

The app's own text is impersonal (PLAN.md 7.1). Marketing is not the app: it may address the reader and have an
attitude. It still states only what is true of the product, names what Rumpus refuses to do, and never promises a
date.
