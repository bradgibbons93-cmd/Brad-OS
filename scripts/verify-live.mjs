// Read-only check of a live BRAD OS deployment. Creates nothing.
// Usage: BOS_URL=https://… BOS_PASSWORD=… [SHOTS=dir] node scripts/verify-live.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const base = (process.env.BOS_URL ?? '').replace(/\/$/, '');
const password = process.env.BOS_PASSWORD;
const shots = process.env.SHOTS;
if (!base || !password) (console.error('Set BOS_URL and BOS_PASSWORD'), process.exit(1));
if (shots) mkdirSync(shots, { recursive: true });

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (e) {
    results.push(`✗ ${name}: ${e.message.split('\n')[0]}`);
  }
};

// API-level checks
await check('health endpoint', async () => {
  const r = await fetch(`${base}/api/health`);
  if (!r.ok) throw new Error(String(r.status));
});
await check('API refuses unauthenticated access', async () => {
  const r = await fetch(`${base}/api/notes`);
  if (r.status !== 401) throw new Error(`got ${r.status}`);
});
await check('security headers present', async () => {
  const r = await fetch(base);
  for (const h of ['content-security-policy', 'x-frame-options', 'strict-transport-security']) {
    if (!r.headers.get(h)) throw new Error(`missing ${h}`);
  }
});
await check('wrong password rejected', async () => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-brad-os': '1' },
    body: JSON.stringify({ password: 'definitely-wrong' }),
  });
  if (r.status !== 401) throw new Error(`got ${r.status}`);
});

const browser = await chromium.launch();
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', (e) => errors.push(e.message));

await check('sign in and Today renders', async () => {
  await page.goto(base);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Active projects').waitFor({ timeout: 15000 });
  if (shots) await page.screenshot({ path: join(shots, 'live-today.png') });
});
await check('session cookie is Secure + HttpOnly', async () => {
  const c = (await page.context().cookies()).find((x) => x.name === 'bos_session');
  if (!c?.secure || !c?.httpOnly) throw new Error(JSON.stringify(c));
});
for (const [path, text] of [['/inbox', 'Inbox'], ['/knowledge', 'All notes'], ['/projects', 'Projects'], ['/tasks', 'Tasks'], ['/settings', 'Privacy boundary']]) {
  await check(`page ${path}`, async () => {
    await page.goto(base + path);
    await page.getByText(text).first().waitFor({ timeout: 10000 });
  });
}
await check('search works', async () => {
  await page.goto(`${base}/search?q=runnit`);
  await page.locator('.hit').first().waitFor({ timeout: 10000 });
});
await check('family space asks for password', async () => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Family' }).click();
  await page.getByRole('heading', { name: 'Unlock the Family space' }).waitFor();
  await page.keyboard.press('Escape');
});
await check('mobile: no horizontal scroll', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.addCookies(await page.context().cookies());
  const mp = await m.newPage();
  await mp.goto(base);
  await mp.getByText('Active projects').waitFor({ timeout: 15000 });
  if (await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('overflow');
  if (shots) await mp.screenshot({ path: join(shots, 'live-mobile.png') });
});
await check('no browser errors', async () => {
  if (errors.length) throw new Error(errors.join(' | '));
});
await browser.close();

console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
