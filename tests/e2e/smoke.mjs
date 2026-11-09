// End-to-end smoke test: boots the production server on a throwaway database and drives
// the main workflows in a real browser. Usage: npm run build && npm run e2e
// Env: E2E_URL to test an existing deployment (with E2E_PASSWORD), SHOTS=dir to save screenshots.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// Uses a globally available Playwright (not a project dependency, to keep installs lean).
const { chromium } = createRequire(import.meta.url)('playwright');

const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password-123';
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let base = process.env.E2E_URL;
let server, dataDir;

if (!base) {
  dataDir = mkdtempSync(join(tmpdir(), 'bos-e2e-'));
  const port = 3900 + Math.floor(Math.random() * 90);
  base = `http://localhost:${port}`;
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, BRAD_OS_PASSWORD: PASSWORD, SESSION_SECRET: 'e2e-secret-e2e-secret', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('listening') && resolve());
    server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
    setTimeout(() => reject(new Error('server start timeout')), 15000);
  });
}

const steps = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    steps.push(`✓ ${name} (${Date.now() - t}ms)`);
  } catch (e) {
    steps.push(`✗ ${name}: ${e.message.split('\n')[0]}`);
    throw e;
  }
};
const shot = (page, name) => shots && page.screenshot({ path: join(shots, `${name}.png`), fullPage: false });

