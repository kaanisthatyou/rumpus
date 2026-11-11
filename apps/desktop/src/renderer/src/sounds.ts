// The app's sounds: a few short tones made on the spot (no audio files), for what a person may want to hear
// without looking: a job that ended, one that waits for approval, someone who asks to join, another member's
// message. Turned off in Settings → General.

export type Sound = 'done' | 'failed' | 'attention' | 'message' | 'join';

/** Each sound as notes: frequency (Hz), start and length (seconds). */
const NOTES: Record<Sound, { f: number; at: number; len: number }[]> = {
  // Up a fifth: finished.
  done: [
    { f: 659.25, at: 0, len: 0.09 },
    { f: 987.77, at: 0.09, len: 0.18 },
  ],
  // Down a fourth, lower: it did not work.
  failed: [
    { f: 392, at: 0, len: 0.1 },
    { f: 293.66, at: 0.11, len: 0.22 },
  ],
  // The same note twice: someone is waited for.
  attention: [
    { f: 783.99, at: 0, len: 0.07 },
    { f: 783.99, at: 0.15, len: 0.09 },
  ],
  message: [{ f: 880, at: 0, len: 0.09 }],
  join: [
    { f: 523.25, at: 0, len: 0.07 },
    { f: 659.25, at: 0.08, len: 0.07 },
    { f: 783.99, at: 0.16, len: 0.16 },
  ],
};

const VOLUME = 0.07;
/** The same sound is not played again within this time (several jobs ending at once make one sound). */
const GAP_MS = 400;

let context: AudioContext | undefined;
const last: Partial<Record<Sound, number>> = {};

export function play(sound: Sound): void {
  const now = Date.now();
  if (now - (last[sound] ?? 0) < GAP_MS) return;
  last[sound] = now;
  // What was played last, for tests (a sound cannot be heard by a script).
  document.documentElement.dataset.sound = `${sound}:${now}`;
  try {
    context ??= new AudioContext();
    const ctx = context;
    if (ctx.state === 'suspended') void ctx.resume();
    for (const note of NOTES[sound]) {
      const start = ctx.currentTime + note.at;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.f;
      // A soft start and a quick fade, so no note clicks.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(VOLUME, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + note.len + 0.02);
    }
  } catch {
    // no audio device: the app is silent
  }
}
