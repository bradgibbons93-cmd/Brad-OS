// Loads "Brad's Fresh Start Playbook" (Claude Doc, updated 6 Nov, plus the "Fresh Start – Rules" card in
// Drive) into a BRAD OS instance through its public API.
//
// Privacy split, per the playbook's own rules:
//   - Work & Life gets the businesses, tools, routines and setup steps.
//   - Family (The Gibbons Crew) gets the Yumi + weekly comic items, via the password-gated family lens.
//   - Nothing about custody or legal, no kids' names, no school names, no photos.
// Safe to re-run: stops if the "Fresh Start setup" project already exists.
//
// Usage: BOS_URL=https://… BOS_PASSWORD=… node scripts/load-fresh-start.mjs

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

// Dates in Brad's timezone (the playbook's routines are Melbourne time).
const TZ = 'Australia/Melbourne';
const melDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const melDow = (d = new Date()) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d));
const nextDow = (dow, { strict = false } = {}) => {
  const add = (dow - melDow() + 7) % 7 || (strict ? 7 : 0);
  return melDate(new Date(Date.now() + add * 86400_000));
};
const today = melDate();
const friday = nextDow(5);
const monday = nextDow(1, { strict: true });

const PLAYBOOK_URL = 'https://claude.ai/artifact/VfVER7y24wGxx1JWtRmNTs';
const RULES_URL = 'https://drive.google.com/file/d/1FHIGfcd_xiQYl8FXbdGrQWuKIybK73Te/view';
const SOURCE = { origin: 'external', sourceUrl: PLAYBOOK_URL, sourceLabel: "Claude Doc › Brad's Fresh Start Playbook (updated 6 Nov)" };

async function project(p, tasks) {
  const created = await api('POST', '/projects', p);
  for (const t of tasks) await api('POST', '/tasks', { projectId: created.id, priority: 0, ...t });
  return created;
}

// ── Work & Life ─────────────────────────────────────────────────
await api('POST', '/auth/login', { password });
if ((await api('GET', '/auth/me')).lens !== 'work') await api('POST', '/auth/lens', { lens: 'work' });

if ((await api('GET', '/projects')).some((p) => p.title === 'Fresh Start setup')) {
  console.log('Fresh Start is already loaded. Nothing to do.');
  process.exit(0);
}

const folder = await api('POST', '/folders', { workspaceId: 'ws_personal', name: 'Fresh Start' });

const rules = await api('POST', '/notes', {
  workspaceId: 'ws_personal', folderId: folder.id, title: 'My rules', kind: 'decision', favorite: true,
  origin: 'external', sourceUrl: RULES_URL, sourceLabel: 'Google Drive › THE GIBBONS FAMILY › Fresh Start – Rules.png',
  tags: ['fresh-start', 'rules'],
  body: `# My rules

*Pause. Check. Then go.*

1. **Drive is the truth**
2. **Nothing sends without my yes**
3. **One tool per job**
4. **Check credits first**
5. **Kids' photos: never in tools**
6. **Skip custody and legal**

Never run the same job in two places. Part of [[Fresh Start Playbook]].`,
});

