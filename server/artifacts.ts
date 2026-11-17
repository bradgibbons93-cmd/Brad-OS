import type { DB } from './db.ts';
import { tx } from './db.ts';

export function railwayArtifactUrl(raw: string, routes: Record<string, string> = {}): string {
  return raw.replace(/https?:\/\/(?:www\.)?claude\.ai\/artifact\/([A-Za-z0-9_-]+)/gi, (_match, id: string) =>
    routes[id] ?? `/hq/catalog?artifact=${encodeURIComponent(id)}`,
  ).replace(/https?:\/\/[^\s)<>"']*claudeusercontent\.com\/[^\s)<>"']*/gi, '/hq/catalog?source=claudeusercontent');
}

function rewriteJsonLinks(value: string | null, routes: Record<string, string>): string | null {
  if (!value) return value;
  try {
    const links = JSON.parse(value) as Array<{ label?: string; url?: string }>;
    if (!Array.isArray(links)) return railwayArtifactUrl(value, routes);
    return JSON.stringify(links.map((link) => ({ ...link, ...(link.url ? { url: railwayArtifactUrl(link.url, routes) } : {}) })));
  } catch {
    return railwayArtifactUrl(value, routes);
  }
}

/** Convert persisted artifact URLs into first-party Railway HQ destinations. */
export function rewriteLegacyArtifactLinks(db: DB, routes: Record<string, string> = {}) {
  tx(db, () => {
    for (const row of db.prepare('SELECT id, body, source_url FROM notes').all() as { id: string; body: string; source_url: string | null }[]) {
      const body = railwayArtifactUrl(row.body, routes);
      const sourceUrl = row.source_url ? railwayArtifactUrl(row.source_url, routes) : null;
      if (body !== row.body || sourceUrl !== row.source_url) db.prepare('UPDATE notes SET body = ?, source_url = ? WHERE id = ?').run(body, sourceUrl, row.id);
    }
    for (const [table, column] of [['projects', 'links'], ['tasks', 'links']] as const) {
      for (const row of db.prepare(`SELECT id, ${column} AS value FROM ${table}`).all() as { id: string; value: string | null }[]) {
        const value = rewriteJsonLinks(row.value, routes);
        if (value !== row.value) db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(value, row.id);
      }
    }
    for (const [table, column] of [
      ['captures', 'url'], ['waiting', 'url'], ['subscriptions', 'manage'], ['subscriptions', 'via'], ['subscriptions', 'evidence'],
    ] as const) {
      for (const row of db.prepare(`SELECT id, ${column} AS value FROM ${table}`).all() as { id: string; value: string | null }[]) {
        if (!row.value) continue;
        const value = railwayArtifactUrl(row.value, routes);
        if (value !== row.value) db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(value, row.id);
      }
    }
  });
}
