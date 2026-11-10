// End-to-end test of channels and jobs in the real app, with a fake Claude Code (fake-claude.mjs) first on PATH:
// add an agent, call it in #genel, watch the job card fill and the answer arrive, open the live view, steer and
// stop a slow job in the agent's own channel, edit and delete a message, restart and find everything again.
// Usage: node e2e/channel.mjs   (after electron-vite build; E2E_EXE=release/win-unpacked/Serai.exe for packaged)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { locale } from './locale.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fakeMcp = join(here, '../../../packages/core/test/fixtures/fake-mcp.mjs');
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const appDir = join(here, '..');
const electronPath = createRequire(import.meta.url)('electron');
const L = locale('tr');
const shots = join(appDir, 'test-results');
mkdirSync(shots, { recursive: true });

// A temporary home, a project folder for the agent, and the fake CLI in npm's shim format.
const home = mkdtempSync(join(tmpdir(), 'lonca-e2e-ch-'));
const project = mkdtempSync(join(tmpdir(), 'lonca-e2e-project-'));
writeFileSync(join(project, 'README.md'), '# Fake project\n');
const bin = mkdtempSync(join(tmpdir(), 'lonca-e2e-bin-'));
copyFileSync(join(here, 'fake-claude.mjs'), join(bin, 'fake-claude.mjs'));
if (process.platform === 'win32') {
  writeFileSync(
    join(bin, 'claude.cmd'),
    '@ECHO off\r\nSETLOCAL\r\nSET dp0=%~dp0\r\nnode "%dp0%\\fake-claude.mjs" %*\r\n',
  );
} else {
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec node "${join(bin, 'fake-claude.mjs')}" "$@"\n`, { mode: 0o755 });
}
writeFileSync(
  join(home, 'settings.json'),
  JSON.stringify({
    v: 1,
    language: 'tr',
    theme: 'dark',
    accent: 'lime',
    motion: 'system',
    profile: { name: 'Kaan' },
    dataDir: '',
    onboarded: true,
  }),
);

// A stand-in for the official MCP Registry: one entry Serai can install, one it cannot (SSE only).
const registry = createServer((req, res) => {
  const servers = [
    {
      server: {
        name: 'io.example/notlar',
        description: 'Notlar tutan sahte bir sunucu.',
        version: '1.0.0',
        packages: [
          {
            registryType: 'npm',
            identifier: 'notlar-mcp',
            version: '1.0.0',
            transport: { type: 'stdio' },
            environmentVariables: [
              { name: 'NOTLAR_TOKEN', isRequired: true, isSecret: true, description: 'Notlar anahtarı' },
            ],
          },
        ],
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } },
    },
    {
      server: {
        name: 'io.example/eski',
        description: 'Yalnızca SSE.',
        remotes: [{ type: 'sse', url: 'https://example.com/sse' }],
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } },
    },
  ];
  const q = new URL(req.url ?? '/', 'http://x').searchParams.get('search') ?? '';
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ servers: servers.filter((e) => e.server.name.includes(q)), metadata: { count: 2 } }));
});
await new Promise((r) => registry.listen(0, '127.0.0.1', r));
const registryUrl = `http://127.0.0.1:${registry.address().port}`;

let n = 0;
let current;
const shot = async (page, name) => {
  await page.waitForTimeout(500);
  n += 1;
  const png = await current.evaluate(async ({ BrowserWindow }) =>
    // The main window: the quick-entry window (once made) is a second one.
    (
      await BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().includes('#quick'))
        .webContents.capturePage()
    )
      .toPNG()
      .toString('base64'),
  );
  writeFileSync(join(shots, `ch-${String(n).padStart(2, '0')}-${name}.png`), Buffer.from(png, 'base64'));
};

async function launch() {
  const packaged = process.env.E2E_EXE ? join(appDir, process.env.E2E_EXE) : undefined;
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const app = await electron.launch({
    executablePath: packaged ?? electronPath,
    args: packaged ? [] : [appDir],
    env: {
      ...process.env,
      [pathKey]: `${bin}${delimiter}${process.env[pathKey]}`,
      LONCA_HOME: home,
      LONCA_LANG: 'tr',
      LONCA_REGISTRY_URL: registryUrl,
    },
  });
  current = app;
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // The folder picker is a native dialog: answer it with the project folder.
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  return { app, page, errors };
}

