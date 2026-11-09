import type { DB } from '../db.ts';
import { all, get, type Scope } from './base.ts';
import { listNotes } from './notes.ts';
import { listProjects, listTasks } from './projects.ts';
import { listCaptures } from './inbox.ts';

export function today(db: DB, scope: Scope) {
  const b = scope.boundary;
  const counts = get<{ notes: number; projects: number; open_tasks: number; inbox: number; overdue: number }>(
    db,
    `SELECT
      (SELECT COUNT(*) FROM notes n JOIN workspaces w ON w.id = n.workspace_id WHERE w.boundary = ? AND n.deleted_at IS NULL) AS notes,
      (SELECT COUNT(*) FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE w.boundary = ? AND p.status IN ('active','planning')) AS projects,
      (SELECT COUNT(*) FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE w.boundary = ? AND t.status <> 'done') AS open_tasks,
      (SELECT COUNT(*) FROM captures c WHERE c.boundary = ? AND c.status = 'inbox') AS inbox,
      (SELECT COUNT(*) FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
         WHERE w.boundary = ? AND t.status <> 'done' AND t.due_date IS NOT NULL AND t.due_date < date('now')) AS overdue`,
    b, b, b, b, b,
  )!;

  const upcoming = listTasks(db, scope, { limit: 40 })
    .filter((t) => t.due_date || t.status === 'doing' || t.priority > 0)
    .slice(0, 8);

  return {
    counts,
    recentNotes: listNotes(db, scope, { sort: 'updated', limit: 6 }),
    recentlyOpened: listNotes(db, scope, { sort: 'accessed', limit: 6 }).filter((n) => n.accessed_at),
    favorites: listNotes(db, scope, { favorite: true, sort: 'updated', limit: 6 }),
    activeProjects: listProjects(db, scope).filter((p) => p.status === 'active').slice(0, 6),
    upcomingTasks: upcoming,
    inbox: listCaptures(db, scope, 'inbox', 5),
    activity: all<{ id: number; entity_type: string; entity_id: string; action: string; title: string; at: string }>(
      db,
      'SELECT id, entity_type, entity_id, action, title, at FROM activity WHERE boundary = ? ORDER BY id DESC LIMIT 12',
      b,
    ),
  };
}
