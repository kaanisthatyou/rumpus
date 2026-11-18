// Reminders of what waits on a person (PLAN.md 5.23): an agent whose job waits for an approval, or whose report
// left questions nobody answered, writes into its channel every few minutes, as a message of its own, until the
// person presses the button under one of them. The lines are put together from pieces here (no model call, no
// tokens), in the person's language, so no two read the same.
import type { Agent, Message } from '@lonca/protocol';
import { inQuietHours } from './advisors.js';
import { newId } from './ids.js';

export type NudgeLanguage = 'tr' | 'en';

/** One thing that waits on the person, under a key that stays the same while it waits. */
export interface Waiting {
  key: string;
  /** A short noun phrase in the person's language: "`npm run build` onayı". */
  what: string;
  /** The channel it waits in: writing there counts as an answer. */
  channelId?: string;
}

/** What a line is about. */
export interface NudgeTopic {
  name: string;
  items: Waiting[];
  /** How many reminders of this run came before this one. */
  count: number;
}

type Rand = () => number;

const pick = <T>(list: readonly T[], r: Rand): T => list[Math.floor(r() * list.length) % list.length] as T;
const chance = (p: number, r: Rand) => r() < p;

/** A word typed with a few more of its last letters ("Kankaaa", "Eeee", "Pşşş"). */
function stretch(word: string, r: Rand, min = 1, max = 3): string {
  const last = word.slice(-1);
  return word + last.repeat(min - 1 + Math.floor(r() * (max - min + 1)));
}

function capital(text: string, lang: NudgeLanguage): string {
  return text ? (text[0] ?? '').toLocaleUpperCase(lang) + text.slice(1) : text;
}

function lower(text: string, lang: NudgeLanguage): string {
  return text ? (text[0] ?? '').toLocaleLowerCase(lang) + text.slice(1) : text;
}

/**
 * How far into a run a line is: 0 the first (calm), 1 the second (a reminder), 2 the third (a little reproach),
 * 3 the fourth and fifth (impatient), 4 from the sixth on (pleading, a bit theatrical).
 */
export type NudgeLevel = 0 | 1 | 2 | 3 | 4;

export function levelOf(count: number): NudgeLevel {
  return count <= 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 3 : 4;
}

interface Ctx {
  name: string;
  /** The first thing that waits (a noun phrase). */
  what: string;
  n: number;
  /** Which reminder of the run this is, from 1. */
  nth: number;
  r: Rand;
}

/** One level's pieces. `one` and `many` are sentences that start in lower case (they may follow an opening). */
interface Level {
  open: (c: Ctx) => string[];
  one: (c: Ctx) => string[];
  many: (c: Ctx) => string[];
  close: (c: Ctx) => string[];
  short: (c: Ctx) => string[];
  listIntro: (c: Ctx) => string[];
  listOutro: (c: Ctx) => string[];
  button: string[];
}

interface Pieces {
  levels: [Level, Level, Level, Level, Level];
  andMore: (k: number) => string;
  /** Openings that run on into the sentence with no comma ("Kusura bakma ama"). */
  runsOn: RegExp;
}