const playbook = await api('POST', '/notes', {
  workspaceId: 'ws_personal', folderId: folder.id, title: 'Fresh Start Playbook', kind: 'reference', favorite: true, ...SOURCE,
  tags: ['fresh-start', 'tools', 'routines'],
  body: `# Fresh Start Playbook

The full playbook (with every paste-in prompt) lives in the Claude Doc linked above. This is the working summary. See [[My rules]].

## Who does what (as of 6 Nov)

| Tool | Its one job | Never use it for |
|---|---|---|
| **Google Drive** | The vault: every file, style sheet and final asset (THE GIBBONS FAMILY) | Nothing important lives only in another app |
| **Claude** | The brain: plans, writes, builds in Claude Code, runs Higgsfield, reads Gmail, Drive and Calendar | Clicking around websites with no connector |
| **Manus** | The hands: inbox checks, school notices, Money Monday, Friday Notion update | Anything that sends, books or pays without a yes |
| **Higgsfield** | The studio: images, video and ads | Planning or writing |
| **Notion** | The scoreboard: one row per project | Being the only copy of anything |
| **ChatGPT** | Backup, plus Codex for code | Images (Higgsfield includes GPT Image 2) |

Grok Bot is being retired: pause its routines, cancel after Manus runs one clean week.

## Live projects

Runnit (City Ink is its first studio), SOFTR and Gibbons Crew. Add others only after the HQ review.
Gibbons Crew items live in the **Family** space.

## My week

Work window **Mon–Fri, 9:00am–3:00pm**, built around the kids. **25-minute blocks**, one job each.

| When | What happens | Who runs it | My part |
|---|---|---|---|
| Weekdays 9:00am | Unreplied clients, bills and official emails, with client drafts | Manus | Approve or edit drafts, 5 min |
| Weekdays 2:30pm | Same check before pickup | Manus | Approve or edit drafts, 5 min |
| Monday 9:15am | Money Monday: bills due this week, new or increased subscriptions, total | Manus | Read the list, 2 min |
| Friday 2:00pm | Reset: update Notion rows, file new style refs, paste best prompts into style sheets | Me + Notion | One 25-min block |

Anytime: see something I like, screenshot it into the project's style folder (10 seconds).

## Budget guardrails

| Tool | Guardrail |
|---|---|
| Higgsfield (Plus) | Every prompt ends "show me the credit quote first and stop if it's over X". Auto-refill off |
| Manus | Check credit use after the first week. Twice-daily browser checks cost the most |
| Claude Code | Run \`/status\` before any build: it must say my subscription, not an API key |
| Claude API / cookbook | None for now. Separate pay-per-use bill. Only for the Runnit upgrade |
| New subscriptions | Ask Claude first: "What do I already pay for that does this?" |

## Hard lines for every bot

- Nothing sends, books, posts or pays without my yes. Never type card details.
- Money and legal emails: flag only, never draft or reply.
- Skip custody and court entirely. Never use kids' photos.
- Don't touch Runnit, Yumi, GitHub, Railway or Meta Business Suite. Runnit already replies and posts for City Ink.`,
});

const style = await api('POST', '/notes', {
  workspaceId: 'ws_personal', folderId: folder.id, title: 'Style references', kind: 'reference', ...SOURCE,
  tags: ['fresh-start', 'style'],
  body: `# Style references

Every project has a style sheet, so every tool starts from my taste instead of guessing.
Drive: THE GIBBONS FAMILY / **04_STYLE-REFS** (starred). Each project folder has \`01_DESIGN-I-LIKE\`, \`02_VIDEO-I-LIKE\`, \`03_NOT-THIS\`.

| Open it | Link |
|---|---|
| 04_STYLE-REFS | [folder](https://drive.google.com/drive/folders/1kmwGI-jOcvt69rUzwrAdJrdWzY0zzYUE) |
| My taste sheet | [_STYLE-SHEET — MY TASTE](https://docs.google.com/document/d/1NIAi3O0rE_MK321bv2rTHPEQjDFItxKHMwFctP_CtRg/edit) |
| City Ink | [_STYLE-SHEET — CITY INK](https://docs.google.com/document/d/1bqOWdPdXm-BxwAFQLLuwPeKArVx6a0-wbkE9B9DwGp4/edit) |
| Runnit | [_STYLE-SHEET — RUNNIT](https://docs.google.com/document/d/166IQrAbhnvSx1vcAKIVHrZFmSyvCSe6VnWpk6hXqSuQ/edit) (filled 6 Nov) |
| SOFTR | [_STYLE-SHEET — SOFTR](https://docs.google.com/document/d/1yIeA37JbmXkXqrkxo4iPgxla5iNhNYUlPQTxgkYELAY/edit) |

## How to fill it (about 10 seconds a save)

1. **Design I like:** screenshot → Share → Drive → the project's 01_DESIGN-I-LIKE.
2. **Video I like:** screen-record 5–10 s into 02_VIDEO-I-LIKE, or paste the link into the sheet.
3. **Stuff I hate:** into 03_NOT-THIS.
4. **After 5+ saves:** ask Claude to read the folder and fill in the style sheet.
5. **When something comes out right:** paste that prompt into the sheet's "Best prompt so far".`,
});

