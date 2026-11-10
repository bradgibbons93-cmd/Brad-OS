import type { DB } from '../db.ts';
import { newId, now, tx } from '../db.ts';
import { all, get, run, notFound, logActivity, type Scope } from './base.ts';
import { createProject, createTask, listProjects, type ProjectStatus } from './projects.ts';
import { createNote } from './notes.ts';

// ── Subscriptions ──────────────────────────────────────────────
export interface Sub {
  id: string; name: string; grp: string; plan: string; amount: number | null; cycle: string; renews: string | null;
  status: string; suggest: string; decision: string; note: string; manage: string; via: string; evidence: string | null;
}
export const listSubs = (db: DB, scope: Scope) =>
  all<Sub>(db, `SELECT * FROM subscriptions WHERE boundary = ? ORDER BY CASE status WHEN 'payment_failing' THEN 0 WHEN 'expiring' THEN 1 WHEN 'active' THEN 2 ELSE 3 END, renews IS NULL, renews, name`, scope.boundary);

export function updateSub(db: DB, scope: Scope, id: string, input: { decision?: string; status?: string }) {
  const s = get<Sub>(db, 'SELECT * FROM subscriptions WHERE id = ? AND boundary = ?', id, scope.boundary);
  if (!s) throw notFound('Subscription');
  run(db, 'UPDATE subscriptions SET decision = ?, status = ?, updated_at = ? WHERE id = ?', input.decision ?? s.decision, input.status ?? s.status, now(), id);
  return get<Sub>(db, 'SELECT * FROM subscriptions WHERE id = ?', id)!;
}

// ── Waiting on you (emails / messages that need a reply) ───────
export interface Waiting { id: string; category: string; from_name: string; subject: string; why: string; next: string; url: string | null; date: string | null; source: string; status: string }
export const listWaiting = (db: DB, scope: Scope, status = 'open') =>
  all<Waiting>(db, 'SELECT * FROM waiting WHERE boundary = ? AND status = ? ORDER BY date DESC, created_at DESC LIMIT 100', scope.boundary, status);

export function setWaitingStatus(db: DB, scope: Scope, id: string, status: 'open' | 'done') {
  const w = get<Waiting>(db, 'SELECT * FROM waiting WHERE id = ? AND boundary = ?', id, scope.boundary);
  if (!w) throw notFound('Item');
  run(db, 'UPDATE waiting SET status = ? WHERE id = ?', status, id);
}

export interface WaitingInput { category?: string; from?: string; subject?: string; why?: string; next?: string; url?: string | null; date?: string | null; source?: string }

/** Upsert by URL (or subject+from). A scheduled check can call this repeatedly without duplicating. */
export function addWaiting(db: DB, scope: Scope, items: WaitingInput[]) {
  let added = 0;
  for (const it of items.slice(0, 100)) {
    const subject = (it.subject ?? '').slice(0, 300);
    const existing = it.url
      ? get<{ id: string }>(db, 'SELECT id FROM waiting WHERE boundary = ? AND url = ?', scope.boundary, it.url)
      : get<{ id: string }>(db, 'SELECT id FROM waiting WHERE boundary = ? AND subject = ? AND from_name = ?', scope.boundary, subject, it.from ?? '');
    if (existing) {
      run(db, 'UPDATE waiting SET why = ?, next = ?, category = ? WHERE id = ?', (it.why ?? '').slice(0, 1000), (it.next ?? '').slice(0, 1000), it.category ?? 'other', existing.id);
      continue;
    }
    run(db, 'INSERT INTO waiting (id, boundary, category, from_name, subject, why, next, url, date, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId('wt'), scope.boundary, (it.category ?? 'other').slice(0, 30), (it.from ?? '').slice(0, 200), subject,
      (it.why ?? '').slice(0, 1000), (it.next ?? '').slice(0, 1000), it.url ?? null, it.date ?? null, (it.source ?? 'gmail').slice(0, 30));
    added++;
  }
  return { added };
}

// ── One-time import from Brad's Master HQ (Claude artifact database) ──
const HQ_WS: Record<string, string> = {
  runnit: 'ws_runnit', softr: 'ws_softr', agency: 'ws_cel-x-digital', encap: 'ws_cel-x-digital', five8: 'ws_cel-x-digital',
  hq: 'ws_personal', money: 'ws_personal', crew: 'ws_gibbons-crew',
};
export interface HqProject { key: string; title: string; status: string; what: string; clients: string[]; next: string; links: { label: string; url: string }[] }
export interface HqTask { id: string; title: string; project: string; pri?: string; done?: boolean; needs?: boolean; tool?: string; how?: string; links?: { label: string; url: string }[]; added?: string; doneAt?: string }

/**
 * Idempotent: every imported row carries ext_id = "hq:<id>"; re-running updates nothing that exists.
 * Duplicate task titles keep the newest and mark the older one done ("cancel the oldest").
 * Only rows whose workspace sits in the current boundary are imported.
 */
