import type {
  Advisor,
  AdvisorInput,
  Agent,
  AgentInput,
  Card,
  CardStatus,
  CliAccount,
  CliInfo,
  CliKind,
  DeviceStatus,
  Goal,
  GoalBudget,
  GoalComment,
  GoalInput,
  Job,
  MemberRole,
  MemorySection,
  MemoryState,
  Message,
  ProjectInput,
  ProjectStatusInput,
  ProjectView,
  ProviderInfo,
  ProviderInput,
  ProvidersState,
  Quota,
  RecordInput,
  RecordItem,
  Result,
  Settings,
  SettingsPatch,
  TailscaleInfo,
  WorkspaceState,
  WorkspaceSummary,
} from '@lonca/protocol';
import { ERROR_CODES } from '@lonca/protocol';
import { create } from 'zustand';
import type { AppInfo, UpdateState } from '../../shared/bridge';
import i18n from './i18n';
import { core, RpcError } from './rpc';

export type View = 'channel' | 'tasks' | 'goals' | 'ideas' | 'references' | 'commands' | 'memory' | 'project';

interface AppState {
  settings?: Settings;
  clis?: CliInfo[];
  scanning: boolean;
  tailscale?: TailscaleInfo;
  system?: Result<'system.info'>;
  app?: AppInfo;
  update: UpdateState;
  providers?: ProvidersState;
  /** Error code of the last failed action, shown as a translated line. */
  error?: string;
  /** Set when a CLI login console was opened; CLIs are scanned again when the window regains focus. */
  loginPending: boolean;

  workspace?: WorkspaceState;
  view: View;
  channelId?: string;
  messages: Record<string, Message[]>;
  jobs: Record<string, Job>;
  /** Per CLI (`claude-code`) and per extra account (`claude-code:<id>`). */
  quota: Record<string, Quota>;
  /** This computer's extra CLI logins. */
  accounts: CliAccount[];
  /** `/durum`: open, and what each computer reported. */
  statusOpen?: boolean;
  statuses: DeviceStatus[];
  /** The job shown in the live view, if any. */
  watching?: string;
  /** The agent dialog: an agent to edit, `new` for a new one, or closed. */
  agentDialog?: Agent | 'new' | { kind: CliKind };
  advisorDialog?: Advisor | 'new';
  goals: Goal[];
  workspaces: WorkspaceSummary[];
  newWorkspaceOpen?: boolean;
  inviteOpen?: boolean;
  memory?: MemoryState;
  /** On a narrow screen: the channel list or the crew over the chat. */
  panel?: 'side' | 'crew';
  /** Other members typing, per channel: device → name and when it was last heard. */
  peopleTyping: Record<string, Record<string, { name: string; at: number }>>;
  /** Workspaces in the background with something new from another member. */
  activity: Record<string, boolean>;
  /** `/goal`: the dialog, with the goal text typed so far. */
  goalDialog?: { channelId: string; text: string; agentId?: string };
  /** Advisors writing right now, per channel. */
  typing: Record<string, string[]>;
  cards: Card[];
  records: RecordItem[];
  projects: ProjectView[];
  /** The project shown when the view is `project`. */
  projectId?: string;
  /** The project dialog: a project to edit, `new`, or closed. */
  projectDialog?: ProjectView | 'new';
  /** Records attached to the next message, per channel. */
  attached: Record<string, string[]>;
  /** Full images of references, loaded when first shown. */
  images: Record<string, string>;
  /** Text to put into the message box of the open channel (a saved command). */
  inject?: { text: string; at: number };
  paletteOpen: boolean;
  /** A shortcut is being recorded in Settings: global shortcuts pause. */
  recording?: boolean;
  shortcutsOpen: boolean;
  /** A short confirmation line, cleared after a few seconds. */
  note?: string;

  init(): Promise<void>;
  patch(patch: SettingsPatch): Promise<void>;
  scan(): Promise<void>;
  login(kind: CliKind, account?: string): Promise<void>;
  loadAccounts(refresh?: boolean): Promise<void>;
  loadStatus(): Promise<void>;
  addAccount(kind: CliKind, name: string): Promise<boolean>;
  removeAccount(id: string): Promise<void>;
  refreshTailscale(): Promise<void>;
  refreshSystem(): Promise<void>;
  clearError(): void;

