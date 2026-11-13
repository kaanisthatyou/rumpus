# Marketing

Posters, social images and the reel, drawn as web pages and rendered with the installed Chrome (through
`playwright-core`, already a dev dependency) and `ffmpeg`. Nothing here is part of the app.

| What | Source | Output (`marketing/out/`) |
|---|---|---|
| Posters 1080 × 1350: `launch`, `no`, `race`, `discord`, `steer` | `posters.js`, `posters.css` | `<name>-tr.png`, `<name>-en.png` |
| Story 1080 × 1920, link preview 1200 × 630, GitHub preview 1280 × 640, X banner 1500 × 500 | the same | `story-*`, `og-*`, `github-*`, `banner-*` |
| Reel 1080 × 1920, 30.5 s, 30 fps | `reel/` | `rumpus-reel-tr.mp4`, `rumpus-reel-en.mp4` |
| The reel with a game clip as its opening, 38.2 s | `reel/token.js`, `reel/token.css` | `rumpus-token-tr.mp4`, `rumpus-token-en.mp4` |

```
node marketing/render.mjs            every poster, both languages
node marketing/render.mjs race og    only those whose name starts so
node marketing/reel/audio.mjs        the soundtrack (out/reel-audio.wav)
node marketing/reel/render.mjs tr    the reel; `en` for English
node marketing/reel/render.mjs tr --still 6.3 18.9    single frames, to check a moment
node marketing/reel/token-frames.mjs clip.mp4 --burst 13.7 --crop 603:1072:658:0    the game clip's frames and sound (out/token/)
node marketing/reel/audio.mjs --token                its music: the beat alone (out/token-music.wav)
node marketing/reel/render.mjs tr --hook token       the reel that opens with that clip
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
- Commands are shown under their name in the picture's language (`/meclis` in Turkish, `/council` in English), as
  `packages/protocol/src/commands.ts` names them. A new command goes into the lists in `posters.js`,
  `reel/reel.js` and `site/app.js`.
- `site/img/og.png` is `out/og-en.png`.
- The "token" opening (`reel.html?hook=token`) takes the place of the two Discord scenes. A game clip plays for
  ten seconds with nothing over it, as if the video were about the game: the player runs to a chest, the chest
  glows gold as it opens, and then comes the game's gold burst: the Fortnite "pirate token" of November 2026, whose drop every
  edit of that month is built around. Where the game then shows its "you found" banner, a blurred copy of the
  clip hides it and ours says Rumpus, with Bub as the item; the banner turns from the game's gold to lime, Bub
  grows out of it, and the reel goes on. Its sound is the clip's own until Bub leaves the banner, then only the
  beat, without a sound per event. The clip is someone else's recording, so it stays out of the
  repository: `token-frames.mjs` cuts any clip into `out/token/` (`--burst` is the second of the burst;
  `--crop` keeps an upright part with the banner in its middle and without a streamer's camera, chat or
  captions; the banner's places are in `reel/token.css`). Before a video with it is published, the clip needs
  its owner's permission or has to be recorded by one of us.