const TR: Pieces = {
  andMore: (k) => (k === 1 ? ' ve bir şey daha' : ` ve ${k} şey daha`),
  runsOn: / ama$/,
  levels: [
    // The first: a light tap on the shoulder.
    {
      open: ({ name, r }) => [
        'Pşş',
        `${stretch('Kanka', r, 2, 3)}, pşş`,
        'Kanka',
        'Hocam',
        'Başkan',
        name,
        `Selam ${name}`,
        'Bi saniye',
        'Kusura bakma ama',
      ],
      one: ({ what }) => [
        `${what} sende bekliyor, müsait olunca bakarsın.`,
        `${what} için sana ihtiyacım var.`,
        `${what} duruyor, bir bakabilir misin?`,
        `masada ${what} var, karar senin.`,
        `${what} için senden bir işaret lazım.`,
        `ufak bir şey: ${what} sende.`,
      ],
      many: ({ n }) => [
        `${n} şey senin kararını bekliyor, müsait olunca bakarsın.`,
        `sende ${n} küçük iş birikti.`,
        `${n} konuda senin sözünü bekliyorum.`,
      ],
      close: () => ['Acelesi yok.', 'Müsait olunca.', 'Ben buradayım.', 'Sen dersen devam ederim.', '', ''],
      short: ({ name }) => ['Pşş.', `Pşş, ${name}.`, 'Senin kararını bekleyen bir şey var.', 'Bi bakar mısın?'],
      listIntro: ({ n }) => [
        n > 1 ? `Toparladım, ${n} şey senden haber bekliyor:` : 'Toparladım, senden bekleyen şu:',
        'Kısa bir liste, hepsi sende:',
      ],
      listOutro: () => [
        'Müsait olunca bakarsın, ben buradayım.',
        'Cevabı yazman yeter, gerisini ben hallederim.',
        'Kararı bana bırakırsan da söyle, ona göre giderim.',
      ],
      button: ['Tamam', 'Bakarım', 'Gördüm', 'Birazdan', 'Tamam, bakıyorum', 'Okey'],
    },
    // The second: a reminder.
    {
      open: ({ name }) => [
        'Kanka',
        'Hocam',
        name,
        'Pşş, bir daha',
        'Hatırlatayım dedim',
        'Aklında olsun diye yazıyorum',
        'Unutulmasın diye yazıyorum',
        'Kusura bakma ama',
      ],
      one: ({ what }) => [
        `${what} hâlâ sende.`,
        `${what} hâlâ bekliyor.`,
        `${what} hâlâ duruyor, bir bakıver.`,
        `${what} için hâlâ senden haber bekliyorum.`,
        `${what} konusu hâlâ açık.`,
      ],
      many: ({ n }) => [
        `${n} şey hâlâ senin kararını bekliyor.`,
        `sende bekleyen ${n} şey hâlâ duruyor.`,
        `${n} konu hâlâ açık.`,
      ],
      close: () => ['Bakıver bi.', 'Müsaitsen bakarsın.', 'Haber ver yeter.', 'Bekliyorum.', '', ''],
      short: ({ name }) => ['Pşş, hâlâ buradayım.', `${name}, unutmadın değil mi?`, 'Hatırlatma.', 'Bir bakar mısın?'],
      listIntro: () => ['Hatırlatayım, şunlar hâlâ sende:', 'Liste duruyor:'],
      listOutro: () => ['Hangisinden başlarsan, ben hazırım.', 'Bi bakarsan kaldığım yerden devam ederim.'],
      button: ['Tamam', 'Bakıyorum', 'Tamam tamam', 'Geliyorum', 'Gördüm', 'Birazdan'],
    },
    // The third: "Eee?"
    {
      open: ({ name, r }) => [
        stretch('Eee', r, 1, 3),
        `${stretch('Kanka', r, 2, 3)}`,
        name,
        'Hocam bak',
        'Yine ben',
        'Ee hocam',
      ],
      one: ({ what }) => [
        `${what} hâlâ orada duruyor ha.`,
        `${what} hâlâ cevapsız.`,
        `ben hazırım ama ${what} sende kaldı.`,
        `${what} yüzünden elim kolum bağlı.`,
        `${what} için bekliyorum, hâlâ.`,
      ],
      many: ({ n }) => [
        `${n} şey hâlâ sende, hiçbiri kıpırdamadı.`,
        `sende ${n} iş var, hepsi orada duruyor.`,
        `${n} konu hâlâ cevapsız.`,
      ],
      close: () => ['Ne diyosun?', 'Eee, ne diyosun?', 'Bekliyorum ama.', 'Bi bakar mısın artık?', 'Hadi.'],
      short: ({ r }) => [`${stretch('Eee', r, 2, 4)}?`, 'Ne diyosun?', 'Eee, ne diyosun?', 'Hâlâ bekliyorum.'],
      listIntro: () => ['Hâlâ sende bekleyenler:', 'Bunlar hâlâ duruyor:'],
      listOutro: () => ['Eee, hangisinden başlıyoruz?', 'Ben hazırım, sen?'],
      button: ['Tamam tamam', 'Geliyorum', 'Bakıyorum şimdi', 'Bi dakka', 'Hallediyorum', 'Duydum'],
    },
    // The fourth and fifth: impatient.
    {
      open: ({ name, r, nth }) => [
        stretch('Kanka', r, 3, 5),
        `${name} yaa`,
        'Hocam yaa',
        'Bak şimdi',
        'Bir daha soruyorum',
        'Biliyorum, yine ben',
        `${nth}. kez yazıyorum`,
      ],
      one: ({ what }) => [
        `${what} hâlâ bekliyor, ben de onu bekliyorum.`,
        `${what} sende takıldı kaldı.`,
        `hâlâ ${what} duruyor, ben de boş boş oturuyorum.`,
        `${what} için kaç kere yazdım, farkındasın değil mi?`,
        `${what} artık beni bekletiyor.`,
      ],
      many: ({ n }) => [
        `${n} şey hâlâ sende, ben de boş boş oturuyorum.`,
        `${n} iş seni bekliyor, ben de onları bekliyorum.`,
        `sende ${n} şey var ve ben sıkılmaya başladım.`,
      ],
      close: () => [
        'Hadi ama.',
        'Hadi hadi.',
        'İki dakikanı alır.',
        'Sıkılmaya başladım.',
        'Yoksa ben mi karar vereyim?',
      ],
      short: ({ r, nth }) => [
        `${stretch('Kanka', r, 3, 5)}.`,
        'Hadi ama.',
        `${nth}. hatırlatma.`,
        'Hâlâ buradayım, iş de burada.',
      ],
      listIntro: () => ['Liste değişmedi, hepsi hâlâ sende:', 'Tekrar yazıyorum, hâlâ bekleyenler:'],
      listOutro: () => ['Hadi, iki dakikanı alır.', 'Bir tanesinden başlasan yeter.'],
      button: ['Tamam tamam geldim', 'Geliyorum geliyorum', 'Tamam, bakıyorum', 'Bi dakka ya', 'Duydum duydum'],
    },
    // From the sixth on: pleading, a little theatrical.
    {
      open: ({ name, r, nth }) => [
        stretch('Kanka', r, 4, 6),
        `${stretch('Hoca', r, 3, 5)}m`,
        `${name}, ${name}`,
        `${nth}. kez yazıyorum`,
        'Tamam, artık resmen ısrar ediyorum',
        'Bak yine ben',
      ],
      one: ({ what }) => [
        `${what} burada kök saldı.`,
        `${what} ile burada beraber yaşlanıyoruz.`,
        `${what} hâlâ duruyor, ben de bir yere kıpırdamıyorum.`,
        `${what} için yazmaktan parmaklarım yoruldu.`,
        `${what} bekleye bekleye eskidi.`,
      ],
      many: ({ n }) => [
        `${n} şey burada kök saldı.`,
        `${n} işle beraber burada yaşlanıyoruz.`,
        `${n} şey bekliyor, ben de onlarla beraber bekliyorum, hâlâ.`,
      ],
      close: () => [
        'Kahveni al da gel artık.',
        'Ben burada parmaklarımı tıkırdatıyorum.',
        'Gelene kadar yazmaya devam.',
        'Bak susmam ha.',
        'Düğmeye bassan bari.',
      ],
      short: ({ r, nth }) => [
        `${stretch('Kanka', r, 4, 6)}.`,
        'Pşş. Pşş. Pşş.',
        `${stretch('Eee', r, 3, 5)}?`,
        `${nth}. hatırlatma, sayıyorum.`,
        'Yoklama: ben buradayım, iş de burada.',
      ],
      listIntro: () => ['Ezberledim artık, yine de yazayım:', 'Aynı liste, hâlâ:'],
      listOutro: () => ['Gelene kadar buradayım.', 'Düğmeye basmak da bir cevap, bilgin olsun.'],
      button: ['Tamam tamam geldim', 'Geldim geldim', 'Tamam, sus artık', 'Yeter, gördüm', 'Az sabret', 'Tamam be'],
    },
  ],
};