export function importHq(db: DB, scope: Scope, input: { projects?: HqProject[]; tasks?: HqTask[]; subs?: Record<string, unknown>[]; inbox?: WaitingInput[] }) {
  const inScope = (key: string) => {
    const ws = HQ_WS[key];
    return ws && get(db, 'SELECT 1 FROM workspaces WHERE id = ? AND boundary = ?', ws, scope.boundary) ? ws : null;
  };
  const counts = { projects: 0, tasks: 0, subs: 0, waiting: 0, duplicatesClosed: 0 };
  return tx(db, () => {
    const projByKey = new Map<string, string>();
    for (const p of input.projects ?? []) {
      const ws = inScope(p.key);
      if (!ws) continue;
      const ext = `hq:proj:${p.key}`;
      const ex = get<{ id: string }>(db, 'SELECT id FROM projects WHERE ext_id = ?', ext);
      if (ex) { projByKey.set(p.key, ex.id); continue; }
      const created = createProject(db, scope, {
        workspaceId: ws, title: p.title, summary: p.what, nextAction: p.next, status: 'active' as ProjectStatus,
        links: p.links, people: p.clients, statusLabel: p.status,
      });
      run(db, 'UPDATE projects SET ext_id = ? WHERE id = ?', ext, created.id);
      projByKey.set(p.key, created.id);
      counts.projects++;
    }
    // Fall back to an existing project in that workspace for task keys without a card (hq, money).
    const extraProj = (key: string, ws: string) => {
      if (projByKey.has(key)) return projByKey.get(key)!;
      const title = key === 'money' ? 'Money & subscriptions' : key === 'hq' ? 'HQ housekeeping' : key;
      const found = listProjects(db, scope).find((p) => p.title === title);
      const id = found?.id ?? createProject(db, scope, { workspaceId: ws, title, status: 'active' }).id;
      projByKey.set(key, id);
      return id;
    };
    const PRI: Record<string, number> = { now: 2, next: 1, later: 0 };
    for (const t of input.tasks ?? []) {
      const ws = inScope(t.project);
      if (!ws) continue;
      const ext = `hq:${t.id}`;
      if (get(db, 'SELECT 1 FROM tasks WHERE ext_id = ?', ext)) continue;
      const created = createTask(db, scope, {
        projectId: extraProj(t.project, ws), title: t.title, details: t.how ?? '', priority: PRI[t.pri ?? 'next'] ?? 1,
        status: t.done ? 'done' : 'todo', links: t.links ?? [], tool: t.tool ?? '', needsMe: !!t.needs,
      });
      run(db, 'UPDATE tasks SET ext_id = ?, created_at = COALESCE(?, created_at) WHERE id = ?', ext, t.added ? new Date(t.added).toISOString() : null, created.id);
      counts.tasks++;
    }
    // Duplicates: same title, still open → keep the newest, close the older ones.
    const dups = all<{ title: string }>(db,
      `SELECT lower(trim(t.title)) AS title FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
       WHERE w.boundary = ? AND t.status <> 'done' GROUP BY lower(trim(t.title)) HAVING COUNT(*) > 1`, scope.boundary);
    for (const d of dups) {
      const rows = all<{ id: string; title: string }>(db,
        `SELECT t.id, t.title FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
         WHERE w.boundary = ? AND t.status <> 'done' AND lower(trim(t.title)) = ? ORDER BY t.created_at DESC`, scope.boundary, d.title);
      for (const old of rows.slice(1)) {
        run(db, "UPDATE tasks SET status = 'done', completed_at = ?, details = details || ? WHERE id = ?", now(), '\n\n(Closed automatically: duplicate of a newer task.)', old.id);
        logActivity(db, scope, 'task', old.id, 'closed duplicate', old.title);
        counts.duplicatesClosed++;
      }
    }
    if (scope.boundary === 'work') {
      for (const s of input.subs ?? []) {
        const id = `sub_${String(s.id ?? s.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
        if (get(db, 'SELECT 1 FROM subscriptions WHERE id = ?', id)) continue;
        const str = (k: string) => (typeof s[k] === 'string' ? (s[k] as string) : '');
        run(db, `INSERT INTO subscriptions (id, name, grp, plan, amount, cycle, renews, status, suggest, decision, note, manage, via, evidence)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id, str('name'), str('group'), str('plan'), typeof s.amount === 'number' ? s.amount : null, str('cycle'),
          str('renews') || null, str('status') || 'unknown', str('suggest'), str('decision'), str('note'), str('manage'), str('via'), str('evidence') || null);
        counts.subs++;
      }
      counts.waiting = addWaiting(db, scope, input.inbox ?? []).added;
      if (counts.projects || counts.tasks) {
        createNote(db, scope, {
          workspaceId: 'ws_personal', title: 'Imported from Master HQ', kind: 'reference', origin: 'imported',
          sourceUrl: 'https://claude.ai/artifact/Vz5x2Cj1YVjRB1fcQYhor7', sourceLabel: 'Claude artifact › Brad Master HQ',
          body: `Projects, tasks, subscriptions and the "Waiting on you" list were copied from Master HQ on ${new Date().toISOString().slice(0, 10)}.\n\nMaster HQ itself was not changed.`,
        });
      }
    }
    return counts;
  });
}
