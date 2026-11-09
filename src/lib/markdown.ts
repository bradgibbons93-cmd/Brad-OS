import { Marked, type TokenizerAndRendererExtension } from 'marked';
import DOMPurify from 'dompurify';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** [[Note title]] or [[Note title|label]] → internal link, resolved by title at click time. */
const wikiLink: TokenizerAndRendererExtension = {
  name: 'wikiLink',
  level: 'inline',
  start: (src) => src.indexOf('[['),
  tokenizer(src) {
    const m = /^\[\[([^\]|\n]{1,200})(?:\|([^\]\n]{1,200}))?\]\]/.exec(src);
    if (m) return { type: 'wikiLink', raw: m[0], title: m[1].trim(), label: (m[2] ?? m[1]).trim() };
    return undefined;
  },
  renderer(token) {
    const t = token as unknown as { title: string; label: string };
    return `<a href="#" class="wikilink" data-wiki="${escapeHtml(t.title)}">${escapeHtml(t.label)}</a>`;
  },
};

const md = new Marked({ gfm: true, breaks: false });
md.use({ extensions: [wikiLink] });
md.use({
  renderer: {
    link({ href, title, text }) {
      const safe = /^(https?:|mailto:|#|\/)/i.test(href) ? href : '#';
      const ext = /^https?:/i.test(safe);
      return `<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ''}${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`;
    },
  },
});

export function renderMarkdown(src: string): string {
  const html = md.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-wiki'] });
}

export function extractWikiTitles(src: string): string[] {
  return [...new Set([...src.matchAll(/\[\[([^\]|\n]{1,200})(?:\|[^\]\n]*)?\]\]/g)].map((m) => m[1].trim()))];
}

/** Plain-text preview for cards: strips markdown syntax. */
export function plainExcerpt(src: string, max = 160): string {
  return src
    .replace(/^---[\s\S]*?---\n?/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b ?? a)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+>]\s+/gm, '')
    .replace(/[*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