const EN: Pieces = {
  andMore: (k) => (k === 1 ? ' and one more' : ` and ${k} more`),
  runsOn: /^$/,
  levels: [
    {
      open: ({ name, r }) => [
        'Psst',
        `${stretch('Heyy', r, 1, 2)}, psst`,
        'Hey',
        name,
        `Hi ${name}`,
        'Quick one',
        'Sorry to bug you',
      ],
      one: ({ what }) => [
        `${what} is waiting on you, whenever you have a minute.`,
        `I need you for ${what}.`,
        `${what} is on the table, mind taking a look?`,
        `${what} is your call.`,
        `small thing: ${what} is with you.`,
      ],
      many: ({ n }) => [`${n} things are waiting on your call, no rush.`, `${n} small things piled up on your side.`],
      close: () => ['No rush.', 'Whenever you can.', 'I am right here.', 'Say the word and I keep going.', '', ''],
      short: ({ name }) => ['Psst.', `Psst, ${name}.`, 'Something is waiting on your call.', 'Mind taking a look?'],
      listIntro: ({ n }) => [
        n > 1 ? `Rounded them up, ${n} things are waiting on you:` : 'Rounded it up, this is waiting on you:',
        'A short list, all with you:',
      ],
      listOutro: () => ['Whenever you can, I am here.', 'Just write the answer, I handle the rest.'],
      button: ['OK', 'Will look', 'Got it', 'In a bit', 'OK, looking'],
    },
    {
      open: ({ name }) => [
        'Hey',
        name,
        'Psst, again',
        'Just a reminder',
        'Writing so it does not slip',
        'Sorry to bug you again',
      ],
      one: ({ what }) => [
        `${what} is still with you.`,
        `${what} is still waiting.`,
        `${what} is still open, have a look.`,
        `still waiting to hear from you on ${what}.`,
      ],
      many: ({ n }) => [`${n} things are still waiting on your call.`, `${n} things are still open.`],
      close: () => ['Have a look.', 'When you can.', 'Just let me know.', 'Waiting.', '', ''],
      short: ({ name }) => [
        'Psst, still here.',
        `${name}, you did not forget, right?`,
        'Reminder.',
        'Mind taking a look?',
      ],
      listIntro: () => ['A reminder, these are still with you:', 'The list is still here:'],
      listOutro: () => ['Start with any of them, I am ready.', 'Have a look and I pick up where I left off.'],
      button: ['OK', 'Looking', 'OK OK', 'Coming', 'Got it'],
    },
    {
      open: ({ name, r }) => [stretch('Sooo', r, 1, 3), name, 'Hey, look', 'Me again', 'So'],
      one: ({ what }) => [
        `${what} is still just sitting there.`,
        `${what} is still unanswered.`,
        `I am ready, but ${what} is stuck with you.`,
        `my hands are tied until ${what} is settled.`,
      ],
      many: ({ n }) => [`${n} things are still with you, none of them moved.`, `${n} things are still unanswered.`],
      close: () => ['So, what do you say?', 'What do you think?', 'Still waiting, though.', 'Take a look already?'],
      short: ({ r }) => [`${stretch('Sooo', r, 2, 4)}?`, 'What do you say?', 'Still waiting.'],
      listIntro: () => ['Still with you:', 'These are still sitting there:'],
      listOutro: () => ['So, where do we start?', 'I am ready, are you?'],
      button: ['OK OK', 'Coming', 'Looking now', 'One sec', 'On it', 'Heard you'],
    },
    {
      open: ({ name, r, nth }) => [
        `${stretch('Heyy', r, 2, 4)}`,
        `${name}, come on`,
        'Look',
        'Asking again',
        'I know, me again',
        `Message number ${nth}`,
      ],
      one: ({ what }) => [
        `${what} is still waiting, and so am I.`,
        `${what} is stuck on your side.`,
        `${what} is still there, and I am just sitting here.`,
        `you know how many times I wrote about ${what}, right?`,
      ],
      many: ({ n }) => [
        `${n} things are still with you, and I am just sitting here.`,
        `${n} things wait on you, and I wait on them.`,
      ],
      close: () => [
        'Come on.',
        'Come on, come on.',
        'Takes two minutes.',
        'Getting bored here.',
        'Or should I decide?',
      ],
      short: ({ r, nth }) => [
        `${stretch('Heyy', r, 3, 5)}.`,
        'Come on.',
        `Reminder number ${nth}.`,
        'Still here, and so is the work.',
      ],
      listIntro: () => ['Same list, all still with you:', 'Writing it again, still waiting:'],
      listOutro: () => ['Come on, it takes two minutes.', 'Starting with one of them is enough.'],
      button: ['OK OK, coming', 'Coming, coming', 'OK, looking', 'One sec, geez', 'Heard you, heard you'],
    },
    {
      open: ({ name, r, nth }) => [
        stretch('Heyy', r, 4, 6),
        `${name}, ${name}`,
        `Message number ${nth}`,
        'OK, I am officially insisting',
        'Look, me again',
      ],
      one: ({ what }) => [
        `${what} has grown roots here.`,
        `${what} and I are growing old together.`,
        `${what} is still here, and I am not going anywhere.`,
        `my fingers are tired from writing about ${what}.`,
      ],
      many: ({ n }) => [`${n} things have grown roots here.`, `${n} things and I are growing old together.`],
      close: () => [
        'Grab a coffee and come over already.',
        'Drumming my fingers over here.',
        'I keep writing until you come.',
        'I will not go quiet.',
        'Press the button, at least.',
      ],
      short: ({ r, nth }) => [
        `${stretch('Heyy', r, 4, 6)}.`,
        'Psst. Psst. Psst.',
        `${stretch('Sooo', r, 3, 5)}?`,
        `Reminder ${nth}, I am counting.`,
      ],
      listIntro: () => ['I know it by heart now, but here it is again:', 'Same list, still:'],
      listOutro: () => ['I am here until you come.', 'Pressing the button counts as an answer, just so you know.'],
      button: ['OK OK, I am here', 'Coming, coming', 'OK, stop', 'Enough, I saw it', 'Hold your horses', 'Fine, fine'],
    },
  ],
};

