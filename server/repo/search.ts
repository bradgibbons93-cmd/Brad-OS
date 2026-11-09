import type { DB } from '../db.ts';
import { all, type Scope, type Param } from './base.ts';

export interface SearchHit {
  type: 'note' | 'project' | 'task' | 'capture';
  id: string;
  title: string;
  snippet: string;
  workspace_id: string | null;
  workspace_name: string | null;
  workspace_color: string | null;
  origin: string | null;
  kind: string | null;
  updated_at: string | null;
  score: number;
}

/**
 * Turn free text into a safe FTS5 query: every term must match (AND), the last term is a
 * prefix so results appear as you type. Quotes are stripped so user input can't inject syntax.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .replace(/["*^():{}[\]\\]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[-+]+/, ''))
    .filter((t) => t.length > 0 && !['and', 'or', 'not', 'near'].includes(t))
    .slice(0, 12);
  if (!terms.length) return null;
  return terms.map((t, i) => (i === terms.length - 1 ? `"${t}"*` : `"${t}"`)).join(' ');
}

export function search(
  db: DB,
  scope: Scope,
  q: string,
  opts: { types?: SearchHit['type'][]; workspaceId?: string; limit?: number } = {},
): SearchHit[] {
  const fts = toFtsQuery(q);
  if (!fts) return [];
  const where = ['search_index MATCH ?', 'si.boundary = ?'];
  const params: Param[] = [fts, scope.boundary];
  if (opts.types?.length) {
    where.push(`si.etype IN (${opts.types.map(() => '?').join(',')})`);
    params.push(...opts.types);
  }
  if (opts.workspaceId) (where.push('si.workspace_id = ?'), params.push(opts.workspaceId));
  const limit = Math.min(opts.limit ?? 30, 100);
  // Title matches weigh 4× body matches.
  return all<SearchHit>(
    db,
    `SELECT si.etype AS type, si.eid AS id,
       COALESCE(NULLIF(si.title, ''), substr(c.body, 1, 90)) AS title,
       snippet(search_index, 1, '\u0002', '\u0003', ' … ', 18) AS snippet,
       si.workspace_id, w.name AS workspace_name, w.color AS workspace_color,
       n.origin, n.kind, COALESCE(n.updated_at, p.updated_at, t.created_at, c.created_at) AS updated_at,
       bm25(search_index, 4.0, 1.0) AS score
     FROM search_index si
     LEFT JOIN workspaces w ON w.id = si.workspace_id
     LEFT JOIN notes n ON si.etype = 'note' AND n.id = si.eid
     LEFT JOIN projects p ON si.etype = 'project' AND p.id = si.eid
     LEFT JOIN tasks t ON si.etype = 'task' AND t.id = si.eid
     LEFT JOIN captures c ON si.etype = 'capture' AND c.id = si.eid
     WHERE ${where.join(' AND ')}
     ORDER BY score LIMIT ${limit}`,
    ...params,
  );
}
