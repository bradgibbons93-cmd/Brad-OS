import { timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import type { DB } from './db.ts';
import { get, run, type Scope } from './repo/base.ts';
import { createTask } from './repo/projects.ts';
import { createCapture } from './repo/inbox.ts';

/**
 * Write-only door for Yumi (the family app) into the FAMILY space of BRAD HQ.
 *
 *  - Lives outside /api so it needs no browser session; authenticated by its own bearer token.
 *  - Can only CREATE: events and to-dos become Family tasks, reward requests become Family inbox items.
 *  - Never reads anything back, and can never touch Work & Life (the scope is fixed to 'family').
 *  - Idempotent: each item carries an id ("yumi:event:123"); repeats are skipped.
 *  - Accepts only a fixed set of fields, so diaries, photos and anything else can't ride along.
 */
const SCOPE: Scope = { boundary: 'family' };
const KINDS = ['event', 'task', 'reward'] as const;
type Kind = (typeof KINDS)[number];
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export function mountIngest(app: Hono<any>, db: DB, token: string | undefined) {
  app.post('/ingest/family', async (c) => {
    if (!token) return c.json({ error: 'Ingest is not enabled' }, 503);
    const given = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json().catch(() => null);
    const items: unknown[] = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
    let added = 0;
    let skipped = 0;
    for (const raw of items) {
      const it = (raw ?? {}) as Record<string, unknown>;
      const id = clip(it.id, 120);
      const kind = KINDS.find((k) => k === it.kind) as Kind | undefined;
      const title = clip(it.title, 300);
      if (!id || !kind || !title) { skipped++; continue; }
      const ext = `yumi:${id}`;
      const exists = kind === 'reward'
        ? get(db, 'SELECT 1 FROM captures WHERE ext_id = ?', ext)
        : get(db, 'SELECT 1 FROM tasks WHERE ext_id = ?', ext);
      if (exists) { skipped++; continue; }
      const who = clip(it.who, 80);
      const at = clip(it.at, 40);
      const due = /^\d{4}-\d{2}-\d{2}$/.test(clip(it.due, 10)) ? clip(it.due, 10) : null;
      const details = [who && `From ${who} in Yumi`, at && `At ${at}`, clip(it.details, 2000)].filter(Boolean).join('\n');
      if (kind === 'reward') {
        const cap = createCapture(db, SCOPE, { body: `Reward request: ${title}${details ? `\n${details}` : ''}`, workspaceId: 'ws_family' });
        run(db, 'UPDATE captures SET ext_id = ? WHERE id = ?', ext, cap.id);
      } else {
        const t = createTask(db, SCOPE, { workspaceId: 'ws_family', title: kind === 'event' ? `📅 ${title}` : title, details, dueDate: due });
        run(db, 'UPDATE tasks SET ext_id = ? WHERE id = ?', ext, t.id);
      }
      added++;
    }
    return c.json({ added, skipped });
  });
}