const PIECES: Record<NudgeLanguage, Pieces> = { tr: TR, en: EN };

/** A reminder's text: a short line, a sentence or two, or a list of what waits, as impatient as the run is long. */
export function nudgeText(lang: NudgeLanguage, topic: NudgeTopic, r: Rand = Math.random): string {
  const p = PIECES[lang];
  const level = p.levels[levelOf(topic.count)];
  const first = topic.items[0]?.what ?? '';
  const n = topic.items.length;
  const name = topic.name.trim().split(/\s+/)[0] || (lang === 'tr' ? 'Hocam' : 'there');
  const ctx: Ctx = { name, what: first, n, nth: topic.count + 1, r };
  const open = pick(level.open(ctx), r);
  const what = n > 1 && chance(0.5, r) ? first + p.andMore(n - 1) : first;
  const body = n > 1 && chance(0.6, r) ? pick(level.many(ctx), r) : pick(level.one({ ...ctx, what }), r);
  const close = pick(level.close(ctx), r);
  const shape = r();
  let text: string;
  if (shape < 0.16) text = pick(level.short(ctx), r);
  else if (shape < 0.3 || (n > 2 && shape < 0.45)) {
    const list = topic.items
      .slice(0, 4)
      .map((i) => `- ${i.what}`)
      .join('\n');
    const more = n > 4 ? `\n- ${p.andMore(n - 4).trim()}` : '';
    const lead = chance(0.5, r) && !p.runsOn.test(open) ? `${open}. ` : '';
    text = `${lead}${pick(level.listIntro(ctx), r)}\n${list}${more}\n\n${pick(level.listOutro(ctx), r)}`;
  } else if (shape < 0.55 || p.runsOn.test(open))
    text = `${open}${p.runsOn.test(open) ? ' ' : ', '}${body}${close ? ` ${close}` : ''}`;
  else if (shape < 0.75) text = `${open}. ${capital(body, lang)}${close ? ` ${close}` : ''}`;
  else if (shape < 0.88 && close) text = `${capital(body, lang)} ${close}`;
  else text = `${open}. ${capital(body, lang)}`;
  text = text.replace(/\s+([.,?:])/g, '$1').trim();
  // Typed in a hurry, now and then: a small first letter, no final full stop.
  // (Not a name or a word in capitals: "kaan" and "oK" read as typos, not haste.)
  if (chance(0.18, r) && !text.startsWith(name) && !/^\p{Lu}{2}/u.test(text)) text = lower(text, lang);
  if (chance(0.25, r) && text.endsWith('.') && !text.endsWith('..')) text = text.slice(0, -1);
  return text;
}

