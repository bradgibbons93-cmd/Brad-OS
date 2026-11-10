// Loads Brad's Fresh Start Playbook (Drive: THE GIBBONS FAMILY / "Fresh Start – Infographic.pdf" and
// "Fresh Start – Rules.png") into the Work & Life space of a BRAD OS instance, through the public API.
// Safe to re-run: it stops if the "Fresh Start" project already exists.
//
// Usage: BOS_URL=https://… BOS_PASSWORD=… node scripts/load-fresh-start.mjs
// Contains no family details, by design (the playbook itself says: skip custody and legal).

const base = (process.env.BOS_URL ?? '').replace(/\/$/, '');
const password = process.env.BOS_PASSWORD;
if (!base || !password) {
  console.error('Set BOS_URL and BOS_PASSWORD');
  process.exit(1);
}

let cookie = '';
async function api(method, path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-brad-os': '1', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data?.error ?? ''}`);
  return data;
}

const DRIVE_PLAYBOOK = 'https://drive.google.com/file/d/1qpAYcxIl3uhFUetiK-GH11lux4_EBRm_/view';
const DRIVE_RULES = 'https://drive.google.com/file/d/1FHIGfcd_xiQYl8FXbdGrQWuKIybK73Te/view';
const WS = 'ws_personal';

/** Next date (YYYY-MM-DD) falling on the given weekday (0=Sun), including today. */
function nextWeekday(dow, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}
const today = new Date().toISOString().slice(0, 10);

await api('POST', '/auth/login', { password });
const me = await api('GET', '/auth/me');
if (me.lens !== 'work') await api('POST', '/auth/lens', { lens: 'work' });

const existing = await api('GET', '/projects');
if (existing.some((p) => p.title === 'Fresh Start')) {
  console.log('Fresh Start is already loaded. Nothing to do.');
  process.exit(0);
}

const folder = await api('POST', '/folders', { workspaceId: WS, name: 'Fresh Start' });

const rules = await api('POST', '/notes', {
  workspaceId: WS,
  folderId: folder.id,
  title: 'My rules',
  kind: 'decision',
  origin: 'external',
  sourceLabel: 'Google Drive › THE GIBBONS FAMILY › Fresh Start – Rules.png',
  sourceUrl: DRIVE_RULES,
  favorite: true,
  tags: ['fresh-start', 'rules'],
  body: `# My rules

*Pause. Check. Then go.*

1. **Drive is the truth**
2. **Nothing sends without my yes**
3. **One tool per job**
4. **Check credits first**
5. **Kids' photos: never in tools**
6. **Skip custody and legal**

_Keep it safe._`,
});

const playbook = await api('POST', '/notes', {
  workspaceId: WS,
  folderId: folder.id,
  title: 'Fresh Start Playbook',
  kind: 'reference',
  origin: 'external',
  sourceLabel: 'Google Drive › THE GIBBONS FAMILY › Fresh Start – Infographic.pdf',
  sourceUrl: DRIVE_PLAYBOOK,
  favorite: true,
  tags: ['fresh-start', 'weekly-rhythm', 'tools'],
  body: `# Fresh Start Playbook

**One tool per job. One clear week.** Keep it simple. See [[My rules]].

## Who does what

| Tool | Job |
|---|---|
| **Drive** | The vault |
| **Claude** | The brain |
| **Manus** | The hands |
| **Higgsfield** | The studio |
| **Notion** | The scoreboard |
| **ChatGPT** | The backup |

## My week

- **Work window:** Mon–Fri, 9:00am–3:00pm. Built around the kids.
- **Every weekday:** 9:00am check · 2:30pm check
- **Monday 9:15am:** Money Monday
- **Friday 2:00pm:** Reset
- Keep each work block to **25 minutes**. One job each.

## Do next

- **Today:** 9:00am check, 2:30pm check
- **This week:** 9:15am Money Monday, Friday reset
- **Later:** Add tools after HQ review

_Tick as you go._`,
});

const project = await api('POST', '/projects', {
  workspaceId: WS,
  title: 'Fresh Start',
  status: 'active',
  summary: 'One tool per job, one clear week. Work window Mon–Fri 9:00am–3:00pm, built around the kids, in 25-minute blocks.',
  nextAction: '9:00am check',
});

for (const id of [playbook.id, rules.id]) await api('PATCH', `/notes/${id}`, { projectId: project.id });

const tasks = [
  { title: '9:00am check', dueDate: today, priority: 1, details: 'Every weekday. One 25-minute block.' },
  { title: '2:30pm check', dueDate: today, priority: 1, details: 'Every weekday, before the 3:00pm finish.' },
  { title: 'Friday reset (2:00pm)', dueDate: nextWeekday(5), priority: 1, details: 'Weekly. Close the week, clear the Inbox, set up Monday.' },
  { title: 'Money Monday (9:15am)', dueDate: nextWeekday(1, new Date(Date.now() + 86400_000)), priority: 1, details: 'Weekly money check.' },
  { title: 'Add tools after HQ review', dueDate: null, priority: 0, details: 'Later. Only after the HQ review. One tool per job.' },
];
for (const t of tasks) await api('POST', '/tasks', { projectId: project.id, ...t });

console.log(`Loaded: project "Fresh Start", ${tasks.length} tasks, 2 notes (pinned), folder "Fresh Start".`);
