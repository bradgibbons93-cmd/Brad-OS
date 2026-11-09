import type { DB } from '../db.ts';
import { newId, tx } from '../db.ts';
import { all, get, run, notFound, requireWorkspace, logActivity, HttpError, type Scope } from './base.ts';
import { createNote } from './notes.ts';
import { createTask } from './projects.ts';

export interface Capture {
  id: string;
  boundary: string;
  workspace_id: string | null;
  workspace_name: string | null;
  workspace_color: string | null;
  body: string;
  url: string | null;
  tags: string;
  status: 'inbox' | 'archived' | 'converted';
  converted_type: string | null;
  converted_id: string | null;
  created_at: string;
}

const SELECT = `SELECT c.*, w.name AS workspace_name, w.color AS workspace_color
  FROM captures c LEFT JOIN workspaces w ON w.id = c.workspace_id`;

export function listCaptures(db: DB, scope: Scope, status: 'inbox' | 'archived' | 'converted' = 'inbox', limit = 200) {
  return all<Capture>(
    db,
    `${SELECT} WHERE c.boundary = ? AND c.status = ? ORDER BY c.created_at DESC LIMIT ?`,
    scope.boundary,
    status,
    Math.min(limit, 500),
  );
}

export function getCapture(db: DB, scope: Scope, id: string) {
  const c = get<Capture>(db, `${SELECT} WHERE c.id = ? AND c.boundary = ?`, id, scope.boundary);
  if (!c) throw notFound('Capture');
  return c;
}

const URL_RE = /\bhttps?:\/\/[^\s<>()]+/i;
const TAG_RE = /(?:^|\s)#([\p{L}\p{N}_-]{1,40})/gu;

/** Pull the first URL and any #hashtags out of free text so capture stays one-field fast. */
export function parseCapture(text: string) {
  const url = text.match(URL_RE)?.[0] ?? null;
  const tags = [...text.matchAll(TAG_RE)].map((m) => m[1].toLowerCase());
  return { url, tags: [...new Set(tags)] };
}

export function createCapture(db: DB, scope: Scope, input: { body: string; workspaceId?: string | null; url?: string | null; tags?: string[] }) {
  const body = (input.body ?? '').trim();
  if (!body) throw new HttpError(400, 'Capture is empty');
  if (body.length > 20000) throw new HttpError(400, 'Capture is too long (20k characters max)');
  if (input.workspaceId) requireWorkspace(db, scope, input.workspaceId);
  const parsed = parseCapture(body);
  const tags = [...new Set([...(input.tags ?? []), ...parsed.tags])].join(' ');
  const id = newId('cap');
  run(
    db,
    'INSERT INTO captures (id, boundary, workspace_id, body, url, tags) VALUES (?, ?, ?, ?, ?, ?)',
    id, scope.boundary, input.workspaceId ?? null, body, input.url ?? parsed.url, tags,
  );
  logActivity(db, scope, 'capture', id, 'captured', body.split('\n')[0]);
  return getCapture(db, scope, id);
}

export function updateCapture(db: DB, scope: Scope, id: string, input: { body?: string; workspaceId?: string | null; status?: 'inbox' | 'archived' }) {
  const c = getCapture(db, scope, id);
  if (input.workspaceId) requireWorkspace(db, scope, input.workspaceId);
  const body = input.body !== undefined ? input.body.trim() : c.body;
  if (!body) throw new HttpError(400, 'Capture is empty');
  const parsed = parseCapture(body);
  run(
    db,
    'UPDATE captures SET body = ?, url = ?, tags = ?, workspace_id = ?, status = ? WHERE id = ?',
    body,
    parsed.url,
    input.body !== undefined ? parsed.tags.join(' ') : c.tags,
    input.workspaceId !== undefined ? input.workspaceId : c.workspace_id,
    input.status ?? c.status,
    id,
  );
  if (input.status === 'archived') logActivity(db, scope, 'capture', id, 'archived', body.split('\n')[0]);
  return getCapture(db, scope, id);
}

export function deleteCapture(db: DB, scope: Scope, id: string) {
  getCapture(db, scope, id);
  run(db, 'DELETE FROM captures WHERE id = ?', id);
}

/**
 * Convert a capture into a note or task. The capture is kept (status = converted) with a
 * pointer to what it became, so nothing captured is ever silently lost.
 */
export function convertCapture(
  db: DB,
  scope: Scope,
  id: string,
  input: { to: 'note' | 'task'; workspaceId: string; projectId?: string | null; title?: string },
) {
  const c = getCapture(db, scope, id);
  if (c.status === 'converted') throw new HttpError(400, 'Already converted');
  requireWorkspace(db, scope, input.workspaceId);
  const firstLine = c.body.split('\n')[0].replace(URL_RE, '').replace(TAG_RE, '').trim();
  const title = (input.title ?? '').trim() || firstLine.slice(0, 120) || (c.url ?? 'Captured note');
  return tx(db, () => {
    let result: { type: 'note' | 'task'; id: string };
    if (input.to === 'note') {
      const note = createNote(db, scope, {
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        title,
        body: c.body,
        origin: c.url && c.body.trim() === c.url ? 'link' : 'native',
        sourceUrl: c.url,
        tags: c.tags.split(' ').filter(Boolean),
      });
      result = { type: 'note', id: note.id };
    } else {
      const task = createTask(db, scope, {
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        title,
        details: c.body === title ? '' : c.body,
      });
      result = { type: 'task', id: task.id };
    }
    run(db, "UPDATE captures SET status = 'converted', converted_type = ?, converted_id = ?, workspace_id = ? WHERE id = ?",
      result.type, result.id, input.workspaceId, id);
    return result;
  });
}