  loadWorkspace(): Promise<void>;
  setView(view: View): void;
  openChannel(id: string): Promise<void>;
  send(text: string): Promise<boolean>;
  editMessage(id: string, text: string): Promise<boolean>;
  deleteMessage(id: string): Promise<void>;
  createChannel(name: string): Promise<boolean>;
  saveAgent(input: AgentInput): Promise<boolean>;
  deleteAgent(id: string): Promise<void>;
  newSession(agentId: string, channelId: string): Promise<void>;
  stopJob(id: string): Promise<void>;
  steerJob(id: string, text: string): Promise<boolean>;
  answerJob(id: string, allow: boolean): Promise<void>;
  watch(jobId: string | undefined): void;
  openAgentDialog(target: AppState['agentDialog']): void;
  openAdvisorDialog(target: AppState['advisorDialog']): void;
  openGoalDialog(target: AppState['goalDialog']): void;
  openWorkspace(id: string): Promise<void>;
  createWorkspace(name: string): Promise<boolean>;
  createInvite(role: MemberRole, hours: number): Promise<string | undefined>;
  saveMemory(section: MemorySection, text: string): Promise<void>;
  remember(text: string): Promise<boolean>;
  acceptMemory(id: string, text?: string): Promise<void>;
  rejectMemory(id: string): Promise<void>;
  joinWithCode(code: string): Promise<boolean>;
  answerJoin(id: string, approve: boolean): Promise<void>;
  setMemberRole(device: string, role: MemberRole): Promise<void>;
  removeMember(device: string): Promise<void>;
  createGoal(input: GoalInput): Promise<boolean>;
  approveGoal(id: string, comments: GoalComment[]): Promise<void>;
  stopGoal(id: string): Promise<void>;
  resumeGoal(id: string, more?: Partial<GoalBudget>): Promise<void>;
  removeWorktree(id: string): Promise<void>;
  saveAdvisor(input: AdvisorInput): Promise<boolean>;
  deleteAdvisor(id: string): Promise<void>;
  council(channelId: string, topic: string): Promise<boolean>;
  createCard(title: string, opts?: { channelId?: string; agentHandle?: string }): Promise<boolean>;
  updateCard(
    id: string,
    patch: { title?: string; status?: CardStatus; assigneeAgentId?: string | null },
  ): Promise<void>;
  deleteCard(id: string): Promise<void>;
  runCard(id: string): Promise<void>;
  openJob(jobId: string): Promise<void>;
  setPalette(open: boolean): void;
  setShortcuts(open: boolean): void;
  flash(note: string): void;
  saveProvider(input: ProviderInput): Promise<ProviderInfo | undefined>;
  removeProvider(id: string): Promise<void>;
  removeProviderKey(id: string, keyId: string): Promise<void>;
  fetchModels(id: string): Promise<void>;
  saveRecord(input: RecordInput): Promise<RecordItem | undefined>;
  openProject(id: string): void;
  openProjectDialog(target: AppState['projectDialog']): void;
  saveProject(input: ProjectInput): Promise<ProjectView | undefined>;
  deleteProject(id: string): Promise<void>;
  saveStatus(input: ProjectStatusInput): Promise<boolean>;
  deleteRecord(id: string): Promise<void>;
  attach(id: string): void;
  detach(id: string): void;
  loadImage(id: string): Promise<string | undefined>;
  putInComposer(text: string): void;
}

/** An RPC refusal carries its code; a main-process refusal arrives as "Error invoking …: Error: <code>". */
const codeOf = (err: unknown): string => {
  if (err instanceof RpcError) return err.code;
  const code = /Error: ([a-z_]+)$/.exec(String((err as Error)?.message ?? ''))?.[1];
  return code && (ERROR_CODES as readonly string[]).includes(code) ? code : 'internal';
};

