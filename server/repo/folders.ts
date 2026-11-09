import type { DB } from '../db.ts';
import { newId } from '../db.ts';
import { all, get, run, notFound, requireWorkspace, HttpError, type Scope } from './base.ts';

export interface Folder {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  sort: number;
  note_count: number;
}

export function listFolders(db: DB, scope: Scope): Folder[] {
  return all<Folder>(
    db,
    `SELECT f.*, (SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id AND n.deleted_at IS NULL) AS note_count
     FROM folders f JOIN workspaces w ON w.id = f.workspace_id WHERE w.boundary = ? ORDER BY f.sort, f.name COLLATE NOCASE`,
    scope.boundary,
  );
}

function requireFolder(db: DB, scope: Scope, id: string) {
  const f = get<Folder>(
    db,
    'SELECT f.* FROM folders f JOIN workspaces w ON w.id = f.workspace_id WHERE f.id = ? AND w.boundary = ?',
    id,
    scope.boundary,
  );
  if (!f) throw notFound('Folder');
  return f;
}

export function createFolder(db: DB, scope: Scope, input: { workspaceId: string; parentId?: string | null; name: string }) {
  const ws = requireWorkspace(db, scope, input.workspaceId);
  const name = input.name.trim();
  if (!name) throw new HttpError(400, 'Folder name is required');
  if (input.parentId) {
    const parent = requireFolder(db, scope, input.parentId);
    if (parent.workspace_id !== ws.id) throw new HttpError(400, 'Parent folder is in a different workspace');
  }
  const id = newId('fld');
  run(db, 'INSERT INTO folders (id, workspace_id, parent_id, name) VALUES (?, ?, ?, ?)', id, ws.id, input.parentId ?? null, name);
  return requireFolder(db, scope, id);
}

export function updateFolder(db: DB, scope: Scope, id: string, input: { name?: string; parentId?: string | null }) {
  const f = requireFolder(db, scope, id);
  let parentId = f.parent_id;
  if (input.parentId !== undefined) {
    parentId = input.parentId;
    if (parentId) {
      const parent = requireFolder(db, scope, parentId);
      if (parent.workspace_id !== f.workspace_id) throw new HttpError(400, 'Parent folder is in a different workspace');
      // Prevent cycles: walk up from the new parent.
      let cursor: string | null = parentId;
      while (cursor) {
        if (cursor === id) throw new HttpError(400, 'A folder cannot be moved inside itself');
        cursor = get<{ parent_id: string | null }>(db, 'SELECT parent_id FROM folders WHERE id = ?', cursor)?.parent_id ?? null;
      }
    }
  }
  const name = input.name !== undefined ? input.name.trim() : f.name;
  if (!name) throw new HttpError(400, 'Folder name is required');
  run(db, 'UPDATE folders SET name = ?, parent_id = ? WHERE id = ?', name, parentId, id);
  return requireFolder(db, scope, id);
}

/** Deleting a folder removes the folder (and sub-folders) only. Notes inside are kept and become unfiled. */
export function deleteFolder(db: DB, scope: Scope, id: string) {
  requireFolder(db, scope, id);
  run(db, 'DELETE FROM folders WHERE id = ?', id);
}
