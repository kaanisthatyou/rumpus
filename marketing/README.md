# Marketing

Posters, social images and the reel, drawn as web pages and rendered with the installed Chrome (through
`playwright-core`, already a dev dependency) and `ffmpeg`. Nothing here is part of the app.

| What | Source | Output (`marketing/out/`) |
|---|---|---|
| Posters 1080 × 1350: `launch`, `no`, `race`, `discord`, `steer` | `posters.js`, `posters.css` | `<name>-tr.png`, `<name>-en.png` |
| Story 1080 × 1920, link preview 1200 × 630, GitHub preview 1280 × 640, X banner 1500 × 500 | the same | `story-*`, `og-*`, `github-*`, `banner-*` |
| Reel 1080 × 1920, 30.5 s, 30 fps | `reel/` | `rumpus-reel-tr.mp4`, `rumpus-reel-en.mp4` |

```
node marketing/render.mjs            every poster, both languages
node marketing/render.mjs race og    only those whose name starts so
node marketing/reel/audio.mjs        the soundtrack (out/reel-audio.wav)
node marketing/reel/render.mjs tr    the reel; `en` for English
node marketing/reel/render.mjs tr --still 6.3 18.9    single frames, to check a moment
```

To look at a page while changing it, serve the repository over http (the pages are ES modules) and open
`marketing/posters.html` (all posters; `?id=race&lang=tr` for one) or `marketing/reel/reel.html?lang=tr` (it
plays; a click starts it again with sound).

- The app window in every picture is `site/mock.js` and `site/mock.css`: a drawing of the shell with the app's
  own labels and example conversations. When the app's look changes, change it there once.
- The reel is one page on one clock (`reel/timeline.js`): every movement is a CSS animation whose delay is its
  time on that clock, so the renderer can stop them all and set the time frame by frame. The soundtrack reads
  the same file.
- The soundtrack is synthesized by `reel/audio.mjs`, so it contains nobody else's recording. A licensed track or
  a voice-over can replace it: `ffmpeg -i rumpus-reel-tr.mp4 -i track.wav -map 0:v -map 1:a -c:v copy -shortest out.mp4`.
- The Turkish reel opens with "yapay zekâ ajanlarınızı", the words the hook was given in; everywhere else the
  marketing says "agent", as the app does.
- Commands: in the app `/meclis`, `/özet`, `/durum` and `/hatırla` have no English name (only `/race` does), so
  English pictures show `/todo`, `/goal` and `/race` only. If the app gets English names, add them to the lists in
  `posters.js`, `reel/reel.js` and `site/app.js`.
- `site/img/og.png` is `out/og-en.png`.
