import type { DB } from './db.ts';
import { newId, tx } from './db.ts';
import { get, run, type Boundary } from './repo/base.ts';
import { createNote } from './repo/notes.ts';
import { createFolder } from './repo/folders.ts';
import { createProject, createTask } from './repo/projects.ts';
import { createCapture } from './repo/inbox.ts';

/**
 * Workspaces = Brad's ecosystem. "The Gibbons Crew" and "Family" sit behind the family
 * boundary: when in doubt, the stricter boundary wins. A workspace's boundary cannot be changed later
 * (enforced by trigger), so this choice is deliberate.
 */
export const WORKSPACES: { slug: string; name: string; kind: 'business' | 'personal' | 'dev' | 'family'; color: string }[] = [
  { slug: 'cel-x-group', name: 'Cel-X Group', kind: 'business', color: '#d9a35b' },
  { slug: 'cel-x-digital', name: 'Cel-X Digital', kind: 'business', color: '#c8875a' },
  { slug: 'cyph-media', name: 'Cyph Media', kind: 'business', color: '#b48ead' },
  { slug: 'runnit', name: 'Runnit', kind: 'business', color: '#7fa88b' },
  { slug: 'city-ink', name: 'City Ink Tattoo', kind: 'business', color: '#c46a5a' },
  { slug: 'softr', name: 'SOFTR', kind: 'business', color: '#6f98b8' },
  { slug: 'personal', name: 'Personal', kind: 'personal', color: '#a8a07a' },
  { slug: 'dev', name: 'Development & experiments', kind: 'dev', color: '#8a9a9e' },
  { slug: 'gibbons-crew', name: 'The Gibbons Crew', kind: 'family', color: '#c9a27e' },
  { slug: 'family', name: 'Family', kind: 'family', color: '#d4b48a' },
];

export function ensureWorkspaces(db: DB) {
  WORKSPACES.forEach((w, i) => {
    run(
      db,
      'INSERT OR IGNORE INTO workspaces (id, slug, name, kind, boundary, color, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
      `ws_${w.slug}`, w.slug, w.name, w.kind, w.kind === 'family' ? 'family' : 'work', w.color, i,
    );
  });
}

const ws = (slug: string) => `ws_${slug}`;