const until = async (fn, what, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out: ${what}`);
};

const first = await launch();
let { page } = first;
try {
  await page.getByRole('heading', { name: L.shell.crew }).waitFor();

  // Add the agent from the suggestion of the installed (fake) CLI.
  await page.getByRole('button', { name: L.crew.add, exact: true }).click();
  await page.getByRole('dialog', { name: L.agentForm.new }).waitFor();
  await page.getByRole('button', { name: L.agentForm.pick, exact: true }).click();
  await page.getByText(project).waitFor();
  await shot(page, 'agent-form');
  await page.getByRole('button', { name: L.agentForm.save }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page
    .getByRole('complementary', { name: L.shell.channels })
    .getByRole('button', { name: '@claude', exact: true })
    .waitFor();

  // Call it in #genel.
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Mesaj · #genel' });
  await composer.fill('@claude README dosyasında ne var?');
  await composer.press('Enter');
  await page.getByText(L.job.state.done).first().waitFor({ timeout: 20_000 });
  await page.getByText('sahte proje').first().waitFor();
  await shot(page, 'job-done');
  assert.equal((await page.getByText(L.job.tool.read, { exact: true }).count()) > 0, true);
  assert.equal((await page.getByText('README.md').count()) > 0, true);

  // Live view of the job.
  await page.getByRole('button', { name: L.job.watch }).first().click();
  await page.getByRole('complementary', { name: L.job.live }).waitFor();
  await page.getByText('14 passed').first().waitFor();
  await shot(page, 'live-view');
  await page.getByRole('button', { name: L.common.close }).click();

  // The quota from the CLI's rate-limit events.
  await page.getByText(L.quota.window.five_hour).waitFor();

  // /todo puts a card on the board; the palette opens the board; the card runs as a job and moves to review.
  await composer.fill('/todo README dosyasını güncelle @claude');
  await composer.press('Enter');
  await page.getByText(L.board.added).waitFor();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('textbox', { name: L.palette.placeholder });
  await search.fill('görev');
  await search.press('Enter');
  const todo = page.getByRole('region', { name: L.board.status.todo });
  await todo.getByText('README dosyasını güncelle').waitFor();
  await shot(page, 'board');
  await todo.getByRole('button', { name: L.board.run }).click();
  const review = page.getByRole('region', { name: L.board.status.review });
  await review.getByText('README dosyasını güncelle').waitFor({ timeout: 20_000 });
  await shot(page, 'board-review');

  // Serai's MCP tools: the agent moves the card to done itself and posts a progress note.
  await page.keyboard.press('Control+k');
  await search.fill('genel');
  await search.press('Enter');
  await composer.fill('@claude panoyu güncelle');
  await composer.press('Enter');
  await page.getByText('bitti olarak işaretlendi').first().waitFor({ timeout: 20_000 });
  await page.getByText('serai.update_card').first().waitFor();
  await page.getByText('Pano güncellendi').first().waitFor();
  await shot(page, 'mcp-tools');
  await page.keyboard.press('Control+k');
  await search.fill('görev');
  await search.press('Enter');
  await page.getByRole('region', { name: L.board.status.done }).getByText('README dosyasını güncelle').waitFor();

  // Records: save an answer as an idea, add a reference image, attach it to a job, use a saved command.
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  const answerMsg = page.locator('.msg--agent').first();
  await answerMsg.hover();
  await answerMsg.getByRole('button', { name: L.records.saveMessage }).click();
  await page.getByText(L.records.saved).first().waitFor();
  await page.getByRole('button', { name: L.shell.ideas, exact: true }).click();
  await page.locator('.rec', { hasText: 'README bir' }).first().waitFor();

  await page.getByRole('button', { name: L.shell.references, exact: true }).click();
  const png = join(project, 'ekran.png');
  writeFileSync(png, Buffer.from(PNG_1X1, 'base64'));
  await page.locator('input[type=file]').setInputFiles(png);
  await page.locator('.rec', { hasText: 'ekran' }).first().waitFor();
  await shot(page, 'references');
  await page.getByRole('button', { name: L.records.attach }).click();
  await page.locator('.composer__refs .refchip', { hasText: 'ekran' }).waitFor();
  await composer.fill('@claude bu görsele göre düzenle');
  await composer.press('Enter');
  await page.locator('.msg__refs .refchip', { hasText: 'ekran' }).waitFor();
  await until(async () => (await page.getByText(L.job.state.done).count()) >= 2, 'job with a reference done');

  await page.getByRole('button', { name: L.shell.commands, exact: true }).click();
  await page.getByRole('button', { name: L.records.new.command }).click();
  await page.getByLabel(L.records.title).fill('Özet');
  await page.getByLabel(L.records.body.command).fill('{channel} kanalını özetle');
  await page.getByRole('switch', { name: L.records.pin }).click();
  await page.getByRole('button', { name: L.records.save, exact: true }).click();
  await page.getByRole('button', { name: L.records.use }).click();
  await until(async () => (await composer.inputValue()) === 'genel kanalını özetle', 'command in the message box');
  await composer.fill('');
  // The pinned command as a button above the message box.
  await page.locator('.tile', { hasText: 'Özet' }).click();
  await until(async () => (await composer.inputValue()) === 'genel kanalını özetle', 'tile in the message box');
  await composer.fill('');

  // A rebound shortcut: the palette on Ctrl J, then back to the default.
  await page.keyboard.press('Control+Comma');
  const prefs = page.getByRole('dialog', { name: L.settings.title });
  await prefs.getByRole('button', { name: L.settings.tabs.shortcuts }).click();
  // The global quick-entry key is listed with the others.
  await prefs.getByText(L.shortcuts.quickEntry).waitFor();
  await prefs.getByText('Ctrl Alt Space').waitFor();
  await prefs.getByRole('button', { name: L.shortcuts.change }).first().click();
  await page.keyboard.press('Control+j');
  await prefs.getByText('Ctrl J').waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+j');
  await page.getByRole('textbox', { name: L.palette.placeholder }).waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Comma');
  await prefs.getByRole('button', { name: L.settings.tabs.shortcuts }).click();
  await prefs.getByRole('button', { name: L.shortcuts.reset }).click();
  await prefs.getByText('Ctrl K').waitFor();
  await page.keyboard.press('Escape');

  // Instructions: edit the worker template, see it in the preview, go back to the default.
  await page.keyboard.press('Control+Comma');
  const settingsDialog = page.getByRole('dialog', { name: L.settings.title });
  await settingsDialog.getByRole('button', { name: L.settings.tabs.instructions }).click();
  const template = settingsDialog.getByRole('textbox', { name: L.instructions.worker });
  await template.fill('Her yanıtı tek cümleyle ver, {user}.');
  await settingsDialog.getByRole('button', { name: L.instructions.save }).first().click();
  await settingsDialog.getByText(L.instructions.edited).waitFor();
  await settingsDialog.getByText('Her yanıtı tek cümleyle ver, Kaan.').waitFor();
  await shot(page, 'instructions');
  await settingsDialog.getByRole('button', { name: L.instructions.reset }).click();
  await settingsDialog.getByText(L.instructions.isDefault, { exact: true }).waitFor();
  await page.keyboard.press('Escape');

  // A second login of the CLI: added in Settings, signed out until its own login runs, offered in the agent form.
  await page.keyboard.press('Control+Comma');
  await settingsDialog.getByRole('button', { name: L.settings.tabs.agents }).click();
  await settingsDialog.getByLabel(L.accounts.name).fill('İkinci hesap');
  await settingsDialog.getByRole('button', { name: L.accounts.add }).click();
  const accountRow = settingsDialog.locator('.accounts .agent', { hasText: 'İkinci hesap' });
  await accountRow.getByText(L.agent.state['signed-out']).waitFor();
  await accountRow.getByRole('button', { name: L.agent.login }).waitFor();
  await shot(page, 'accounts');
  await page.keyboard.press('Escape');
  await page.locator('.who', { hasText: '@claude' }).getByRole('button', { name: L.agentForm.edit }).click();
  const editAgent = page.getByRole('dialog', { name: L.agentForm.edit });
  const accountSelect = editAgent.getByLabel(L.accounts.agentField);
  assert.deepEqual(await accountSelect.locator('option').allTextContents(), [L.accounts.default, 'İkinci hesap']);
  await editAgent.getByRole('button', { name: L.agentForm.cancel }).click();

  // /durum: this computer's CLIs, the extra account and the quota.
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  await composer.fill('/durum');
  await composer.press('Enter');
  const statusDialog = page.getByRole('dialog', { name: L.status.title });
  await statusDialog.getByText(L.status.thisComputer).waitFor();
  await statusDialog.getByText('İkinci hesap').waitFor();
  await statusDialog.getByText(L.quota.window.five_hour).first().waitFor();
  await shot(page, 'status');
  await page.keyboard.press('Escape');

  // The shortcut list, then back to the channel through the palette.
  await page.keyboard.press('Control+/');
  await page.getByRole('dialog', { name: L.shortcuts.title }).waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await search.fill('genel');
  await search.press('Enter');
  await composer.waitFor();

  // Approvals: a command that needs approval waits on a person; allowed once, denied once.
  await page.getByRole('button', { name: '@claude', exact: true }).click();
  const agentBox = page.getByRole('textbox', { name: 'Mesaj · @claude' });
  await agentBox.fill('onay iste');
  await agentBox.press('Enter');
  await page.getByText(L.job.approval.title).first().waitFor();
  await page.getByRole('button', { name: L.shell.waiting }).waitFor();
  await shot(page, 'approval');
  await page.getByRole('button', { name: L.job.approval.allow }).click();
  await page.getByText('Derleme tamam.').waitFor();
  await agentBox.fill('onay iste');
  await agentBox.press('Enter');
  await page.getByRole('button', { name: L.job.approval.deny }).click();
  await page.getByText('Derleme reddedildi').waitFor();
  assert.equal(await page.getByRole('button', { name: L.shell.waiting }).count(), 0);

  // A connector: a local program added in Settings with a secret, open to @claude; its writing tool asks first.
  await page.keyboard.press('Control+Comma');
  await settingsDialog.getByRole('button', { name: L.settings.tabs.connectors }).click();
  await settingsDialog.getByText(L.connectors.empty).waitFor();
  // The catalog: Serai's checked entries, and the registry searched by name (community, not reviewed).
  await settingsDialog.getByRole('button', { name: L.connectors.add }).click();
  await settingsDialog.getByRole('button', { name: /Microsoft Learn/ }).waitFor();
  await shot(page, 'catalog');
  await settingsDialog.getByRole('button', { name: /^GitHub/ }).click();
  await settingsDialog.getByText(L.catalog.verified, { exact: true }).waitFor();
  await settingsDialog.getByText(L.catalog.via.oci, { exact: true }).waitFor();
  await settingsDialog.getByText('https://api.githubcopilot.com/mcp/').waitFor();
  await settingsDialog.getByRole('button', { name: L.catalog.back }).click();
  await settingsDialog.getByLabel(L.catalog.search, { exact: true }).fill('example');
  const found = settingsDialog.getByRole('button', { name: /io\.example\/notlar/ });
  await found.waitFor();
  assert.equal(await settingsDialog.getByRole('button', { name: /io\.example\/eski/ }).isDisabled(), true);
  await shot(page, 'catalog-search');
  await found.click();
  await settingsDialog.getByText(L.catalog.communityNote).waitFor();
  await settingsDialog.getByText('npx -y notlar-mcp@1.0.0').waitFor();
  const installButton = settingsDialog.getByRole('button', { name: L.catalog.install });
  assert.equal(await installButton.isDisabled(), true);
  await settingsDialog.getByLabel('NOTLAR_TOKEN', { exact: true }).fill('n-123');
  await settingsDialog.getByText(L.catalog.sealed.replace('{{names}}', 'NOTLAR_TOKEN')).waitFor();
  await shot(page, 'catalog-install');
  await settingsDialog.getByRole('button', { name: L.catalog.back }).click();
  await settingsDialog.getByRole('button', { name: L.connectors.manual }).click();
  await settingsDialog.getByLabel(L.connectors.name, { exact: true }).fill('Notlar');
  await settingsDialog.getByText(L.connectors.kinds.local, { exact: true }).click();
  await settingsDialog.getByLabel(L.connectors.command, { exact: true }).fill(process.execPath);
  await settingsDialog.getByLabel(L.connectors.args, { exact: true }).fill(fakeMcp);
  await settingsDialog.getByRole('button', { name: L.connectors.secretAdd }).click();
  await settingsDialog.getByLabel(L.connectors.secretName, { exact: true }).fill('FAKE_TOKEN');
  await settingsDialog.getByLabel(L.connectors.secretValue, { exact: true }).fill('e2e-token-1234');
  await settingsDialog.getByRole('checkbox').first().check();
  await shot(page, 'connector-form');
  await settingsDialog.getByRole('button', { name: L.connectors.save }).click();
  const connectorRow = settingsDialog.locator('.conn', { hasText: 'Notlar' });
  await connectorRow.getByText(L.connectors.state.ok).waitFor({ timeout: 30_000 });
  await connectorRow.getByText('FAKE_TOKEN ···1234').waitFor();
  await connectorRow.getByRole('button', { name: L.connectors.tools_other.replace('{{count}}', '2') }).click();
  const addPolicy = connectorRow.getByLabel('add_note');
  assert.equal(await addPolicy.inputValue(), 'ask');
  assert.equal(await connectorRow.getByLabel('list_notes').inputValue(), 'allow');
  await shot(page, 'connector');
  assert.equal(readFileSync(join(home, 'connectors.json'), 'utf8').includes('e2e-token-1234'), false);
  await page.keyboard.press('Escape');
  await agentBox.fill('bağlayıcıya not ekle');
  await agentBox.press('Enter');
  await page.getByText('Notlar: add_note').waitFor();
  await page.getByText('{"text":"e2e notu"}').waitFor();
  await shot(page, 'connector-approval');
  await page.getByRole('button', { name: L.job.approval.allow }).click();
  await page.getByText('Notlar: e2e notu (token=e2e-token-1234 leaked=no)').waitFor();
  await page.getByText('notlar.add_note').first().waitFor();

  // In the agent's own channel: a slow job, steered, then stopped.
  await page.getByRole('button', { name: '@claude', exact: true }).click();
  const agentComposer = page.getByRole('textbox', { name: 'Mesaj · @claude' });
  await agentComposer.fill('yavaş bir iş yap');
  await agentComposer.press('Enter');
  await page.getByText(L.job.state.running).first().waitFor();
  await page.getByRole('button', { name: L.job.steer, exact: true }).click();
  const steer = page.getByRole('textbox', { name: L.job.steer });
  await steer.fill('testleri de çalıştır');
  await steer.press('Enter');
  await page.getByText('testleri de çalıştır').first().waitFor();
  await shot(page, 'job-steered');
  await page.getByRole('button', { name: L.job.stop }).click();
  await page.getByText(L.job.state.stopped).first().waitFor();
  await shot(page, 'job-stopped');

  // Goal mode: /goal opens the dialog, the plan waits for approval, a step comment travels with every step,
  // the done check runs after each step, and the goal ends when the agent says so and the check passes.
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  await composer.fill('/goal Login ekranını bitir');
  await composer.press('Enter');
  const goalDialog = page.getByRole('dialog', { name: L.goal.new });
  await goalDialog.getByLabel(L.goal.check, { exact: true }).fill('exit 0');
  await goalDialog.getByRole('button', { name: L.goal.start }).click();
  const goalCard = page.getByRole('region', { name: L.goal.title });
  await goalCard.getByText(L.goal.state.review).waitFor();
  await goalCard.getByText('Testleri ekle').waitFor();
  const onStep2 = L.goal.commentOn.replace('{{n}}', '2');
  await goalCard.getByRole('button', { name: onStep2 }).click();
  await goalCard.getByRole('textbox', { name: onStep2 }).fill('Vitest kullan');
  await goalCard.getByRole('textbox', { name: onStep2 }).press('Enter');
  await goalCard.locator('.goalstep__note', { hasText: 'Vitest kullan' }).waitFor();
  await shot(page, 'goal-review');
  await goalCard.getByRole('button', { name: L.goal.approveWith_one.replace('{{count}}', '1') }).click();
  await goalCard.getByText(L.goal.state.done, { exact: true }).waitFor({ timeout: 30_000 });
  await goalCard.getByText(L.goal.checkOk).waitFor();
  await page.getByText('Adım 2 bitti (yorum alındı).').waitFor();
  assert.equal(await page.getByText('GOAL_DONE').count(), 0);
  await shot(page, 'goal-done');
  await page.getByRole('button', { name: L.shell.goals, exact: true }).click();
  await page.getByRole('region', { name: L.goal.title }).getByText(L.goal.state.done, { exact: true }).waitFor();

  // A goal in its own git worktree: the project becomes a repository, the goal runs on a branch of its own, and
  // the worktree is removed afterwards (the branch stays).
  const git = (...args) => execFileSync('git', ['-C', project, ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'e2e@example.com');
  git('config', 'user.name', 'e2e');
  git('add', '.');
  git('commit', '-qm', 'first');
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  await composer.fill('/goal Ayrı dalda dene');
  await composer.press('Enter');
  await goalDialog.getByRole('switch', { name: L.goal.worktree }).click();
  await goalDialog.getByRole('button', { name: L.goal.start }).click();
  const treeCard = page.getByRole('region', { name: L.goal.title }).filter({ hasText: 'Ayrı dalda dene' });
  await treeCard.getByText('serai/goal-').waitFor();
  await treeCard.getByRole('button', { name: L.goal.approve, exact: true }).click();
  await treeCard.getByText(L.goal.state.done, { exact: true }).waitFor({ timeout: 30_000 });
  await shot(page, 'goal-worktree');
  await treeCard.getByRole('button', { name: L.goal.removeWorktree }).click();
  await treeCard.getByText(L.goal.worktreeRemoved).waitFor();
  assert.match(git('branch', '--list', 'serai/*').toString(), /serai\/goal-/);

  // A project on the same repository: its progress.md starts the status page, the git panel shows the clone, the
  // agent working in the folder reads and updates the page through Serai's tools, and a person edits it.
  writeFileSync(
    join(project, 'progress.md'),
    '# Fake — progress\n\n## Where we left off\n\nİskelet hazır.\n\n## Milestones\n\n- [x] Kavram yazıldı\n- [ ] Yayınlandı\n\n## Next\n\n1. Testleri ekle\n',
  );
  await page.getByRole('button', { name: L.project.new }).click();
  const projectDialog = page.getByRole('dialog', { name: L.project.new });
  await projectDialog.getByLabel(L.project.name).fill('Sahte proje');
  await projectDialog.getByRole('button', { name: L.agentForm.pick, exact: true }).click();
  await projectDialog.getByText(project).waitFor();
  await projectDialog.getByRole('button', { name: L.project.addArea }).click();
  await projectDialog.getByLabel(L.project.areaPath).fill('src');
  await projectDialog.getByLabel(L.project.areaNote).fill('arayüz');
  await shot(page, 'project-form');
  await projectDialog.getByRole('button', { name: L.project.save }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: 'Sahte proje' }).waitFor();
  const commits = page.getByRole('list', { name: L.project.commits });
  await commits.getByText('first').waitFor();
  await page.getByText(L.project.changes.replace('{{count}}', '0').replace('{{untracked}}', '1')).waitFor();
  assert.equal(await page.getByLabel(L.project.milestone).first().inputValue(), 'Kavram yazıldı');
  assert.equal(await page.getByLabel(L.project.leftOff).inputValue(), 'İskelet hazır.');
  await shot(page, 'project');
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  await composer.fill('@claude durumu güncelle');
  await composer.press('Enter');
  await page.getByText('Durum sayfası güncellendi (2 kilometre taşı).').waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Sahte proje', exact: true }).click();
  await until(
    async () => (await page.getByLabel(L.project.leftOff).inputValue()) === 'Sahte ajan durumu güncelledi.',
    'status page updated by the agent',
  );
  assert.equal(await page.getByLabel(L.project.milestoneDone.replace('{{text}}', 'Yayınlandı')).isChecked(), true);
  await page.getByLabel(L.project.nextStep.replace('{{n}}', '1')).fill('Yayın notlarını yaz');
  await page.getByRole('button', { name: L.project.save }).click();
  await page.getByText(L.project.updatedBy.replace('{{name}}', 'Kaan').split(' · ')[0]).waitFor();
  await shot(page, 'project-updated');

  // Memory: /hatırla writes a note, the profile is saved in Bellek, and the next job says what it recalled.
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  await composer.fill('/hatırla Cuma günleri deploy yok');
  await composer.press('Enter');
  await page.getByText(L.memory.remembered).waitFor();
  await page.getByRole('button', { name: L.shell.memory, exact: true }).click();
  const notes = page.getByLabel(L.memory.sections.notes, { exact: true });
  assert.match(await notes.inputValue(), /Cuma günleri deploy yok/);
  await page.getByLabel(L.memory.sections.profile, { exact: true }).fill('Kaan, kısa yanıtları sever.');
  await page.getByRole('button', { name: L.memory.save }).click();
  // Saved: the section's buttons go away.
  await page.getByRole('button', { name: L.memory.save }).waitFor({ state: 'detached' });
  await shot(page, 'memory');
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  await composer.fill('@claude bellek testi');
  await composer.press('Enter');
  await page
    .locator('.job', { hasText: L.memory.recalled_other.replace('{{count}}', '2') })
    .first()
    .waitFor();

  // Quick entry: a small window of its own (Ctrl Alt Space, or from the palette) writes to a channel.
  await page.keyboard.press('Control+k');
  await search.fill(L.quick.title);
  await search.press('Enter');
  let quickPage;
  await until(async () => {
    quickPage = first.app.windows().find((w) => w.url().includes('#quick'));
    return Boolean(quickPage);
  }, 'quick entry window');
  const quickTo = quickPage.getByLabel(L.quick.to);
  await until(async () => (await quickTo.locator('option').count()) > 0, 'channels in quick entry');
  await quickTo.selectOption({ label: '#genel' });
  await quickPage.getByLabel(L.quick.message).fill('hızlı girişten not');
  const quickPng = await current.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('#quick'));
    return w ? (await w.webContents.capturePage()).toPNG().toString('base64') : '';
  });
  if (quickPng) writeFileSync(join(shots, 'ch-quick-entry.png'), Buffer.from(quickPng, 'base64'));
  await quickPage.getByLabel(L.quick.message).press('Enter');
  await quickPage.getByText(L.quick.sent).waitFor();
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  await page.getByText('hızlı girişten not').waitFor();

  // Moving from Fabrika: the palette imports a roblox-factory-shaped folder (the folder picker answers with the project).
  mkdirSync(join(project, 'ideas'), { recursive: true });
  writeFileSync(
    join(project, 'ideas', '20261009-030000-dice-zoo.md'),
    [
      '---',
      'title: Dice Zoo',
      'kind: game',
      'status: new',
      'tags: [rng]',
      '---',
      'Roll dice, collect animals.',
      '',
    ].join(String.fromCharCode(10)),
  );
  mkdirSync(join(project, '.claude', 'commands'), { recursive: true });
  writeFileSync(join(project, '.claude', 'commands', 'deep-dive.md'), 'Study a game in depth.');
  await page.keyboard.press('Control+k');
  await search.fill(L.fabrika.import.split(' (')[0]);
  await search.press('Enter');
  try {
    await page.getByText(L.fabrika.done.split(':')[0]).waitFor({ timeout: 15_000 });
  } catch (err) {
    await shot(page, 'fabrika-failed');
    throw err;
  }
  await page.getByRole('button', { name: L.shell.ideas, exact: true }).click();
  await page.locator('.rec', { hasText: 'Dice Zoo' }).first().waitFor();
  await shot(page, 'fabrika-import');

  // Edit and delete own messages.
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  const own = page.locator('.msg--person').first();
  await own.hover();
  await own.getByRole('button', { name: L.channel.edit }).click();
  const editor = own.getByRole('textbox', { name: L.channel.edit });
  await editor.fill('@claude README dosyasında ne var? (düzeltildi)');
  await editor.press('Enter');
  await page.getByText(L.channel.edited).waitFor();

  await composer.fill('silinecek mesaj');
  await composer.press('Enter');
  const doomed = page.locator('.msg--person', { hasText: 'silinecek mesaj' });
  await doomed.hover();
  await doomed.getByRole('button', { name: L.channel.delete }).click();
  await until(async () => (await doomed.count()) === 0, 'message deleted');
  assert.deepEqual(first.errors, [], first.errors.join('\n'));
} finally {
  await first.app.close();
}

// Everything is still there after a restart; the stopped job stays stopped.
const second = await launch();
page = second.page;
try {
  await page.getByRole('heading', { name: L.shell.crew }).waitFor();
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  await page.getByText('(düzeltildi)').waitFor();
  await page.getByText('sahte proje').first().waitFor();
  assert.equal(await page.getByText('silinecek mesaj').count(), 0);
  await page
    .getByRole('region', { name: L.goal.title })
    .first()
    .getByText(L.goal.state.done, { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '@claude', exact: true }).click();
  await page.getByText(L.job.state.stopped).first().waitFor();
  await page.getByRole('button', { name: 'Sahte proje', exact: true }).click();
  assert.equal(await page.getByLabel(L.project.nextStep.replace('{{n}}', '1')).inputValue(), 'Yayın notlarını yaz');
  await shot(page, 'restart');
  assert.deepEqual(second.errors, [], second.errors.join('\n'));
} finally {
  await second.app.close();
}

if (process.env.E2E_KEEP !== '1') for (const d of [home, project, bin]) rmSync(d, { recursive: true, force: true });
registry.close();
console.log(`channel e2e ok, ${n} screenshots in ${shots}`);
