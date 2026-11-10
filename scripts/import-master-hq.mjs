// One-time import of Brad's Master HQ (Claude artifact) into BRAD OS.
// Real task/subscription/email data is NOT stored in this repo: export it first with the
// ArtifactData tool (collections "tasks", "subs", doc "inbox/latest") into a folder, then:
//   BOS_URL=… BOS_PASSWORD=… node scripts/import-master-hq.mjs <export-dir>
// Idempotent (rows carry ext_id). Gibbons Crew items go to the Family space only.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const base = (process.env.BOS_URL ?? '').replace(/\/$/, '');
const password = process.env.BOS_PASSWORD;
const dir = process.argv[2];
if (!base || !password || !dir) (console.error('Usage: BOS_URL=… BOS_PASSWORD=… node scripts/import-master-hq.mjs <export-dir>'), process.exit(1));

const readAll = (sub) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).filter((f) => f.endsWith('.json')).map((f) => {
  const j = JSON.parse(readFileSync(join(dir, sub, f), 'utf8'));
  return { id: f.replace(/\.json$/, ''), ...(j.data ?? j) };
}) : []);
const tasks = readAll('tasks');
const subs = readAll('subs');
const inboxFile = join(dir, 'inbox', 'latest.json');
const inbox = existsSync(inboxFile) ? ((j) => (j.data ?? j).items ?? [])(JSON.parse(readFileSync(inboxFile, 'utf8'))) : [];