/** Sample data: made-up names only. No real business data, figures, people, or family details. */
export function seedSample(db: DB) {
  if (get<{ v: string }>(db, "SELECT value AS v FROM meta WHERE key = 'seeded'")) return false;
  const work = { boundary: 'work' as Boundary };
  const family = { boundary: 'family' as Boundary };
  const days = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

  tx(db, () => {
    const guides = createFolder(db, work, { workspaceId: ws('personal'), name: 'Guides' });
    const research = createFolder(db, work, { workspaceId: ws('cyph-media'), name: 'Research' });
    createFolder(db, work, { workspaceId: ws('cyph-media'), parentId: research.id, name: 'Audience' });
    const clients = createFolder(db, work, { workspaceId: ws('cel-x-digital'), name: 'Clients' });

    createNote(db, work, {
      workspaceId: ws('personal'),
      folderId: guides.id,
      title: 'Welcome to BRAD OS',
      kind: 'reference',
      favorite: true,
      sample: true,
      tags: ['guide'],
      body: `# Welcome to BRAD OS

This is your private knowledge engine. Everything here is **sample data**: remove it any time from *Settings → Sample data*.

## The five-second version
- Press **C** anywhere to capture a thought, link or idea. It lands in the **Inbox**.
- Press **⌘K** (or **/**) to search everything.
- Turn Inbox items into **notes** or **tasks** when you have a minute.
- Group work into **Projects**; file knowledge into **folders** and **#tags**.

## Linking
Write \`[[Note title]]\` to link to another note, for example [[How BRAD OS treats your files]].

## Two spaces
**Work & Life** holds the businesses, personal notes and experiments. **Family** is a separate, locked space.
Nothing from Family ever shows up in Work & Life — not in search, tags, Today or exports.`,
    });

    createNote(db, work, {
      workspaceId: ws('personal'),
      folderId: guides.id,
      title: 'How BRAD OS treats your files',
      kind: 'reference',
      sample: true,
      tags: ['guide', 'data-ownership'],
      body: `# How BRAD OS treats your files

Google Drive stays the source of truth. Every note shows where it came from:

| Badge | Meaning |
|---|---|
| **Native** | Written here in BRAD OS |
| **Source** | A pointer to an original document that lives elsewhere (e.g. Drive) |
| **Imported copy** | A copy of a file you imported. The original is untouched |
| **Link** | A bookmark or web reference |
| **AI** | An AI summary or interpretation (coming in Phase 3) |

BRAD OS never syncs, overwrites or deletes anything outside itself.`,
    });

    createNote(db, work, {
      workspaceId: ws('cel-x-group'),
      title: 'Decision log — template',
      kind: 'decision',
      sample: true,
      tags: ['template', 'decisions'],
      body: `# Decision log — template

**Decision:** _What was decided, in one sentence._
**Date:** _YYYY-MM-DD_
**Why:** _The two or three reasons that mattered._
**Alternatives considered:** _What else was on the table._
**Revisit when:** _The signal that would change this decision._`,
    });

    createNote(db, work, {
      workspaceId: ws('cel-x-digital'),
      folderId: clients.id,
      title: 'Client brief — Northwind Studio (sample)',
      kind: 'business',
      sample: true,
      tags: ['client', 'template'],
      body: `# Client brief — Northwind Studio (sample)

> Fictional client used to show how a brief looks in BRAD OS.

## Goals
- Clarify the offer on the homepage
- Shorten the enquiry form

## Contacts
- [[Alex Rivera (sample contact)]]

## Open questions
- Who signs off copy?`,
    });

    createNote(db, work, {
      workspaceId: ws('cel-x-digital'),
      title: 'Alex Rivera (sample contact)',
      kind: 'person',
      sample: true,
      tags: ['people'],
      body: `# Alex Rivera (sample contact)

Fictional person record.

- **Role:** Marketing lead at Northwind Studio (fictional)
- **Prefers:** short emails, decisions in writing
- **Related:** [[Client brief — Northwind Studio (sample)]]`,
    });

    createNote(db, work, {
      workspaceId: ws('cyph-media'),
      folderId: research.id,
      title: 'Short-form video hooks — research notes',
      kind: 'research',
      sample: true,
      tags: ['content', 'research'],
      body: `# Short-form video hooks — research notes

Sample research note. Replace with your own findings.

- Open on the outcome, then show the process
- One idea per clip
- Captions on by default

Source ideas worth checking: [[Decision log — template]] for recording what you decide to test.`,
    });

    createNote(db, work, {
      workspaceId: ws('dev'),
      title: 'Experiment idea: weekly review ritual',
      kind: 'note',
      sample: true,
      tags: ['ideas', 'habits'],
      body: `# Experiment idea: weekly review ritual

Every Friday: empty the Inbox, close finished tasks, pick three priorities for next week.`,
    });

    createNote(db, work, {
      workspaceId: ws('personal'),
      title: 'Markdown cheatsheet',
      kind: 'reference',
      origin: 'link',
      sourceUrl: 'https://commonmark.org/help/',
      sourceLabel: 'commonmark.org',
      sample: true,
      tags: ['guide'],
      body: `Bookmark: the CommonMark quick reference.\n\n**bold**, *italic*, \`code\`, > quotes, - lists, [links](https://example.com).`,
    });

    createNote(db, work, {
      workspaceId: ws('city-ink'),
      title: 'Studio policies — where the real copy lives',
      kind: 'reference',
      origin: 'external',
      sourceLabel: 'Google Drive (not connected yet)',
      sample: true,
      tags: ['policies'],
      body: `Sample **source reference**: the canonical document lives in Google Drive. BRAD OS only keeps this pointer and your notes about it.\n\n_Drive integration is not connected yet (Phase 4)._`,
    });

    const web = createProject(db, work, {
      workspaceId: ws('cel-x-digital'),
      title: 'Sample: Website refresh for Northwind Studio',
      summary: 'Fictional project showing how a workspace looks: notes, tasks, next action and activity in one place.',
      status: 'active',
      nextAction: 'Draft the new homepage outline',
      dueDate: days(21),
    });
    for (const [title, due, priority] of [
      ['Draft the new homepage outline', days(2), 2],
      ['Collect current enquiry-form questions', days(4), 1],
      ['Book a review call (sample)', days(7), 0],
    ] as const) createTask(db, work, { projectId: web.id, title, dueDate: due, priority });

    const content = createProject(db, work, {
      workspaceId: ws('cyph-media'),
      title: 'Sample: Content calendar system',
      summary: 'Fictional project: a repeatable way to plan, film and publish.',
      status: 'planning',
      nextAction: 'Decide on posting cadence',
    });
    createTask(db, work, { projectId: content.id, title: 'List ten evergreen topics', priority: 1 });

    createTask(db, work, { workspaceId: ws('personal'), title: 'Try the ⌘K search', dueDate: days(0), priority: 1 });

    for (const body of [
      'Idea: a one-page “how we work” doc for new clients #ideas',
      'https://example.com/article-worth-reading #reading',
      'Remember to set up the weekly review ritual',
    ]) createCapture(db, work, { body });

    // Family space: a single explainer. No names, photos, or personal details — ever.
    createNote(db, family, {
      workspaceId: ws('family'),
      title: 'How the Family space works',
      kind: 'reference',
      sample: true,
      body: `# How the Family space works

This space is locked separately from Work & Life and re-locks itself after an hour.

- Nothing here appears in business search, tags, Today, or exports from Work & Life.
- Photos and reference sheets stay in Google Drive (01_FAMILY). BRAD OS does not store them.
- Household to-dos and money live in Yumi. Link to them from here if useful.`,
    });

    // Mark everything created so far as sample, so it can be removed in one go.
    for (const t of ['folders', 'notes', 'projects', 'tasks', 'captures']) run(db, `UPDATE ${t} SET sample = 1`);
    run(db, "INSERT INTO meta (key, value) VALUES ('seeded', ?)", newId('seed'));
  });
  return true;
}

