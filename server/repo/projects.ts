import type { DB } from '../db.ts';
import { newId, now, tx } from '../db.ts';
import { all, get, run, notFound, requireWorkspace, logActivity, HttpError, type Scope, type Param } from './base.ts';
import { listNotes } from './notes.ts';

export const PROJECT_STATUSES = ['planning', 'active', 'paused', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Project {
  id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_color: string;
  title: string;
  summary: string;
  status: ProjectStatus;
  next_action: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  open_tasks: number;
  done_tasks: number;
  note_count: number;
}

export interface Task {
  id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_color: string;
  project_id: string | null;
  project_title: string | null;
  title: string;
  details: string;
  status: TaskStatus;
  priority: number;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
}

const PROJECT_SELECT = `SELECT p.*, w.name AS workspace_name, w.color AS workspace_color,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status <> 'done') AS open_tasks,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_tasks,
  (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id AND n.deleted_at IS NULL) AS note_count
  FROM projects p JOIN workspaces w ON w.id = p.workspace_id`;

export function listProjects(db: DB, scope: Scope, f: { workspaceId?: string; status?: string } = {}): Project[] {
  const where = ['w.boundary = ?'];
  const params: Param[] = [scope.boundary];
  if (f.workspaceId) (where.push('p.workspace_id = ?'), params.push(f.workspaceId));
  if (f.status) (where.push('p.status = ?'), params.push(f.status));
  return all<Project>(
    db,
    `${PROJECT_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END, p.updated_at DESC`,
    ...params,
  );
}

export function getProject(db: DB, scope: Scope, id: string): Project {
  const p = get<Project>(db, `${PROJECT_SELECT} WHERE p.id = ? AND w.boundary = ?`, id, scope.boundary);
  if (!p) throw notFound('Project');
  return p;
}

export function getProjectDetail(db: DB, scope: Scope, id: string) {
  const project = getProject(db, scope, id);
  return {
    project,
    tasks: listTasks(db, scope, { projectId: id, includeDone: true }),
    notes: listNotes(db, scope, { projectId: id }),
    activity: all<{ action: string; title: string; at: string; entity_type: string; entity_id: string }>(
      db,
      `SELECT a.action, a.title, a.at, a.entity_type, a.entity_id FROM activity a
       WHERE a.boundary = ? AND (
         (a.entity_type = 'project' AND a.entity_id = ?)
         OR (a.entity_type = 'task' AND a.entity_id IN (SELECT id FROM tasks WHERE project_id = ?))
         OR (a.entity_type = 'note' AND a.entity_id IN (SELECT id FROM notes WHERE project_id = ?))
       ) ORDER BY a.id DESC LIMIT 20`,
      scope.boundary, id, id, id,
    ),
  };
}

export interface ProjectInput {
  workspaceId?: string;
  title?: string;
  summary?: string;
  status?: ProjectStatus;
  nextAction?: string;
  dueDate?: string | null;
}

export function createProject(db: DB, scope: Scope, input: ProjectInput) {
  if (!input.workspaceId) throw new HttpError(400, 'workspaceId is required');
  const ws = requireWorkspace(db, scope, input.workspaceId);
  const title = (input.title ?? '').trim();
  if (!title) throw new HttpError(400, 'Project title is required');
  const id = newId('prj');
  tx(db, () => {
    run(
      db,
      'INSERT INTO projects (id, workspace_id, title, summary, status, next_action, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, ws.id, title, input.summary ?? '', input.status ?? 'active', input.nextAction ?? '', input.dueDate ?? null,
    );
    logActivity(db, scope, 'project', id, 'created', title);
  });
  return getProject(db, scope, id);
}

export function updateProject(db: DB, scope: Scope, id: string, input: ProjectInput) {
  const p = getProject(db, scope, id);
  if (input.workspaceId && input.workspaceId !== p.workspace_id) requireWorkspace(db, scope, input.workspaceId);
  const title = input.title !== undefined ? input.title.trim() : p.title;
  if (!title) throw new HttpError(400, 'Project title is required');
  tx(db, () => {
    const ws = input.workspaceId ?? p.workspace_id;
    run(
      db,
      'UPDATE projects SET workspace_id = ?, title = ?, summary = ?, status = ?, next_action = ?, due_date = ?, updated_at = ? WHERE id = ?',
      ws, title, input.summary ?? p.summary, input.status ?? p.status,
      input.nextAction ?? p.next_action, input.dueDate !== undefined ? input.dueDate : p.due_date, now(), id,
    );
    // Tasks follow their project (the guard allows this because the project already moved).
    if (ws !== p.workspace_id) run(db, 'UPDATE tasks SET workspace_id = ? WHERE project_id = ?', ws, id);
    if (input.status && input.status !== p.status) logActivity(db, scope, 'project', id, `status → ${input.status}`, title);
    else logActivity(db, scope, 'project', id, 'updated', title);
  });
  return getProject(db, scope, id);
}

/** Deletes the project and its tasks. Notes linked to it are kept (unlinked), never deleted. */
export function deleteProject(db: DB, scope: Scope, id: string) {
  const p = getProject(db, scope, id);
  tx(db, () => {
    run(db, 'DELETE FROM projects WHERE id = ?', id);
    logActivity(db, scope, 'project', id, 'deleted', p.title);
  });
}

// ── Tasks ──────────────────────────────────────────────────────

const TASK_SELECT = `SELECT t.*, w.name AS workspace_name, w.color AS workspace_color, p.title AS project_title
  FROM tasks t JOIN workspaces w ON w.id = t.workspace_id LEFT JOIN projects p ON p.id = t.project_id`;

export function listTasks(
  db: DB,
  scope: Scope,
  f: { projectId?: string; workspaceId?: string; includeDone?: boolean; limit?: number } = {},
): Task[] {
  const where = ['w.boundary = ?'];
  const params: Param[] = [scope.boundary];
  if (f.projectId) (where.push('t.project_id = ?'), params.push(f.projectId));
  if (f.workspaceId) (where.push('t.workspace_id = ?'), params.push(f.workspaceId));
  if (!f.includeDone) where.push("t.status <> 'done'");
  const limit = Math.min(Math.max(f.limit ?? 500, 1), 1000);
  return all<Task>(
    db,
    `${TASK_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY t.status = 'done', t.due_date IS NULL, t.due_date, t.priority DESC, t.created_at DESC LIMIT ${limit}`,
    ...params,
  );
}

function getTask(db: DB, scope: Scope, id: string): Task {
  const t = get<Task>(db, `${TASK_SELECT} WHERE t.id = ? AND w.boundary = ?`, id, scope.boundary);
  if (!t) throw notFound('Task');
  return t;
}

export interface TaskInput {
  workspaceId?: string;
  projectId?: string | null;
  title?: string;
  details?: string;
  status?: TaskStatus;
  priority?: number;
  dueDate?: string | null;
}

export function createTask(db: DB, scope: Scope, input: TaskInput) {
  let workspaceId = input.workspaceId;
  if (input.projectId) {
    const p = getProject(db, scope, input.projectId);
    if (workspaceId && workspaceId !== p.workspace_id) throw new HttpError(400, 'Task must be in its project’s workspace');
    workspaceId = p.workspace_id;
  }
  if (!workspaceId) throw new HttpError(400, 'workspaceId or projectId is required');
  requireWorkspace(db, scope, workspaceId);
  const title = (input.title ?? '').trim();
  if (!title) throw new HttpError(400, 'Task title is required');
  const id = newId('tsk');
  tx(db, () => {
    run(
      db,
      'INSERT INTO tasks (id, workspace_id, project_id, title, details, status, priority, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, workspaceId, input.projectId ?? null, title, input.details ?? '', input.status ?? 'todo', input.priority ?? 0, input.dueDate ?? null,
    );
    logActivity(db, scope, 'task', id, 'created', title);
  });
  return getTask(db, scope, id);
}

export function updateTask(db: DB, scope: Scope, id: string, input: TaskInput) {
  const t = getTask(db, scope, id);
  let workspaceId = input.workspaceId ?? t.workspace_id;
  let projectId = input.projectId !== undefined ? input.projectId : t.project_id;
  if (projectId) workspaceId = getProject(db, scope, projectId).workspace_id;
  if (workspaceId !== t.workspace_id) requireWorkspace(db, scope, workspaceId);
  const title = input.title !== undefined ? input.title.trim() : t.title;
  if (!title) throw new HttpError(400, 'Task title is required');
  const status = input.status ?? t.status;
  const completedAt = status === 'done' ? (t.completed_at ?? now()) : null;
  tx(db, () => {
    run(
      db,
      'UPDATE tasks SET workspace_id = ?, project_id = ?, title = ?, details = ?, status = ?, priority = ?, due_date = ?, completed_at = ? WHERE id = ?',
      workspaceId, projectId, title, input.details ?? t.details, status, input.priority ?? t.priority,
      input.dueDate !== undefined ? input.dueDate : t.due_date, completedAt, id,
    );
    if (status !== t.status) logActivity(db, scope, 'task', id, status === 'done' ? 'completed' : `moved to ${status}`, title);
    if (projectId) run(db, 'UPDATE projects SET updated_at = ? WHERE id = ?', now(), projectId);
  });
  return getTask(db, scope, id);
}

export function deleteTask(db: DB, scope: Scope, id: string) {
  const t = getTask(db, scope, id);
  tx(db, () => {
    run(db, 'DELETE FROM tasks WHERE id = ?', id);
    logActivity(db, scope, 'task', id, 'deleted', t.title);
  });
}