/** The last open channel, a per-window convenience; storage may be unavailable, so every access is guarded. */
const lastChannel = {
  get(ws = 'personal'): string | undefined {
    try {
      return localStorage.getItem(ws === 'personal' ? 'lonca.lastChannel' : `lonca.lastChannel.${ws}`) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set(id: string, ws = 'personal'): void {
    try {
      localStorage.setItem(ws === 'personal' ? 'lonca.lastChannel' : `lonca.lastChannel.${ws}`, id);
    } catch {
      // nothing to remember then
    }
  },
};

function upsert(list: Message[], m: Message): Message[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) return list.map((x) => (x.id === m.id ? m : x));
  return [...list, m].sort((a, b) => a.created - b.created);
}

export const useApp = create<AppState>((set, get) => {
  /** Runs an RPC call; a refusal becomes the error line and returns undefined. */
  async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      const r = await fn();
      set({ error: undefined });
      return r;
    } catch (err) {
      set({ error: codeOf(err) });
      return undefined;
    }
  }

  return {
    scanning: false,
    update: { status: 'disabled' },
    loginPending: false,
    view: 'channel',
    messages: {},
    jobs: {},
    quota: {},
    accounts: [],
    statuses: [],
    cards: [],
    records: [],
    projects: [],
    attached: {},
    images: {},
    paletteOpen: false,
    typing: {},
    goals: [],
    workspaces: [],
    peopleTyping: {},
    activity: {},
    shortcutsOpen: false,

    async init() {
      core.on('settings.changed', (settings) => {
        set({ settings });
        void i18n.changeLanguage(settings.language);
      });
      core.on('clis.changed', (clis) => set({ clis }));
      core.on('workspace.changed', (workspace) => {
        const before = get().workspace;
        set({ workspace });
        // Someone asks to join while Lonca is in the background: an OS notification for the admin.
        const fresh = (workspace.joins ?? []).filter((j) => !(before?.joins ?? []).some((b) => b.id === j.id));
        if (fresh.length && before?.id === workspace.id && !document.hasFocus()) {
          void window.lonca.shell.notify(
            i18n.t('invite.notifyTitle'),
            i18n.t('invite.wants', {
              name: fresh[0]?.name ?? '',
              role: i18n.t(`shell.role.${fresh[0]?.role ?? 'viewer'}`),
            }),
          );
        }
        const { channelId } = get();
        if (!channelId || !workspace.channels.some((c) => c.id === channelId)) {
          const first = workspace.channels[0];
          if (first) void get().openChannel(first.id);
        }
      });
      core.on('message.added', (m) => {
        set((s) => {
          // A message from someone ends their typing line.
          const typing = { ...(s.peopleTyping[m.channelId] ?? {}) };
          if (m.author.kind === 'person') delete typing[m.author.id];
          return {
            messages: { ...s.messages, [m.channelId]: upsert(s.messages[m.channelId] ?? [], m) },
            peopleTyping: { ...s.peopleTyping, [m.channelId]: typing },
          };
        });
        // Another member writes while Lonca is in the background: an OS notification.
        const ws = get().workspace;
        if (ws?.kind === 'team' && m.author.kind === 'person' && m.author.id !== ws.me.id && !document.hasFocus()) {
          const channel = ws.channels.find((c) => c.id === m.channelId);
          void window.lonca.shell.notify(
            `#${channel?.name ?? ''} · ${ws.name}`,
            `${m.author.name}: ${m.text.slice(0, 200)}`,
          );
        }
      });
      core.on('memory.changed', (memory) => set({ memory }));
      core.on('status.changed', (status) =>
        set((s) => ({
          statuses: s.statuses.some((x) => x.device === status.device)
            ? s.statuses.map((x) => (x.device === status.device ? status : x))
            : [...s.statuses, status],
        })),
      );
      core.on('person.typing', ({ channelId, device, name }) =>
        set((s) => ({
          peopleTyping: {
            ...s.peopleTyping,
            [channelId]: { ...(s.peopleTyping[channelId] ?? {}), [device]: { name, at: Date.now() } },
          },
        })),
      );
      core.on('workspace.activity', ({ id }) => set((s) => ({ activity: { ...s.activity, [id]: true } })));
      core.on('message.updated', (m) =>
        set((s) => ({ messages: { ...s.messages, [m.channelId]: upsert(s.messages[m.channelId] ?? [], m) } })),
      );
      core.on('message.deleted', ({ id, channelId }) =>
        set((s) => ({
          messages: { ...s.messages, [channelId]: (s.messages[channelId] ?? []).filter((m) => m.id !== id) },
        })),
      );
      core.on('job.updated', (job) => {
        const before = get().jobs[job.id];
        set((s) => ({ jobs: { ...s.jobs, [job.id]: job } }));
        // A job that starts waiting on a person while Lonca is in the background: an OS notification.
        if (job.state === 'attention' && before?.state !== 'attention' && !document.hasFocus()) {
          const agent = get().workspace?.agents.find((a) => a.id === job.agentId);
          const what = [job.approval?.label ? i18n.t(`job.tool.${job.approval.label}`) : '', job.approval?.arg ?? '']
            .filter(Boolean)
            .join(' · ');
          void window.lonca.shell.notify(i18n.t('job.approval.notifyTitle'), `${agent?.name ?? ''}: ${what}`);
        }
      });
      core.on('quota.changed', ({ kind, quota }) => set((s) => ({ quota: { ...s.quota, [kind]: quota } })));
      core.on('card.changed', (card) =>
        set((s) => ({
          cards: s.cards.some((c) => c.id === card.id)
            ? s.cards.map((c) => (c.id === card.id ? card : c))
            : [...s.cards, card],
        })),
      );
      core.on('card.deleted', ({ id }) => set((s) => ({ cards: s.cards.filter((c) => c.id !== id) })));
      core.on('record.changed', (record) =>
        set((s) => ({
          records: s.records.some((r) => r.id === record.id)
            ? s.records.map((r) => (r.id === record.id ? record : r))
            : [record, ...s.records],
        })),
      );
      core.on('record.deleted', ({ id }) => set((s) => ({ records: s.records.filter((r) => r.id !== id) })));
      core.on('project.changed', (project) =>
        set((s) => ({
          projects: s.projects.some((p) => p.id === project.id)
            ? s.projects.map((p) => (p.id === project.id ? project : p))
            : [...s.projects, project],
        })),
      );
      core.on('project.deleted', ({ id }) =>
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          ...(s.projectId === id && s.view === 'project' ? { view: 'channel' as const, projectId: undefined } : {}),
        })),
      );
      core.on('advisor.typing', ({ advisorId, channelId, on }) =>
        set((s) => {
          const now = (s.typing[channelId] ?? []).filter((id) => id !== advisorId);
          return { typing: { ...s.typing, [channelId]: on ? [...now, advisorId] : now } };
        }),
      );
      core.on('goal.changed', (goal) =>
        set((s) => ({
          goals: s.goals.some((g) => g.id === goal.id)
            ? s.goals.map((g) => (g.id === goal.id ? goal : g))
            : [...s.goals, goal],
        })),
      );
      core.on('advisor.spend', (spend) => set((s) => (s.workspace ? { workspace: { ...s.workspace, spend } } : {})));
      core.on('advisor.failed', ({ advisorId, code }) => {
        const name = get().workspace?.advisors.find((a) => a.id === advisorId)?.name ?? '';
        get().flash(`${name}: ${i18n.t(`errors.${code}`, i18n.t('errors.internal'))}`);
      });
      window.lonca.updates.onChange((update) => set({ update }));
      core.on('workspaces.changed', (workspaces) => set({ workspaces }));
      void core.call('workspaces.list').then((workspaces) => set({ workspaces }));
      window.lonca.providers.onChange((providers) => set({ providers }));
      void window.lonca.providers.state().then((providers) => set({ providers }));

      const [settings, app, update] = await Promise.all([
        core.call('settings.get'),
        window.lonca.shell.appInfo(),
        window.lonca.updates.state(),
      ]);
      await i18n.changeLanguage(settings.language);
      set({ settings, app, update });
      void get().refreshSystem();
      void get().scan();
      void get().loadAccounts();
      void get().refreshTailscale();
      if (settings.onboarded) void get().loadWorkspace();
      // The core may restart; read its state again when a new connection arrives.
      core.onConnect(() => {
        void core.call('settings.get').then((s) => set({ settings: s }));
        if (get().settings?.onboarded) void get().loadWorkspace();
      });
    },

    async patch(patch) {
      // Show the change at once; the core's answer confirms it, a refusal puts the old value back.
      const before = get().settings;
      if (before) {
        set({ settings: { ...before, ...patch, profile: { ...before.profile, ...patch.profile } } });
        if (patch.language) void i18n.changeLanguage(patch.language);
      }
      try {
        const settings = await core.call('settings.update', patch);
        set({ settings, error: undefined });
        if (patch.dataDir !== undefined) {
          void get().refreshSystem();
          set({ messages: {}, jobs: {}, channelId: undefined });
          if (settings.onboarded) void get().loadWorkspace();
        }
        if (patch.onboarded) void get().loadWorkspace();
      } catch (err) {
        set({ error: codeOf(err), ...(before ? { settings: before } : {}) });
        if (before) void i18n.changeLanguage(before.language);
      }
    },

    async scan() {
      set({ scanning: true });
      try {
        set({ clis: await core.call('clis.list', { refresh: true }) });
      } catch (err) {
        set({ error: codeOf(err) });
      } finally {
        set({ scanning: false });
      }
    },

    async login(kind, account) {
      if (await attempt(() => core.call('clis.login', { kind, ...(account ? { account } : {}) })))
        set({ loginPending: true });
    },

    async loadAccounts(refresh = false) {
      const accounts = await attempt(() => core.call('accounts.list', { refresh }));
      if (accounts) set({ accounts });
    },

    async loadStatus() {
      const statuses = await attempt(() => core.call('status.get'));
      if (statuses) set({ statuses });
    },

    async addAccount(kind, name) {
      const accounts = await attempt(() => core.call('accounts.add', { kind, name }));
      if (accounts) set({ accounts });
      return Boolean(accounts);
    },

    async removeAccount(id) {
      const accounts = await attempt(() => core.call('accounts.remove', { id }));
      if (accounts) set({ accounts });
    },

    async refreshTailscale() {
      try {
        set({ tailscale: await core.call('tailscale.status') });
      } catch {
        set({ tailscale: { state: 'unknown' } });
      }
    },

    async refreshSystem() {
      const system = await attempt(() => core.call('system.info'));
      if (system) set({ system });
    },

    clearError() {
      set({ error: undefined });
    },

    // ---------------------------------------------------------------- workspace

    async loadWorkspace() {
      const workspace = await attempt(() => core.call('workspace.get'));
      if (!workspace) return;
      const jobs = { ...get().jobs };
      for (const j of workspace.active) jobs[j.id] = j;
      const quota = (await attempt(() => core.call('quota.get'))) ?? {};
      const cards = (await attempt(() => core.call('cards.list'))) ?? [];
      const records = (await attempt(() => core.call('records.list', {}))) ?? [];
      const goals = (await attempt(() => core.call('goals.list'))) ?? [];
      const memory = await attempt(() => core.call('memory.get'));
      const projects = (await attempt(() => core.call('projects.list'))) ?? [];
      set({ workspace, jobs, quota, cards, records, goals, projects, ...(memory ? { memory } : {}) });
      const current = get().channelId ?? lastChannel.get(workspace.id);
      const target = workspace.channels.find((c) => c.id === current) ?? workspace.channels[0];
      if (target) await get().openChannel(target.id);
    },

    setView(view) {
      set({ view, panel: undefined });
    },

    async openChannel(id) {
      set({ channelId: id, view: 'channel', panel: undefined });
      lastChannel.set(id, get().workspace?.id);
      const page = await attempt(() => core.call('messages.list', { channelId: id, limit: 150 }));
      if (!page) return;
      set((s) => {
        const jobs = { ...s.jobs };
        for (const j of page.jobs) if (!jobs[j.id] || jobs[j.id]?.state !== 'running') jobs[j.id] = j;
        return { messages: { ...s.messages, [id]: page.messages }, jobs };
      });
    },

    async send(text) {
      const channelId = get().channelId;
      if (!channelId || !text.trim()) return false;
      const refs = get().attached[channelId] ?? [];
      const ok = Boolean(
        await attempt(() => core.call('messages.send', { channelId, text, ...(refs.length ? { refs } : {}) })),
      );
      if (ok && refs.length) set((s) => ({ attached: { ...s.attached, [channelId]: [] } }));
      return ok;
    },

    async editMessage(id, text) {
      return Boolean(await attempt(() => core.call('messages.edit', { id, text })));
    },

    async deleteMessage(id) {
      await attempt(() => core.call('messages.delete', { id }));
    },

    async createChannel(name) {
      const channel = await attempt(() => core.call('channels.create', { name }));
      if (!channel) return false;
      await get().loadWorkspace();
      await get().openChannel(channel.id);
      return true;
    },

    async saveAgent(input) {
      const agent = await attempt(() => core.call('agents.save', input));
      if (!agent) return false;
      set({ agentDialog: undefined });
      await get().loadWorkspace();
      return true;
    },

    async deleteAgent(id) {
      if (await attempt(() => core.call('agents.delete', { id }))) {
        set({ agentDialog: undefined });
        await get().loadWorkspace();
      }
    },

    async newSession(agentId, channelId) {
      await attempt(() => core.call('agents.newSession', { agentId, channelId }));
    },

    async stopJob(id) {
      await attempt(() => core.call('jobs.stop', { id }));
    },

    async steerJob(id, text) {
      return Boolean(await attempt(() => core.call('jobs.steer', { id, text })));
    },

    async answerJob(id, allow) {
      await attempt(() => core.call('jobs.answer', { id, allow }));
    },

    watch(jobId) {
      set({ watching: jobId });
    },

    openAgentDialog(target) {
      set({ agentDialog: target, error: undefined });
    },

    async openWorkspace(id) {
      if (get().workspace?.id === id) return;
      const state = await attempt(() => core.call('workspaces.open', { id }));
      if (!state) return;
      // A different workspace: what was on screen belongs to the other one.
      set((s) => ({
        workspace: state,
        channelId: undefined,
        view: 'channel',
        jobs: {},
        watching: undefined,
        activity: { ...s.activity, [id]: false },
      }));
      await get().loadWorkspace();
    },

    async saveMemory(section, text) {
      const memory = await attempt(() => core.call('memory.save', { section, text }));
      if (memory) set({ memory });
    },

    async remember(text) {
      const memory = await attempt(() => core.call('memory.remember', { text }));
      if (memory) set({ memory });
      return Boolean(memory);
    },

    async acceptMemory(id, text) {
      const memory = await attempt(() => core.call('memory.accept', { id, ...(text !== undefined ? { text } : {}) }));
      if (memory) set({ memory });
    },

    async rejectMemory(id) {
      const memory = await attempt(() => core.call('memory.reject', { id }));
      if (memory) set({ memory });
    },

    async createInvite(role, hours) {
      const made = await attempt(() => core.call('invites.create', { role, hours }));
      return made?.code;
    },

    async joinWithCode(code) {
      return Boolean(await attempt(() => core.call('invites.join', { code })));
    },

    async answerJoin(id, approve) {
      await attempt(() => core.call('invites.answer', { id, approve }));
    },

    async setMemberRole(device, role) {
      await attempt(() => core.call('members.setRole', { device, role }));
    },

    async removeMember(device) {
      await attempt(() => core.call('members.remove', { device }));
    },

    async createWorkspace(name) {
      const created = await attempt(() => core.call('workspaces.create', { name }));
      if (!created) return false;
      await get().openWorkspace(created.id);
      return true;
    },

    openGoalDialog(target) {
      set({ goalDialog: target, error: undefined });
    },

    async createGoal(input) {
      const goal = await attempt(() => core.call('goals.create', input));
      if (!goal) return false;
      set((s) => ({
        goalDialog: undefined,
        goals: s.goals.some((g) => g.id === goal.id) ? s.goals : [...s.goals, goal],
      }));
      return true;
    },

    async approveGoal(id, comments) {
      await attempt(() => core.call('goals.approve', { id, comments }));
    },

    async stopGoal(id) {
      await attempt(() => core.call('goals.stop', { id }));
    },

    async removeWorktree(id) {
      await attempt(() => core.call('goals.removeWorktree', { id }));
    },

    async resumeGoal(id, more) {
      await attempt(() => core.call('goals.resume', { id, ...(more ? { more } : {}) }));
    },

    openAdvisorDialog(target) {
      set({ advisorDialog: target, error: undefined });
    },

    async saveAdvisor(input) {
      const advisor = await attempt(() => core.call('advisors.save', input));
      if (!advisor) return false;
      set({ advisorDialog: undefined });
      await get().loadWorkspace();
      return true;
    },

    async deleteAdvisor(id) {
      if (await attempt(() => core.call('advisors.delete', { id }))) {
        set({ advisorDialog: undefined });
        await get().loadWorkspace();
      }
    },

    async council(channelId, topic) {
      return Boolean(await attempt(() => core.call('advisors.council', { channelId, topic })));
    },

    async createCard(title, opts = {}) {
      const card = await attempt(() => core.call('cards.create', { title, ...opts }));
      return Boolean(card);
    },

    async updateCard(id, patch) {
      // Moving a card shows at once; the core's event confirms it.
      set((s) => ({
        cards: s.cards.map((c) =>
          c.id === id
            ? {
                ...c,
                ...(patch.title ? { title: patch.title } : {}),
                ...(patch.status ? { status: patch.status } : {}),
              }
            : c,
        ),
      }));
      await attempt(() => core.call('cards.update', { id, ...patch }));
    },

    async deleteCard(id) {
      await attempt(() => core.call('cards.delete', { id }));
    },

    async runCard(id) {
      await attempt(() => core.call('cards.run', { id }));
    },

    async openJob(jobId) {
      const job = get().jobs[jobId];
      if (!job) return;
      await get().openChannel(job.channelId);
      set({ watching: jobId });
    },

    setPalette(open) {
      set({ paletteOpen: open });
    },

    setShortcuts(open) {
      set({ shortcutsOpen: open });
    },

    async saveRecord(input) {
      return attempt(() => core.call('records.save', input));
    },

    async deleteRecord(id) {
      await attempt(() => core.call('records.delete', { id }));
    },

    openProject(id) {
      set({ view: 'project', projectId: id, panel: undefined });
    },

    openProjectDialog(target) {
      set({ projectDialog: target, error: undefined });
    },

    async saveProject(input) {
      const project = await attempt(() => core.call('projects.save', input));
      if (project) set({ projectDialog: undefined });
      return project;
    },

    async deleteProject(id) {
      if (await attempt(() => core.call('projects.delete', { id }))) set({ projectDialog: undefined });
    },

    async saveStatus(input) {
      return Boolean(await attempt(() => core.call('projects.status', input)));
    },

    attach(id) {
      const channelId = get().channelId;
      if (!channelId) return;
      set((s) => {
        const list = s.attached[channelId] ?? [];
        return list.includes(id) ? {} : { attached: { ...s.attached, [channelId]: [...list, id].slice(0, 8) } };
      });
    },

    detach(id) {
      const channelId = get().channelId;
      if (!channelId) return;
      set((s) => ({ attached: { ...s.attached, [channelId]: (s.attached[channelId] ?? []).filter((x) => x !== id) } }));
    },

    async loadImage(id) {
      const cached = get().images[id];
      if (cached) return cached;
      const url = await attempt(() => core.call('records.image', { id }));
      if (url) set((s) => ({ images: { ...s.images, [id]: url } }));
      return url;
    },

    putInComposer(text) {
      set({ view: 'channel', inject: { text, at: Date.now() } });
    },

    async saveProvider(input) {
      return attempt(() => window.lonca.providers.save(input));
    },
    async removeProvider(id) {
      await attempt(() => window.lonca.providers.remove(id));
    },
    async removeProviderKey(id, keyId) {
      await attempt(() => window.lonca.providers.removeKey(id, keyId));
    },
    async fetchModels(id) {
      const info = await attempt(() => window.lonca.providers.models(id));
      if (info) get().flash(i18n.t('providers.fetched', { count: info.models.length }));
    },

    flash(note) {
      set({ note });
      setTimeout(() => {
        if (get().note === note) set({ note: undefined });
      }, 3500);
    },
  };
});

window.addEventListener('focus', () => {
  const s = useApp.getState();
  if (s.loginPending) {
    useApp.setState({ loginPending: false });
    void s.scan();
    void s.loadAccounts(true);
  }
});