const look = await api('POST', '/notes', {
  workspaceId: 'ws_runnit', title: 'Runnit look: locked (Gold Mascot)', kind: 'decision', ...SOURCE,
  tags: ['runnit', 'brand', 'decisions'],
  body: `# Runnit look: locked

**Decision:** the **Gold Mascot** set. Black and gold, torn-paper cream sections, the 3D Runnit CEO mascot, and the real app in a phone.
**Why:** it matches the live app (already black and gold), so site, ads and dashboard feel like one product.
**Second voice:** Retro Editorial (cream cards, one real object, two-beat lines) for quieter ads.
**Dropped:** the red set, black-and-red tech, surreal collage, clean minimal.

- Colours, type and rules: [_STYLE-SHEET — RUNNIT](https://docs.google.com/document/d/166IQrAbhnvSx1vcAKIVHrZFmSyvCSe6VnWpk6hXqSuQ/edit)
- Higgsfield: project **Runnit – App Screens & Canvas**, folder **★ REAL RUNNIT — use these**. Anything outside it is mood reference only.
- Palette: black \`#120F0D\`, metallic gold \`#D9A94E\`, cream \`#EFECE3\`.`,
});

const live = await api('POST', '/notes', {
  workspaceId: 'ws_dev', title: "What's live (work builds)", kind: 'reference', ...SOURCE,
  tags: ['builds', 'links'],
  body: `# What's live

Runnit is the company and City Ink is its first live studio. Each new studio (All Ink, Kayo) gets its own Runnit login with its own brand guide, taste and logo.

| Build | What it is | Links |
|---|---|---|
| **Runnit** | Front desk for tattoo studios: auto-replies and posting. City Ink live; All Ink and Kayo next | [App](https://claude-code-auto-reply-city-ink-production.up.railway.app) · [GitHub](https://github.com/bradgibbons93-cmd/Claude-code-auto-reply-city-ink-) |
| **BRAD OS** | This app: one place for notes, projects and tasks | [GitHub](https://github.com/bradgibbons93-cmd/Brad-OS) |
| **Master HQ** | Tasks, money, subscriptions and links. To-dos and money moving into Yumi's HQ tab | [Claude version](https://claude.ai/artifact/Vz5x2Cj1YVjRB1fcQYhor7) · offline backup in Drive |

**Never change Runnit's Railway web address.** Meta's webhook and App Review point at it; changing it stops City Ink's replies.
Yumi (the family app) is listed in the Family space.`,
});

const setup = await project(
  {
    workspaceId: 'ws_personal', title: 'Fresh Start setup', status: 'active',
    summary: 'One tool per job, one clear week. Hand Grok Bot\'s jobs to Manus, tidy the tool stack, then add tools only after the HQ review.',
    nextAction: 'Pause every Grok Bot routine, then paste the takeover task into Manus',
  },
  [
    { title: 'Grok Bot: pause every routine', dueDate: today, priority: 2, details: 'So two bots never act on the same thing.' },
    { title: 'Manus: paste the takeover task', dueDate: today, priority: 2, details: 'The full prompt is in the playbook, section "Update 6 Nov: Manus replaces Grok Bot". Do the setup, then run job 1 once.' },
    { title: 'Drop 3–5 screenshots into 04_STYLE-REFS / RUNNIT / 01_DESIGN-I-LIKE', dueDate: today, priority: 1 },
    { title: 'Check Manus credit use after its first week', dueDate: friday, priority: 1, details: 'Twice-daily browser checks are the biggest cost.' },
    { title: 'Cancel the Grok Bot plan once Manus has run one clean week', priority: 1 },
    { title: 'Switch off unused connectors: Netlify, Supermemory, Wix, Box, Windsor', details: 'Keep: Drive, Gmail, Calendar, Granola, Higgsfield, Railway, Notion, Canva. Claude → Settings → Connectors.' },
    { title: 'Mac: run `gh auth login` in Claude Code', details: 'Saved GitHub login was broken. Needed before the Runnit check or the repo rename.' },
    { title: 'Phone: add BRAD OS and Yumi to the Home Screen', details: 'Share → Add to Home Screen. (The playbook said Master HQ; BRAD OS is replacing it.) Keep the offline HQ file in Drive as backup.' },
    { title: 'Render the BRADS-AI-TEAM motion explainer', details: 'Later. Brief in Drive 07_CONTENT. Preview scenes 1–3 first, only render the rest after a yes.' },
    { title: 'Add tools after HQ review', details: 'Later. One tool per job.' },
  ],
);