/** The label of the button that stops the reminders: a different one each time, curter as the run goes on. */
export function nudgeButton(lang: NudgeLanguage, r: Rand = Math.random, count = 0): string {
  return pick(PIECES[lang].levels[levelOf(count)].button, r);
}

/** How long the agent "types" a line before it shows (ms). */
export function typingMs(text: string, r: Rand = Math.random): number {
  return Math.round(Math.min(7000, Math.max(1600, text.length * 38 + 500 + r() * 1400)));
}

// ------------------------------------------------------------------------------------ questions in an answer

/** A line that hands something to the person: "Senin kararın:", "Sende bekleyenler", "Your call". */
const ASKS =
  /(senin karar|karar(ın)?ı bekleyen|karar sende|sende bekleyen|onayını bekle|senden (bir )?(cevap|onay|karar)|\bdecide\b|your call|waiting on you|need from you|your decision|up to you)/iu;
/** "Karar gereken bir şey yok", "nothing to decide": the hint says nothing waits. */
const NOTHING = /(\byok\b|hiçbir|gerek(miyor| yok)|\bnothing\b|\bnone\b|\bno decision|\bnot needed\b)/iu;

/**
 * Whether an agent's answer leaves a question to the person in its text, looking at its end (where the summary
 * and what is left go): `undefined` when not, else the first question it asks there ("" when it only says something
 * waits on the person).
 */