// Project cards from Master HQ (public-safe wording: no children's names in the repo).
const projects = [
  { key: 'runnit', title: 'Runnit', status: 'Live at City Ink · pitching', what: 'The front desk for tattoo studios. Auto-replies first, then posting. The goal: a million-dollar company.',
    clients: ['City Ink · live', 'Celebrity Ink', 'All Ink', 'Canggu Ink Club', 'Bloodline', 'Kayo · next'], next: 'Pick the founding price, fill the brackets in the deck, then send each studio its own page.',
    links: [['Runnit HQ', 'https://claude.ai/artifact/DBEv1pxAc2jiphN1bCKLap'], ['Studio Links', 'https://claude.ai/artifact/HydToY6e5nPNhs78SFJcy2'], ['Pitch Deck', 'https://claude.ai/artifact/HpwnskgHrrMVhVMAdqd2qo'], ['Strategy', 'https://claude.ai/artifact/7rRKDJwNG2TMepLMMpZhwe'], ['Start here', 'https://docs.google.com/document/d/1yelkTQjrJ95Y4DZ13g1UBJBn-4A2D9HCzeWZf4LcCE0/edit'], ['Drive', 'https://drive.google.com/drive/folders/1rzkpy-A85W1yxns7_tOUkV5tf908PXrC'], ['City Ink app', 'https://claude-code-auto-reply-city-ink-production.up.railway.app']] },
  { key: 'softr', title: 'SOFTR', status: 'Pre-launch · waitlist first', what: 'DIY skincare kits for kids, made with the girls. Mix. Learn. Glow.',
    clients: ['Candy Kit · A$59.95', 'Fruit Kit · A$59.95', 'Serum Base', 'Glitter Mix', 'Cleanser'], next: 'Build the waitlist page, then the next caricature in the house style.',
    links: [['SOFTR HQ', 'https://claude.ai/artifact/NaAvxw2oknpd3JFyiFb2HM'], ['Brand Book', 'https://claude.ai/artifact/Xb3JS3FL64jt79Y4V59QVS'], ['Start here', 'https://docs.google.com/document/d/1V5mwJvlf6YD1t-NUORE_SEeWFn_0IKMPRI-phhKvlFo/edit'], ['Brand Bible', 'https://docs.google.com/document/d/10Akh3JCnnDKOtY-LwDQnuc3K9gReKL41nil38TqLiuU/edit'], ['Drive', 'https://drive.google.com/drive/folders/1l9JJyI01X2ueQTmOZbLX5MwkvFu1-8lg']] },
  { key: 'agency', title: 'Cel-X × Cyph', status: 'Clients', what: 'Cel-X Digital builds the systems. Cyph Media builds the culture. You run both.',
    clients: ['City Ink', 'Jason Gill Clothing', 'All Ink NSW', 'Haste Hygiene', 'Kayo · pending', 'Canggu Ink · pending'], next: 'Lock in a prepaid deal with City Ink.',
    links: [['Agency HQ', 'https://claude.ai/artifact/NBVyamtXkQnwLfSnNqWAHq'], ['Clients folder', 'https://drive.google.com/drive/folders/1ifvet9qYVrJkZJDKQgLlw9VWvW75AOTi'], ['Brand files', 'https://drive.google.com/drive/folders/1q4yEWi1FhD2izKeZvj15Vg-X2AJOvAdR']] },
  { key: 'encap', title: 'Encapsulator', status: 'Package ready to send', what: 'Consulting package for Danny Shannon: a 42-finding audit, a strategy board with 7 ideas, a pitch, a site rebuild and an app mockup. Framed as genuine help, not a sales pitch.',
    clients: ['Danny Shannon'], next: 'Send Danny the warm-intro email with the package.',
    links: [['Encapsulator HQ', 'https://claude.ai/artifact/BWg2E735reSC5ntUNPLFSr'], ['Drive folder', 'https://drive.google.com/drive/folders/1bqI9k_nLjdvK_SB_vGRr7E6YoyvLhc05'], ['Context file', 'https://drive.google.com/file/d/101Gzku3Vo9RUIhX_uM9_elo40AblcZ1l/view'], ['Their site', 'https://encapsulator.io']] },
  { key: 'five8', title: 'Five Eights Clothing Co', status: 'Check status', what: 'Sydney streetwear: gridiron-style jerseys with the 58 shield. Loyalty ★ Authenticity ★ Mateship. You built the "Who\'s Your 58?" campaign.',
    clients: ['Jason'], next: 'Confirm where the work stands, and get "NFL jersey" changed to "gridiron jersey" on the listings.',
    links: [['Five Eights HQ', 'https://claude.ai/artifact/Tzg5mFy6wUGyVPkmEjCJMn'], ['Drive folder', 'https://drive.google.com/drive/folders/1PUrtBx42rs8cix2MaWMZxbvA1XRZBKhZ'], ['Context file', 'https://drive.google.com/file/d/1DBvnPn6kxPHsAKU0x6mzwsi9MoO3arFn/view'], ['Instagram', 'https://www.instagram.com/fiveeightsclothingco/']] },
  { key: 'crew', title: 'Gibbons Crew', status: 'Live · family only', what: 'Our family dashboard: rooms, jobs and rewards, moods and the week ahead. Yoomee is folded in.',
    clients: ['#01 Dad', '#02', '#03', '+ Yoomee', 'Comic · ready to start'], next: 'Send the girls their Yumi invite links from Settings › Phones.',
    links: [['Crew HQ', 'https://claude.ai/artifact/9YMjBbTMmdR4KEzgaHbvKR'], ['Yumi ★', 'https://yumi-production-e794.up.railway.app'], ['Crew OS', 'https://claude.ai/artifact/7eNNkkkYucrXvpKTboUavY'], ['Phones plan', 'https://docs.google.com/document/d/164vNLZP8ECFulLY7sKnK0JFUJ2yMJ2XYNGLv-tCPvbE/edit'], ['Brand Book', 'https://claude.ai/artifact/N8U82mFdZSgE29VeCnLHwP'], ['Start here', 'https://docs.google.com/document/d/10H7ekAe_oMXeZkSP_tgwtOvv-fNPQGUBTkccqM7ACG4/edit'], ['Drive', 'https://drive.google.com/drive/folders/1pRmyhXlkkieVy91GBbxPhEyUGrIA6dxi']] },
].map((p) => ({ ...p, links: p.links.map(([label, url]) => ({ label, url })) }));

let cookie = '';
async function api(method, path, body) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', 'x-brad-os': '1', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data?.error ?? ''}`);
  return data;
}

const isCrew = (x) => (x.project ?? x.key) === 'crew';
await api('POST', '/auth/login', { password });
await api('POST', '/auth/lens', { lens: 'work' });
const work = await api('POST', '/import/hq', { projects: projects.filter((p) => !isCrew(p)), tasks: tasks.filter((t) => !isCrew(t)), subs, inbox });
await api('POST', '/auth/lens', { lens: 'family', password });
const fam = await api('POST', '/import/hq', { projects: projects.filter(isCrew), tasks: tasks.filter(isCrew) });
await api('POST', '/auth/lens', { lens: 'work' });
await api('POST', '/auth/logout');
console.log('Work & Life:', JSON.stringify(work));
console.log('Family:', JSON.stringify(fam));
