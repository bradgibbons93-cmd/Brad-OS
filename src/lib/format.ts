const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: abs > 86400 * 300 ? 'numeric' : undefined });
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function dueLabel(date: string | null): { text: string; tone: 'overdue' | 'today' | 'soon' | 'later' } | null {
  if (!date) return null;
  const t = todayIso();
  const days = Math.round((new Date(date + 'T00:00:00').getTime() - new Date(t + 'T00:00:00').getTime()) / 86400_000);
  if (days < 0) return { text: days === -1 ? 'Yesterday' : `${-days}d overdue`, tone: 'overdue' };
  if (days === 0) return { text: 'Today', tone: 'today' };
  if (days === 1) return { text: 'Tomorrow', tone: 'soon' };
  if (days < 7) return { text: new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' }), tone: 'soon' };
  return { text: new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), tone: 'later' };
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export const longDate = (d = new Date()) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

export const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

export const ORIGIN_LABEL: Record<string, string> = {
  native: 'Native',
  external: 'Source',
  imported: 'Imported copy',
  link: 'Link',
  ai: 'AI',
};
export const ORIGIN_HINT: Record<string, string> = {
  native: 'Written in BRAD OS',
  external: 'Points to an original document that lives elsewhere',
  imported: 'A copy of an imported file. The original is untouched',
  link: 'A bookmark or web reference',
  ai: 'AI-generated summary or interpretation',
};
export const KIND_LABEL: Record<string, string> = {
  note: 'Note',
  decision: 'Decision',
  research: 'Research',
  meeting: 'Meeting',
  reference: 'Reference',
  person: 'Person',
  business: 'Business',
};