export function askedIn(text: string): string | undefined {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>\n]+>/g, ' ')
    .trim();
  // Only the answer's last part counts: a question asked on the way and settled later is no question left.
  const tail = plain
    .slice(-900)
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*(?:[-*+>]|\d+[.):])\s+/, '')
        .replace(/[*_`#|]+/g, '')
        .trim(),
    )
    .filter(Boolean)
    .slice(-10);
  let hint = false;
  let found: string | undefined;
  for (const line of tail) {
    if (ASKS.test(line) && !NOTHING.test(line)) hint = true;
    for (const sentence of line.split(/(?<=[.?!:])\s+/)) {
      const q = sentence.trim();
      if (!found && q.endsWith('?') && q.length >= 6 && !/^https?:/i.test(q)) found = q;
    }
  }
  return found ?? (hint ? '' : undefined);
}

// ---------------------------------------------------------------------------------------------- the schedule

const MINUTE = 60_000;
/** The first reminder comes this long after something started to wait. */
const FIRST = [3, 6] as const;
/** Then one every few minutes. */
const EVERY = [4, 10] as const;
/** After this many in a run the gaps grow, up to `LONGEST` minutes: an evening away is not a hundred lines. */
const STEADY = 6;
const LONGEST = 45;
/** Lines of a run kept to avoid saying the same thing twice in a row. */
const RECENT = 12;

interface Run {
  next: number;
  count: number;
  recent: string[];
  typing?: boolean;
}

export interface NudgerDeps {
  /** This device's agents that remind (their setting is on). */
  agents(): Agent[];
  /** What waits on this person from an agent. */
  waiting(agent: Agent, lang: NudgeLanguage): Waiting[];
  /** Where the agent writes its reminders. */
  channelOf(agent: Agent, items: Waiting[]): string | undefined;
  /** This person: their device id, name and language. */
  me(): { id: string; name: string; language: string };
  quietHours(): { from: string; to: string };
  post(message: Message): void;
  typing(e: { agentId: string; channelId: string; on: boolean }): void;
  /** What the person stopped the reminders for, by agent (kept on this computer). */
  loadMuted(): Record<string, string[]>;
  saveMuted(muted: Record<string, string[]>): void;
  now?: () => number;
  random?: Rand;
  /** Shortens every gap (tests): 0.01 makes minutes into fractions of a second. */
  scale?: number;
}

export class Nudger {
  private readonly runs = new Map<string, Run>();
  private muted: Record<string, string[]>;
  private timer: NodeJS.Timeout | undefined;
  private readonly waits = new Set<NodeJS.Timeout>();

  constructor(private readonly deps: NudgerDeps) {
    this.muted = deps.loadMuted();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private rand(): number {
    return (this.deps.random ?? Math.random)();
  }

  private gap(range: readonly [number, number], factor = 1): number {
    const minutes = range[0] + this.rand() * (range[1] - range[0]);
    return Math.round(Math.min(LONGEST, minutes * factor) * MINUTE * (this.deps.scale ?? 1));
  }

  start(): void {
    if (this.timer) return;
    const every = Math.max(100, Math.round(20_000 * (this.deps.scale ?? 1)));
    this.timer = setInterval(() => this.tick(), every);
    this.timer.unref?.();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const t of this.waits) clearTimeout(t);
    this.waits.clear();
  }

  /** Looks at what waits, starts or ends runs, and writes the reminders that are due. */
  tick(): void {
    const me = this.deps.me();
    const lang: NudgeLanguage = me.language === 'en' ? 'en' : 'tr';
    const now = this.now();
    const seen = new Set<string>();
    let mutedChanged = false;
    for (const agent of this.deps.agents()) {
      seen.add(agent.id);
      const items = this.deps.waiting(agent, lang);
      const keys = new Set(items.map((i) => i.key));
      // What no longer waits is forgotten from the stopped list too: if it comes back, it is new.
      const muted = (this.muted[agent.id] ?? []).filter((k) => keys.has(k));
      if (muted.length !== (this.muted[agent.id] ?? []).length) {
        mutedChanged = true;
        if (muted.length) this.muted[agent.id] = muted;
        else delete this.muted[agent.id];
      }
      const open = items.filter((i) => !muted.includes(i.key));
      if (open.length === 0) {
        this.runs.delete(agent.id);
        continue;
      }
      let run = this.runs.get(agent.id);
      if (!run) {
        run = { next: now + this.gap(FIRST), count: 0, recent: [] };
        this.runs.set(agent.id, run);
        continue;
      }
      if (run.typing || now < run.next) continue;
      if (inQuietHours(new Date(now), this.deps.quietHours())) continue;
      const channelId = this.deps.channelOf(agent, open);
      if (!channelId) continue;
      this.write(agent, channelId, run, open, me, lang);
    }
    for (const id of [...this.runs.keys()]) if (!seen.has(id)) this.runs.delete(id);
    if (mutedChanged) this.deps.saveMuted(this.muted);
  }

  private write(
    agent: Agent,
    channelId: string,
    run: Run,
    items: Waiting[],
    me: { id: string; name: string },
    lang: NudgeLanguage,
  ): void {
    const r = () => this.rand();
    let text = nudgeText(lang, { name: me.name, items, count: run.count }, r);
    for (let i = 0; i < 12 && run.recent.includes(text); i++) {
      text = nudgeText(lang, { name: me.name, items, count: run.count }, r);
    }
    run.recent = [...run.recent, text].slice(-RECENT);
    run.typing = true;
    this.deps.typing({ agentId: agent.id, channelId, on: true });
    const wait = setTimeout(
      () => {
        this.waits.delete(wait);
        this.deps.typing({ agentId: agent.id, channelId, on: false });
        run.typing = false;
        // Stopped (or answered) while it typed: the line is not sent.
        if (this.runs.get(agent.id) !== run) return;
        this.deps.post({
          id: newId(),
          channelId,
          author: { kind: 'agent', id: agent.id, name: agent.name },
          text,
          created: this.now(),
          nudge: { for: me.id, button: nudgeButton(lang, r, run.count) },
        });
        run.count += 1;
        run.next = this.now() + this.gap(EVERY, run.count > STEADY ? 1.4 ** (run.count - STEADY) : 1);
      },
      typingMs(text, r),
    );
    wait.unref?.();
    this.waits.add(wait);
  }

  /**
   * The person wrote a message: an answer to every agent whose reminders it concerns (written in the agent's own
   * channel or where something of its waits, naming it, or citing it) mutes them like the button. Returns their ids.
   */
  answered(
    m: { channelId: string; handles: string[]; citedAgent?: string | undefined },
    lang: NudgeLanguage,
  ): string[] {
    const out: string[] = [];
    for (const agent of this.deps.agents()) {
      const items = this.deps.waiting(agent, lang);
      if (items.length === 0 && !this.runs.has(agent.id)) continue;
      const hit =
        m.handles.includes(agent.handle) ||
        m.citedAgent === agent.id ||
        this.deps.channelOf(agent, items) === m.channelId ||
        items.some((i) => i.channelId === m.channelId);
      if (!hit) continue;
      this.mute(agent.id, lang);
      out.push(agent.id);
    }
    return out;
  }

  /** The button under a reminder: what waits from that agent now is not reminded of again. */
  mute(agentId: string, lang: NudgeLanguage): void {
    const agent = this.deps.agents().find((a) => a.id === agentId);
    const keys = agent ? this.deps.waiting(agent, lang).map((i) => i.key) : [];
    this.muted[agentId] = [...new Set([...(this.muted[agentId] ?? []), ...keys])];
    this.runs.delete(agentId);
    this.deps.saveMuted(this.muted);
  }
}
