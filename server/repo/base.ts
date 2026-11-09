import type { DB } from '../db.ts';
import type { SQLInputValue } from 'node:sqlite';

export type Boundary = 'work' | 'family';

/** The privacy scope every data access runs under. There is no "all boundaries" scope. */
export interface Scope {
  boundary: Boundary;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);

export type Param = SQLInputValue | undefined;
const clean = (params: Param[]) => params.map((p) => (p === undefined ? null : p)) as SQLInputValue[];

export function all<T>(db: DB, sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...clean(params)) as unknown as T[];
}
export function get<T>(db: DB, sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...clean(params)) as unknown as T | undefined;
}
export function run(db: DB, sql: string, ...params: Param[]) {
  return db.prepare(sql).run(...clean(params));
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  kind: 'business' | 'personal' | 'dev' | 'family';
  boundary: Boundary;
  color: string;
  sort: number;
}

/** Throws 404 (never 403) when the workspace exists but sits outside the scope — no existence leak. */
export function requireWorkspace(db: DB, scope: Scope, id: string): Workspace {
  const ws = get<Workspace>(db, 'SELECT * FROM workspaces WHERE id = ? AND boundary = ?', id, scope.boundary);
  if (!ws) throw notFound('Workspace');
  return ws;
}

export function listWorkspaces(db: DB, scope: Scope): Workspace[] {
  return all<Workspace>(db, 'SELECT * FROM workspaces WHERE boundary = ? ORDER BY sort, name', scope.boundary);
}

export function logActivity(
  db: DB,
  scope: Scope,
  entityType: string,
  entityId: string,
  action: string,
  title: string,
) {
  run(
    db,
    'INSERT INTO activity (boundary, entity_type, entity_id, action, title) VALUES (?, ?, ?, ?, ?)',
    scope.boundary,
    entityType,
    entityId,
    action,
    title.slice(0, 200),
  );
}