const routines = await project(
  {
    workspaceId: 'ws_personal', title: 'Weekly routines', status: 'active',
    summary: 'Four routines inside the Mon–Fri 9am–3pm window. Manus does the work; my part is approving, about 40 minutes a week.',
    nextAction: '9:00am check: approve or edit drafts',
  },
  [
    { title: '9:00am check — approve or edit drafts (5 min)', dueDate: today, priority: 1, details: 'Every weekday. Manus sends the list of unreplied clients, bills and official emails.' },
    { title: '2:30pm check — approve or edit drafts (5 min)', dueDate: today, priority: 1, details: 'Every weekday, before pickup.' },
    { title: 'Friday reset, 2:00pm (25 min)', dueDate: friday, priority: 1, details: 'Update Notion rows, file new style refs, paste best prompts into style sheets.' },
    { title: 'Money Monday, 9:15am — read the list (2 min)', dueDate: monday, priority: 1, details: 'Bills due this week, new or increased subscriptions, total. Don\'t pay, reply or unsubscribe from the list itself.' },
  ],
);

const runnit = await project(
  {
    workspaceId: 'ws_runnit', title: 'Runnit: ready for studio #2', status: 'active',
    summary: 'Get Runnit ready for All Ink or Kayo to log in with their own brand, without breaking City Ink\'s replies and posting.',
    nextAction: 'Drop the full-size gold homepage files into the ★ REAL RUNNIT folder',
  },
  [
    { title: 'Drop full-size gold homepage files (desktop, mobile, launch grid) into Higgsfield ★ REAL RUNNIT', details: 'Next time at the Mac. Nothing is waiting on it.' },
    { title: 'Render the 30-second Runnit motion promo in Higgsfield', details: 'Prompt in the playbook. 5-second preview + credit quote first; stop if over 200 credits.' },
    { title: 'Claude Code: Runnit "ready to sell" check', details: 'Later. Run /status first. New branch only, never push to main or redeploy without a yes. Prompt in the playbook, step 7.' },
    { title: 'Rename repos to runnit and yumi, one sitting', details: 'Later. Check after each rename that Railway still deploys and the app loads. Do NOT change any Railway domain.' },
  ],
);

for (const id of [playbook.id, rules.id, style.id]) await api('PATCH', `/notes/${id}`, { projectId: setup.id });
await api('PATCH', `/notes/${look.id}`, { projectId: runnit.id });
void live; void routines;

// ── Family space (password-gated, separate boundary) ───────────
await api('POST', '/auth/lens', { lens: 'family', password });
const crew = await project(
  {
    workspaceId: 'ws_gibbons-crew', title: 'Gibbons Crew', status: 'active',
    summary: 'Yumi, our family app, plus the weekly comic.',
    nextAction: "Make this week's 4-panel comic page",
  },
  [
    { title: "This week's 4-panel comic page", dueDate: friday, details: 'Attach the character art yourself for this job only. Credit quote first; stop if over 60.' },
  ],
);
const crewNote = await api('POST', '/notes', {
  workspaceId: 'ws_gibbons-crew', title: 'Gibbons Crew: how we make things', kind: 'reference', favorite: true, ...SOURCE,
  tags: ['comic', 'style'],
  body: `# Gibbons Crew: how we make things

- **Yumi (Gibbons OS)** is the family app: rooms, jobs and rewards, the week ahead. [Open Yumi](https://yumi-production-e794.up.railway.app)
- Style sheet: [_STYLE-SHEET — GIBBONS CREW](https://docs.google.com/document/d/1arD_xSrA5rqwQUDEM5kXYqqi1RqWG0biFbzWdk_5LBA/edit). Art styles only, no photos.
- The reference sheets and photos stay in Drive **01_FAMILY / Reference Sheets**. Attach them yourself, per task, per tool. Never saved into a tool's memory or character.
- School notices are handled by Manus (flag only, book after a yes).

## Weekly comic prompt (Higgsfield via Claude)

\`\`\`
Read '_STYLE-SHEET — GIBBONS CREW' from my Drive first.
I'm attaching the Gibbons Crew character art myself. Use it for this job only, not in any saved character or memory.
Make this week's 4-panel comic page in that exact style with Higgsfield.
Show me the credit quote first and stop if it's over 60.
\`\`\``,
});
await api('PATCH', `/notes/${crewNote.id}`, { projectId: crew.id });
await api('POST', '/auth/lens', { lens: 'work' });
await api('POST', '/auth/logout');

console.log(`Loaded Work & Life: 3 projects (18 tasks), 5 notes in "Fresh Start" + Runnit + Development.
Loaded Family: "Gibbons Crew" project (1 task) and 1 note.`);