export function removeSample(db: DB, boundary: Boundary) {
  return tx(db, () => {
    const counts: Record<string, number> = {};
    counts.notes = Number(run(db, 'DELETE FROM notes WHERE sample = 1 AND workspace_id IN (SELECT id FROM workspaces WHERE boundary = ?)', boundary).changes);
    counts.tasks = Number(run(db, 'DELETE FROM tasks WHERE sample = 1 AND workspace_id IN (SELECT id FROM workspaces WHERE boundary = ?)', boundary).changes);
    counts.projects = Number(run(db, 'DELETE FROM projects WHERE sample = 1 AND workspace_id IN (SELECT id FROM workspaces WHERE boundary = ?) AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = projects.id AND t.sample = 0) AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.project_id = projects.id AND n.sample = 0)', boundary).changes);
    counts.captures = Number(run(db, 'DELETE FROM captures WHERE sample = 1 AND boundary = ?', boundary).changes);
    // Sample folders go only if they're now empty (no notes, no user-made sub-folders).
    run(db, `DELETE FROM folders WHERE sample = 1 AND workspace_id IN (SELECT id FROM workspaces WHERE boundary = ?)
      AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.folder_id = folders.id)
      AND NOT EXISTS (SELECT 1 FROM folders c WHERE c.parent_id = folders.id AND c.sample = 0)`, boundary);
    run(db, 'DELETE FROM tags WHERE boundary = ? AND id NOT IN (SELECT tag_id FROM note_tags)', boundary);
    run(db, "DELETE FROM activity WHERE boundary = ? AND entity_id NOT IN (SELECT id FROM notes UNION SELECT id FROM projects UNION SELECT id FROM tasks UNION SELECT id FROM captures)", boundary);
    return counts;
  });
}