const browser = await chromium.launch();
const errors = [];
let failed = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('401') && errors.push(m.text()));

  await step('login screen rejects wrong password', async () => {
    await page.goto(base);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('alert').waitFor();
    await shot(page, '01-login');
  });

  await step('login and Today dashboard', async () => {
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: /Good|Late night/ }).waitFor();
    await page.getByText('Active projects').waitFor();
    await shot(page, '02-today');
  });

  await step('quick capture from Today', async () => {
    await page.getByLabel('Quick capture').fill('E2E idea about pricing pages #e2e');
    await page.keyboard.press('Enter');
    await page.getByText('Captured to Inbox').waitFor();
  });

  await step('capture via C shortcut', async () => {
    await page.locator('body').click({ position: { x: 700, y: 120 } });
    await page.keyboard.press('Escape');
    await page.keyboard.press('c');
    await page.getByLabel('Capture text').fill('Shortcut capture https://example.org/x');
    await page.keyboard.press('Control+Enter');
    await page.getByText('Captured to Inbox').first().waitFor();
  });

  await step('convert inbox capture to a note', async () => {
    await page.goto(`${base}/inbox`);
    const item = page.locator('.capture-item', { hasText: 'E2E idea about pricing pages' });
    await item.hover();
    await item.getByRole('button', { name: 'Note' }).click();
    await page.getByRole('button', { name: 'Create & open' }).click();
    await page.getByLabel('Title').waitFor();
    if ((await page.getByLabel('Title').inputValue()) !== 'E2E idea about pricing pages') throw new Error('wrong title');
    await shot(page, '03-converted-note');
  });

  await step('write a new note with markdown, tags and a wiki link (autosave)', async () => {
    await page.goto(`${base}/knowledge/new`);
    await page.getByLabel('Title').fill('E2E Strategy Memo');
    await page.getByLabel('Note body').fill('## Plan\n\nLink to [[Welcome to BRAD OS]] and **bold** text with zanzibar keyword.');
    await page.getByLabel('Add tag').fill('strategy');
    await page.keyboard.press('Enter');
    await page.getByText(/Saved/).waitFor({ timeout: 8000 });
    await page.waitForURL(/\/knowledge\/note_/);
    await page.getByRole('button', { name: 'Split' }).click();
    await page.locator('.prose a.wikilink').waitFor();
    await page.waitForTimeout(400);
    await shot(page, '04-editor-split');
    // keep typing after the note got its id: must not be lost
    await page.getByLabel('Note body').press('End');
    await page.getByLabel('Note body').pressSequentially(' More.');
    await page.waitForTimeout(1200);
    await page.reload();
    await page.getByLabel('Note body').waitFor();
    const body = await page.getByLabel('Note body').inputValue();
    if (!body.endsWith('More.')) throw new Error(`autosave lost text: ${body.slice(-30)}`);
  });

  await step('wiki link opens the linked note', async () => {
    await page.getByRole('button', { name: 'Read' }).click();
    await page.locator('.prose a.wikilink:not(.missing)').click();
    await page.waitForFunction(() => document.querySelector('.title-input')?.value === 'Welcome to BRAD OS');
    await page.getByRole('button', { name: 'Write' }).click();
  });

  await step('command palette search finds the new note', async () => {
    await page.keyboard.press('Control+k');
    await page.getByLabel('Search', { exact: true }).fill('zanzib');
    await page.locator('.palette-item', { hasText: 'E2E Strategy Memo' }).waitFor();
    await shot(page, '05-palette');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.title-input')?.value === 'E2E Strategy Memo');
  });

  await step('folders: create and file a note', async () => {
    await page.goto(`${base}/knowledge?ws=ws_dev`);
    await page.getByRole('button', { name: 'Toggle folders' }).click();
    await page.locator('.tree-item', { hasText: 'Development & experiments' }).hover();
    await page.getByRole('button', { name: 'New folder in Development & experiments', exact: true }).click();
    await page.getByLabel('Folder name').fill('E2E Folder');
    await page.keyboard.press('Enter');
    await page.locator('.kb-list-head h1', { hasText: 'E2E Folder' }).waitFor();
    await shot(page, '06-knowledge');
  });

  await step('trash and restore a note', async () => {
    await page.goto(`${base}/knowledge?sort=title`);
    await page.locator('.note-card', { hasText: 'E2E Strategy Memo' }).click();
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Move to Trash' }).click();
    await page.getByText('Moved to Trash').waitFor();
    await page.goto(`${base}/knowledge?view=trash`);
    await page.locator('.note-card', { hasText: 'E2E Strategy Memo' }).click();
    await page.getByRole('button', { name: 'Restore' }).first().click();
    await page.getByText('Restored').waitFor();
  });

  await step('create a project, add and complete a task', async () => {
    await page.goto(`${base}/projects?new=1`);
    await page.getByPlaceholder("What's the outcome?").fill('E2E Launch Plan');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByLabel('New task').fill('Write launch checklist');
    await page.keyboard.press('Enter');
    await page.locator('.task', { hasText: 'Write launch checklist' }).waitFor();
    await page.locator('.task', { hasText: 'Write launch checklist' }).getByRole('button', { name: 'Mark as done' }).click();
    await page.getByText('Task completed').waitFor();
    await page.getByText('1/1').waitFor();
    await shot(page, '07-project');
  });

  await step('tasks view', async () => {
    await page.goto(`${base}/tasks`);
    await page.getByLabel('New task title').fill('E2E standalone task');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.locator('.task', { hasText: 'E2E standalone task' }).waitFor();
  });

  await step('full search page with filters', async () => {
    await page.goto(`${base}/search?q=launch`);
    await page.locator('.hit', { hasText: 'E2E Launch Plan' }).waitFor();
    await page.getByRole('button', { name: 'Tasks', exact: true }).click();
    await page.locator('.hit', { hasText: 'Write launch checklist' }).waitFor();
    await shot(page, '08-search');
  });

  await step('family lens needs password and hides work data', async () => {
    await page.goto(base);
    await page.getByRole('button', { name: 'Family' }).click();
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByText('Family space — separate').waitFor();
    await page.getByText('Family space unlocked').waitFor();
    await page.keyboard.press('Control+k');
    await page.getByLabel('Search', { exact: true }).fill('zanzib');
    await page.waitForTimeout(600);
    if (await page.locator('.palette-item', { hasText: 'E2E Strategy Memo' }).count()) throw new Error('work note visible in family lens');
    await page.keyboard.press('Escape');
    await shot(page, '09-family');
    await page.getByRole('button', { name: 'Lock now' }).click();
    await page.getByText('Back in Work & Life').waitFor();
  });

  await step('settings and export', async () => {
    await page.goto(`${base}/settings`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Export/ }).click()]);
    if (!dl.suggestedFilename().endsWith('.zip')) throw new Error('export not a zip');
  });

  await step('mobile layout', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await m.addCookies((await ctx.cookies()).map((c) => ({ ...c })));
    const mp = await m.newPage();
    mp.on('pageerror', (e) => errors.push(e.message));
    await mp.goto(base);
    await mp.getByText('Active projects').waitFor();
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error('horizontal overflow on mobile');
    await shot(mp, '10-mobile-today');
    await mp.goto(`${base}/knowledge`);
    await mp.locator('.note-card').first().click();
    await mp.getByLabel('Title').waitFor();
    await shot(mp, '11-mobile-note');
    await m.close();
  });

  await step('logout locks the app', async () => {
    await page.goto(base);
    await page.getByRole('button', { name: 'Lock' }).last().click();
    await page.getByRole('button', { name: 'Sign in' }).waitFor();
  });

  if (errors.length) throw new Error(`Browser errors:\n${[...new Set(errors)].join('\n')}`);
} catch (e) {
  failed = true;
  console.error(e.message);
  if (errors.length) console.error('Browser errors:', [...new Set(errors)].join('\n'));
  if (shots) for (const p of browser.contexts().flatMap((c) => c.pages())) await p.screenshot({ path: join(shots, 'FAILED.png') }).catch(() => {});
} finally {
  console.log(steps.join('\n'));
  await browser.close();
  server?.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
