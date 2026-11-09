import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare, FileText, FolderKanban, Home, Inbox, Library, Plus, Search, Settings, Zap } from 'lucide-react';
import { api, type SearchHit } from '../api';
import { useWorkspaces } from '../hooks';
import { Dialog, Kbd, Snippet, WsDot, useUI } from './ui';

interface Item {
  key: string;
  group: string;
  label: string;
  icon: typeof Home;
  hint?: React.ReactNode;
  color?: string | null;
  snippet?: string;
  run: () => void;
}

export function hitPath(h: Pick<SearchHit, 'type' | 'id'>) {
  if (h.type === 'note') return `/knowledge/${h.id}`;
  if (h.type === 'project') return `/projects/${h.id}`;
  if (h.type === 'task') return `/tasks?focus=${h.id}`;
  return `/inbox?focus=${h.id}`;
}

const TYPE_ICON = { note: FileText, project: FolderKanban, task: CheckSquare, capture: Inbox };

export function CommandPalette() {
  const ui = useUI();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { data: workspaces = [] } = useWorkspaces();
  const open = ui.palette.open;

  useEffect(() => {
    if (open) (setQ(''), setSel(0));
  }, [open]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 90);
    return () => clearTimeout(t);
  }, [q]);

  const { data: hits = [] } = useQuery({
    queryKey: ['search', debounced, 'palette'],
    queryFn: () => api.search(debounced, { limit: 12 }),
    enabled: open && debounced.length > 0,
    placeholderData: (prev) => prev,
  });

  const close = () => ui.palette.set(false);
  const go = (path: string) => (close(), nav(path));

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      { key: 'a-cap', group: 'Actions', label: 'Capture a thought', icon: Zap, hint: <Kbd>C</Kbd>, run: () => (close(), ui.capture.set(true)) },
      { key: 'a-note', group: 'Actions', label: 'New note', icon: Plus, hint: <Kbd>N</Kbd>, run: () => go('/knowledge/new') },
      { key: 'a-proj', group: 'Actions', label: 'New project', icon: FolderKanban, run: () => go('/projects?new=1') },
      { key: 'g-today', group: 'Go to', label: 'Today', icon: Home, hint: <Kbd>G T</Kbd>, run: () => go('/') },
      { key: 'g-inbox', group: 'Go to', label: 'Inbox', icon: Inbox, hint: <Kbd>G I</Kbd>, run: () => go('/inbox') },
      { key: 'g-kb', group: 'Go to', label: 'Knowledge', icon: Library, hint: <Kbd>G K</Kbd>, run: () => go('/knowledge') },
      { key: 'g-proj', group: 'Go to', label: 'Projects', icon: FolderKanban, hint: <Kbd>G P</Kbd>, run: () => go('/projects') },
      { key: 'g-set', group: 'Go to', label: 'Settings', icon: Settings, hint: <Kbd>G S</Kbd>, run: () => go('/settings') },
      ...workspaces.map((w) => ({
        key: `w-${w.id}`, group: 'Workspaces', label: w.name, icon: Library, color: w.color, run: () => go(`/knowledge?ws=${w.id}`),
      })),
    ];
    const needle = q.trim().toLowerCase();
    if (!needle) return actions;
    const filtered = actions.filter((a) => a.label.toLowerCase().includes(needle));
    const results: Item[] = hits.map((h) => ({
      key: `${h.type}-${h.id}`,
      group: 'Results',
      label: h.title || '(untitled)',
      icon: TYPE_ICON[h.type],
      color: h.workspace_color,
      snippet: h.snippet,
      hint: <span className="mono muted">{h.type}</span>,
      run: () => go(hitPath(h)),
    }));
    const all: Item = {
      key: 'search-all', group: 'Results', label: `Search everything for “${q.trim()}”`, icon: Search, run: () => go(`/search?q=${encodeURIComponent(q.trim())}`),
    };
    return [...results, all, ...filtered];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, hits, workspaces]);

  useEffect(() => setSel(0), [debounced]);
  useEffect(() => {
    listRef.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(s + 1, items.length - 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
    else if (e.key === 'Enter') (e.preventDefault(), items[sel]?.run());
  };

  let lastGroup = '';
  return (
    <Dialog open={open} onClose={close} className="palette">
      <div className="palette-input">
        <Search />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search notes, projects, tasks… or type a command"
          aria-label="Search"
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
        />
      </div>
      <div className="palette-list" ref={listRef} id="palette-list" role="listbox">
        {items.map((it, i) => {
          const header = it.group !== lastGroup ? ((lastGroup = it.group), <div key={`h-${it.group}`} className="palette-group eyebrow">{it.group}</div>) : null;
          const Icon = it.icon;
          return (
            <div key={it.key}>
              {header}
              <button
                className={`palette-item ${i === sel ? 'sel' : ''}`}
                role="option"
                aria-selected={i === sel}
                onMouseMove={() => setSel(i)}
                onClick={it.run}
              >
                {it.color ? <WsDot color={it.color} /> : <Icon />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="truncate">{it.label}</div>
                  {it.snippet && <div className="snip truncate"><Snippet text={it.snippet} /></div>}
                </div>
                {it.hint}
              </button>
            </div>
          );
        })}
        {q && !hits.length && debounced === q.trim() && <div className="card-empty">No matching records yet.</div>}
      </div>
      <div className="palette-foot">
        <span><Kbd>↑↓</Kbd> move</span>
        <span><Kbd>↵</Kbd> open</span>
        <span><Kbd>esc</Kbd> close</span>
      </div>
    </Dialog>
  );
}
