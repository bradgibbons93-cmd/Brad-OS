import type { DB } from '../db.ts';
import { newId, now, tx } from '../db.ts';
import { all, get, run, notFound, requireWorkspace, logActivity, HttpError, type Scope, type Param } from './base.ts';

export const NOTE_KINDS = ['note', 'decision', 'research', 'meeting', 'reference', 'person', 'business'] as const;
export const ORIGINS = ['native', 'external', 'imported', 'link', 'ai'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export type Origin = (typeof ORIGINS)[number];

export interface NoteRow {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  project_id: string | null;
  title: string;
  body: string;
  kind: NoteKind;
  origin: Origin;
  source_url: string | null;
  source_label: string | null;
  favorite: number;
  sample: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  accessed_at: string | null;
}

export interface NoteSummary extends Omit<NoteRow, 'body'> {
  excerpt: string;
  workspace_name: string;
  workspace_color: string;
  tags: string[];
}

export interface NoteDetail extends NoteRow {
  workspace_name: string;
  workspace_color: string;
  folder_name: string | null;
  project_title: string | null;
  tags: string[];
}

const SUMMARY_COLS = `n.id, n.workspace_id, n.folder_id, n.project_id, n.title, n.kind, n.origin, n.source_url, n.source_label,
  n.favorite, n.sample, n.deleted_at, n.created_at, n.updated_at, n.accessed_at,
  substr(n.body, 1, 280) AS excerpt, w.name AS workspace_name, w.color AS workspace_color,
  (SELECT group_concat(t.name, char(31)) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id) AS tag_list`;

type RawSummary = Omit<NoteSummary, 'tags'> & { tag_list: string | null };
const withTags = <T extends { tag_list: string | null }>(r: T) => {
  const { tag_list, ...rest } = r;
  return { ...rest, tags: tag_list ? tag_list.split('\x1f').sort() : [] };
};

export interface NoteFilters {
  workspaceId?: string;
  folderId?: string;
  projectId?: string;
  tag?: string;
  favorite?: boolean;
  trash?: boolean;
  sort?: 'updated' | 'created' | 'title' | 'accessed';
  limit?: number;
}

export function listNotes(db: DB, scope: Scope, f: NoteFilters = {}): NoteSummary[] {
  const where = ['w.boundary = ?', f.trash ? 'n.deleted_at IS NOT NULL' : 'n.deleted_at IS NULL'];
  const params: Param[] = [scope.boundary];
  if (f.workspaceId) (where.push('n.workspace_id = ?'), params.push(f.workspaceId));
  if (f.folderId) (where.push('n.folder_id = ?'), params.push(f.folderId));
  if (f.projectId) (where.push('n.project_id = ?'), params.push(f.projectId));
  if (f.favorite) where.push('n.favorite = 1');
  if (f.tag) {
    where.push('EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id AND t.name = ? AND t.boundary = ?)');
    params.push(f.tag, scope.boundary);
  }
  const order =
    f.sort === 'title' ? 'n.title COLLATE NOCASE ASC'
    : f.sort === 'created' ? 'n.created_at DESC'
    : f.sort === 'accessed' ? 'n.accessed_at IS NULL, n.accessed_at DESC'
    : 'n.updated_at DESC';
  const limit = Math.min(Math.max(f.limit ?? 500, 1), 1000);
  return all<RawSummary>(
    db,
    `SELECT ${SUMMARY_COLS} FROM notes n JOIN workspaces w ON w.id = n.workspace_id
     WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit}`,
    ...params,
  ).map(withTags);
}

export function getNote(db: DB, scope: Scope, id: string, opts: { touch?: boolean; includeDeleted?: boolean } = {}): NoteDetail {
  const row = get<NoteRow & { workspace_name: string; workspace_color: string; folder_name: string | null; project_title: string | null }>(
    db,
    `SELECT n.*, w.name AS workspace_name, w.color AS workspace_color, f.name AS folder_name, p.title AS project_title
     FROM notes n JOIN workspaces w ON w.id = n.workspace_id
     LEFT JOIN folders f ON f.id = n.folder_id LEFT JOIN projects p ON p.id = n.project_id
     WHERE n.id = ? AND w.boundary = ?`,
    id,
    scope.boundary,
  );
  if (!row || (row.deleted_at && !opts.includeDeleted)) throw notFound('Note');
  if (opts.touch) {
    // accessed_at is bookkeeping, not an edit: use a statement that doesn't bump updated_at.
    run(db, 'UPDATE notes SET accessed_at = ? WHERE id = ?', now(), id);
  }
  const tags = all<{ name: string }>(
    db,
    'SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY t.name',
    id,
  ).map((t) => t.name);
  return { ...row, tags };
}

export interface NoteInput {
  workspaceId?: string;
  folderId?: string | null;
  projectId?: string | null;
  title?: string;
  body?: string;
  kind?: NoteKind;
  origin?: Origin;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  favorite?: boolean;
  tags?: string[];
  sample?: boolean;
}

function checkLinks(db: DB, scope: Scope, workspaceId: string, folderId?: string | null, projectId?: string | null) {
  if (folderId) {
    const f = get<{ workspace_id: string }>(db, 'SELECT workspace_id FROM folders WHERE id = ?', folderId);
    if (!f || f.workspace_id !== workspaceId) throw new HttpError(400, 'Folder must belong to the same workspace');
  }
  if (projectId) {
    const p = get<{ id: string }>(
      db,
      'SELECT p.id FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE p.id = ? AND w.boundary = ?',
      projectId,
      scope.boundary,
    );
    if (!p) throw new HttpError(400, 'Project not found in this space');
  }
}

export function setNoteTags(db: DB, scope: Scope, noteId: string, names: string[]) {
  const clean = [...new Set(names.map((n) => n.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 30);
  run(db, 'DELETE FROM note_tags WHERE note_id = ?', noteId);
  for (const name of clean) {
    run(db, 'INSERT OR IGNORE INTO tags (id, boundary, name) VALUES (?, ?, ?)', newId('tag'), scope.boundary, name);
    const tag = get<{ id: string }>(db, 'SELECT id FROM tags WHERE boundary = ? AND name = ?', scope.boundary, name)!;
    run(db, 'INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)', noteId, tag.id);
  }
  // Drop orphaned tags so the tag list stays meaningful.
  run(db, 'DELETE FROM tags WHERE boundary = ? AND id NOT IN (SELECT tag_id FROM note_tags)', scope.boundary);
}

export function createNote(db: DB, scope: Scope, input: NoteInput): NoteDetail {
  if (!input.workspaceId) throw new HttpError(400, 'workspaceId is required');
  const ws = requireWorkspace(db, scope, input.workspaceId);
  checkLinks(db, scope, ws.id, input.folderId, input.projectId);
  const id = newId('note');
  const ts = now();
  tx(db, () => {
    run(
      db,
      `INSERT INTO notes (id, workspace_id, folder_id, project_id, title, body, kind, origin, source_url, source_label, favorite, sample, created_at, updated_at, accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, ws.id, input.folderId ?? null, input.projectId ?? null,
      (input.title ?? '').trim() || 'Untitled', input.body ?? '', input.kind ?? 'note', input.origin ?? 'native',
      input.sourceUrl ?? null, input.sourceLabel ?? null, input.favorite ? 1 : 0, input.sample ? 1 : 0, ts, ts, ts,
    );
    if (input.tags?.length) setNoteTags(db, scope, id, input.tags);
    logActivity(db, scope, 'note', id, 'created', (input.title ?? '').trim() || 'Untitled');
  });
  return getNote(db, scope, id);
}

export function updateNote(db: DB, scope: Scope, id: string, input: NoteInput): NoteDetail {
  const current = getNote(db, scope, id);
  const workspaceId = input.workspaceId ?? current.workspace_id;
  if (input.workspaceId && input.workspaceId !== current.workspace_id) requireWorkspace(db, scope, input.workspaceId);
  const folderId = input.folderId !== undefined ? input.folderId : workspaceId === current.workspace_id ? current.folder_id : null;
  const projectId = input.projectId !== undefined ? input.projectId : current.project_id;
  checkLinks(db, scope, workspaceId, folderId, projectId);
  const contentChanged = input.title !== undefined || input.body !== undefined;
  tx(db, () => {
    run(
      db,
      `UPDATE notes SET workspace_id = ?, folder_id = ?, project_id = ?, title = ?, body = ?, kind = ?, origin = ?,
         source_url = ?, source_label = ?, favorite = ?, updated_at = ? WHERE id = ?`,
      workspaceId, folderId, projectId,
      input.title !== undefined ? input.title.trim() || 'Untitled' : current.title,
      input.body ?? current.body,
      input.kind ?? current.kind,
      input.origin ?? current.origin,
      input.sourceUrl !== undefined ? input.sourceUrl : current.source_url,
      input.sourceLabel !== undefined ? input.sourceLabel : current.source_label,
      input.favorite !== undefined ? (input.favorite ? 1 : 0) : current.favorite,
      contentChanged || input.tags || input.workspaceId || input.folderId !== undefined ? now() : current.updated_at,
      id,
    );
    if (input.tags) setNoteTags(db, scope, id, input.tags);
    if (contentChanged) {
      // Collapse autosave bursts into a single "edited" activity entry per note per 10 minutes.
      const recent = get<{ id: number }>(
        db,
        `SELECT id FROM activity WHERE entity_type = 'note' AND entity_id = ? AND action = 'edited'
         AND at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')`,
        id,
      );
      if (!recent) logActivity(db, scope, 'note', id, 'edited', input.title ?? current.title);
    }
  });
  return getNote(db, scope, id);
}

export function trashNote(db: DB, scope: Scope, id: string) {
  const n = getNote(db, scope, id);
  run(db, 'UPDATE notes SET deleted_at = ? WHERE id = ?', now(), id);
  logActivity(db, scope, 'note', id, 'trashed', n.title);
}

export function restoreNote(db: DB, scope: Scope, id: string) {
  const n = getNote(db, scope, id, { includeDeleted: true });
  run(db, 'UPDATE notes SET deleted_at = NULL WHERE id = ?', id);
  logActivity(db, scope, 'note', id, 'restored', n.title);
  return getNote(db, scope, id);
}

export function purgeNote(db: DB, scope: Scope, id: string) {
  const n = getNote(db, scope, id, { includeDeleted: true });
  if (!n.deleted_at) throw new HttpError(400, 'Move the note to Trash before deleting it permanently');
  tx(db, () => {
    run(db, 'DELETE FROM notes WHERE id = ?', id);
    run(db, 'DELETE FROM tags WHERE boundary = ? AND id NOT IN (SELECT tag_id FROM note_tags)', scope.boundary);
  });
}

export function listTags(db: DB, scope: Scope) {
  return all<{ name: string; count: number }>(
    db,
    `SELECT t.name, COUNT(n.id) AS count FROM tags t
     JOIN note_tags nt ON nt.tag_id = t.id JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
     WHERE t.boundary = ? GROUP BY t.id ORDER BY count DESC, t.name`,
    scope.boundary,
  );
}

/** Resolve [[Wiki Links]] by title within the scope. Used by the editor preview. */
export function resolveTitles(db: DB, scope: Scope, titles: string[]) {
  const out: Record<string, string> = {};
  for (const t of titles.slice(0, 200)) {
    const r = get<{ id: string }>(
      db,
      `SELECT n.id FROM notes n JOIN workspaces w ON w.id = n.workspace_id
       WHERE w.boundary = ? AND n.deleted_at IS NULL AND n.title = ? COLLATE NOCASE ORDER BY n.updated_at DESC LIMIT 1`,
      scope.boundary,
      t,
    );
    if (r) out[t] = r.id;
  }
  return out;
}
