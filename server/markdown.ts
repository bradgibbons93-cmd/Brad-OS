/**
 * Markdown import/export with a small, predictable YAML-ish frontmatter.
 * Only flat `key: value` and `key: [a, b]` are supported — enough for round-tripping BRAD OS
 * metadata and for reading Obsidian-style notes, without pulling in a YAML dependency.
 */

export interface Frontmatter {
  [key: string]: string | string[];
}

export function parseMarkdown(text: string): { meta: Frontmatter; body: string } {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: src };
  const meta: Frontmatter = {};
  let listKey: string | null = null;
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      (meta[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (raw === '') {
      meta[key] = [];
      listKey = key;
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      meta[key] = raw.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
      listKey = null;
    } else {
      meta[key] = unquote(raw);
      listKey = null;
    }
  }
  return { meta, body: src.slice(m[0].length) };
}

const unquote = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2');

const quote = (s: string) => (/[:#\[\]{},"'\n]|^\s|\s$/.test(s) ? JSON.stringify(s) : s);

export function serializeMarkdown(meta: Record<string, string | string[] | null | undefined>, body: string) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) lines.push(`${k}: [${v.map(quote).join(', ')}]`);
    } else lines.push(`${k}: ${quote(v)}`);
  }
  lines.push('---', '');
  return lines.join('\n') + body.replace(/\s*$/, '\n');
}

export function safeFilename(name: string) {
  return (
    name
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'Untitled'
  );
}

/** First "# Heading" in the body, used as a title when frontmatter has none. */
export function titleFromBody(body: string): string | null {
  const h = body.match(/^#\s+(.+)$/m);
  return h ? h[1].trim() : null;
}
