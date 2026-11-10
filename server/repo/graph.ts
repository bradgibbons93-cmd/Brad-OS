import type { DB } from '../db.ts';
import { all, type Scope } from './base.ts';
import { getNote } from './notes.ts';

const WIKI = /\[\[([^\]|\n]{1,200})(?:\|[^\]\n]*)?\]\]/g;
export const wikiTitles = (body: string) => [...new Set([...body.matchAll(WIKI)].map((m) => m[1].trim().toLowerCase()))];

interface Lite { id: string; title: string; kind: string; origin: string; workspace_id: string; workspace_name: string; workspace_color: string; updated_at: string }
const LITE = `n.id, n.title, n.kind, n.origin, n.workspace_id, w.name AS workspace_name, w.color AS workspace_color, n.updated_at`;

/** Notes in the same boundary that link to this note with [[Title]] or [[Title|label]]. */
export function backlinks(db: DB, scope: Scope, id: string): Lite[] {
  const n = getNote(db, scope, id);
  const t = n.title.toLowerCase();
  return all<Lite>(
    db,
    `SELECT ${LITE} FROM notes n JOIN workspaces w ON w.id = n.workspace_id
     WHERE w.boundary = ? AND n.deleted_at IS NULL AND n.id <> ?
       AND (instr(lower(n.body), ?) > 0 OR instr(lower(n.body), ?) > 0)
     ORDER BY n.updated_at DESC LIMIT 50`,
    scope.boundary, id, `[[${t}]]`, `[[${t}|`,
  );
}

/**
 * Related notes, explained: shared tags (3 each), same project (3), same folder (2),
 * linked either way (4), and title words that appear in the other note (1 each, max 3).
 */
export function related(db: DB, scope: Scope, id: string, limit = 8) {
  const n = getNote(db, scope, id);
  const words = [...new Set(n.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3))].slice(0, 6);
  const out = new Set(wikiTitles(n.body));
  const back = new Set(backlinks(db, scope, id).map((b) => b.id));
  const rows = all<Lite & { body: string; folder_id: string | null; project_id: string | null; tags: string | null }>(
    db,
    `SELECT ${LITE}, n.body, n.folder_id, n.project_id,
       (SELECT group_concat(t.name, char(31)) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id) AS tags
     FROM notes n JOIN workspaces w ON w.id = n.workspace_id
     WHERE w.boundary = ? AND n.deleted_at IS NULL AND n.id <> ?`,
    scope.boundary, id,
  );
  const myTags = new Set(n.tags);
  return rows
    .map(({ body, folder_id, project_id, tags, ...r }) => {
      const reasons: string[] = [];
      let score = 0;
      const shared = (tags ? tags.split('\x1f') : []).filter((t) => myTags.has(t));
      if (shared.length) (score += 3 * shared.length, reasons.push(shared.map((t) => `#${t}`).join(' ')));
      if (n.project_id && project_id === n.project_id) (score += 3, reasons.push('same project'));
      if (n.folder_id && folder_id === n.folder_id) (score += 2, reasons.push('same folder'));
      if (out.has(r.title.toLowerCase()) || back.has(r.id)) (score += 4, reasons.push('linked'));
      const hay = `${r.title} ${body}`.toLowerCase();
      const hits = words.filter((w) => hay.includes(w)).length;
      if (hits) (score += Math.min(hits, 3), reasons.push('similar words'));
      return { ...r, score, reasons };
    })
    .filter((r) => r.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export interface GraphNode { id: string; type: 'note' | 'project' | 'workspace' | 'tag'; label: string; kind?: string; color: string; workspace_id?: string }
export interface GraphEdge { source: string; target: string; type: 'link' | 'project' | 'workspace' | 'tag' }

/** The whole knowledge graph for one boundary. The client filters; nothing crosses boundaries. */
export function graph(db: DB, scope: Scope) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const ws = all<{ id: string; name: string; color: string }>(db, 'SELECT id, name, color FROM workspaces WHERE boundary = ?', scope.boundary);
  for (const w of ws) nodes.push({ id: w.id, type: 'workspace', label: w.name, color: w.color });
  const projects = all<{ id: string; title: string; workspace_id: string; color: string }>(
    db, `SELECT p.id, p.title, p.workspace_id, w.color FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE w.boundary = ?`, scope.boundary);
  for (const p of projects) {
    nodes.push({ id: p.id, type: 'project', label: p.title, color: p.color, workspace_id: p.workspace_id });
    edges.push({ source: p.id, target: p.workspace_id, type: 'workspace' });
  }
  const notes = all<{ id: string; title: string; body: string; kind: string; workspace_id: string; project_id: string | null; color: string }>(
    db, `SELECT n.id, n.title, n.body, n.kind, n.workspace_id, n.project_id, w.color FROM notes n JOIN workspaces w ON w.id = n.workspace_id
         WHERE w.boundary = ? AND n.deleted_at IS NULL`, scope.boundary);
  const byTitle = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));
  for (const n of notes) {
    nodes.push({ id: n.id, type: 'note', label: n.title, kind: n.kind, color: n.color, workspace_id: n.workspace_id });
    edges.push({ source: n.id, target: n.workspace_id, type: 'workspace' });
    if (n.project_id) edges.push({ source: n.id, target: n.project_id, type: 'project' });
    for (const t of wikiTitles(n.body)) {
      const target = byTitle.get(t);
      if (target && target !== n.id) edges.push({ source: n.id, target, type: 'link' });
    }
  }
  const tagRows = all<{ note_id: string; name: string }>(
    db, `SELECT nt.note_id, t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id JOIN notes n ON n.id = nt.note_id
         WHERE t.boundary = ? AND n.deleted_at IS NULL`, scope.boundary);
  const tagIds = new Set<string>();
  for (const r of tagRows) {
    const tid = `tag:${r.name}`;
    if (!tagIds.has(tid)) (tagIds.add(tid), nodes.push({ id: tid, type: 'tag', label: `#${r.name}`, color: '#847a6d' }));
    edges.push({ source: r.note_id, target: tid, type: 'tag' });
  }
  return { nodes, edges };
}
