// Character presets for agents (PLAN.md 5.14): ready-made instruction lines an owner picks instead of writing
// them. An agent keeps the ids; the text comes from here every time, so a better wording reaches every agent that
// picked it. Names and one-line descriptions are in the UI's locale files (`traits.<id>`); the prompts are English,
// like every other instruction text. They are text only: no preset widens what an agent may do.

export interface AgentTrait {
  id: string;
  /** An icon of the design system. */
  icon:
    | 'shield'
    | 'bolt'
    | 'chat'
    | 'compass'
    | 'reply'
    | 'cap'
    | 'pencil'
    | 'flask'
    | 'tasks'
    | 'eye'
    | 'book'
    | 'spark';
  /** Presets that say the opposite: picking this one drops them. */
  excludes: readonly string[];
  prompt: string;
}

/** Most presets one agent carries; more than this and the lines start to cancel each other out. */
export const TRAITS_MAX = 6;

export const AGENT_TRAITS: readonly AgentTrait[] = [
  {
    id: 'careful',
    icon: 'shield',
    excludes: ['fast'],
    prompt:
      'Thorough. Before you call anything done, check it: run the tests or the command that proves it, read your own diff once more, and look at the callers of what you changed. Say what you checked and what you could not check; never report something as working on a guess.',
  },
  {
    id: 'fast',
    icon: 'bolt',
    excludes: ['careful'],
    prompt:
      'Quick. Take the shortest path to a working result: read only what the task needs, leave out extras nobody asked for, and report in a few lines. When a shortcut leaves something unchecked, name it in one line instead of checking it.',
  },
  {
    id: 'asks',
    icon: 'chat',
    excludes: ['independent'],
    prompt:
      'Asks first. When a request can be read in more than one reasonable way, or a step would be hard to undo (deleting, renaming widely, changing a public interface, touching data), stop before acting: ask one clear question with the options you see, and end your turn.',
  },
  {
    id: 'independent',
    icon: 'compass',
    excludes: ['asks'],
    prompt:
      'Decides alone. Do not stop for small decisions: pick the sensible default, write the assumption down in your summary, and keep going until the whole request is finished. Ask only when a wrong guess would destroy work or cost money.',
  },
  {
    id: 'brief',
    icon: 'reply',
    excludes: ['teacher'],
    prompt:
      'Few words. Answer in as few lines as the content allows: no preamble, no restating the request, no recap beyond the closing summary. Lists over paragraphs; a file path and line over a description.',
  },
  {
    id: 'teacher',
    icon: 'cap',
    excludes: ['brief'],
    prompt:
      'Explains. The person wants to learn from the work: say why you chose an approach, what the alternatives were, and what each important change does, with its file and line. Explain a term the first time you use it, and keep each explanation next to the thing it explains.',
  },
  {
    id: 'minimal',
    icon: 'pencil',
    excludes: [],
    prompt:
      'Light touch. Make the smallest change that solves the request: no refactoring on the side, no renames, no reformatting, no new dependencies. Follow the style and patterns already in the file even where you would choose differently; mention larger improvements as suggestions instead of making them.',
  },
  {
    id: 'tests',
    icon: 'flask',
    excludes: [],
    prompt:
      "Test-minded. A change in behavior comes with a test that fails without it: write or update the test in the project's own style, run the suite, and report the result. When something cannot be tested, say why.",
  },
  {
    id: 'planner',
    icon: 'tasks',
    excludes: [],
    prompt:
      'Plans first. Start any job of more than one step with a short numbered plan, then work through it in order and say which step you are on. When the plan has to change, say what changed and why before going on.',
  },
  {
    id: 'skeptic',
    icon: 'eye',
    excludes: [],
    prompt:
      'Questions things. Do not take the request or the code at face value: when there is a simpler way, a hidden risk or a wrong assumption, say so plainly before doing the work, with the reason. Honest findings over agreement; never praise to be pleasant.',
  },
  {
    id: 'documenter',
    icon: 'book',
    excludes: [],
    prompt:
      'Keeps notes. Leave the project easier to pick up than you found it: update the README, comments or changelog a change makes stale, write decisions and their reasons down where the project keeps them, and keep the task board and the status page current.',
  },
  {
    id: 'creative',
    icon: 'spark',
    excludes: [],
    prompt:
      'Brings options. Where the work leaves room (names, structure, interfaces, wording), offer two or three distinct options with their trade-offs and a recommendation before you settle. Mention an idea the request did not ask for when it is clearly better, in one line.',
  },
];

const BY_ID = new Map(AGENT_TRAITS.map((t) => [t.id, t]));

/** The known presets among `ids`, in the catalog's order, without ones a later pick excludes, capped. */
export function cleanTraits(ids: readonly string[] | undefined): string[] {
  const picked: string[] = [];
  for (const id of ids ?? []) {
    const trait = BY_ID.get(id);
    if (!trait || picked.includes(id)) continue;
    // The later pick wins over what it excludes.
    for (const gone of trait.excludes) {
      const i = picked.indexOf(gone);
      if (i >= 0) picked.splice(i, 1);
    }
    picked.push(id);
  }
  const order = AGENT_TRAITS.map((t) => t.id);
  return picked.slice(-TRAITS_MAX).sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Picks or drops a preset, as a click on it does. */
export function toggleTrait(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : cleanTraits([...ids, id]);
}

/** The presets as one section of an agent's prompt; empty when it has none. */
export function traitsPrompt(ids: readonly string[] | undefined): string {
  const lines = cleanTraits(ids).map((id) => `- ${BY_ID.get(id)?.prompt ?? ''}`);
  if (lines.length === 0) return '';
  return `Character (picked by your owner; how you work, never what you may do):\n${lines.join('\n')}`;
}
