import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare, FileText, FolderKanban, Inbox, Search as SearchIcon } from 'lucide-react';
import { api } from '../api';
import { useWorkspaces } from '../hooks';
import { timeAgo } from '../lib/format';
import { Empty, OriginBadge, Snippet, WsDot } from '../components/ui';
import { hitPath } from '../components/CommandPalette';

const TYPES = [
  ['', 'Everything'],
  ['note', 'Notes'],
  ['project', 'Projects'],
  ['task', 'Tasks'],
  ['capture', 'Inbox'],
] as const;
const ICON = { note: FileText, project: FolderKanban, task: CheckSquare, capture: Inbox };

export function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const ws = params.get('ws') ?? '';
  const [input, setInput] = useState(q);
  const { data: workspaces = [] } = useWorkspaces();

  useEffect(() => setInput(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => input !== q && setParams((p) => (input ? p.set('q', input) : p.delete('q'), p), { replace: true }), 200);
    return () => clearTimeout(t);
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ['search', q, type, ws],
    queryFn: () => api.search(q, { types: type || undefined, workspace: ws || undefined, limit: 100 }),
    enabled: !!q.trim(),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div style={{ padding: '18px 0 14px' }}>
        <div className="eyebrow">Full-text search</div>
        <h1 className="h1" style={{ marginTop: 8 }}>Search</h1>
      </div>
      <div className="capture-hero" style={{ marginBottom: 14 }}>
        <SearchIcon size={18} color="var(--muted)" style={{ marginTop: 7 }} />
        <textarea rows={1} autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search titles and content…" aria-label="Search" onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} />
      </div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {TYPES.map(([k, v]) => (
          <button key={k} className={`chip ${type === k ? 'on' : ''}`} onClick={() => setParams((p) => (k ? p.set('type', k) : p.delete('type'), p))}>{v}</button>
        ))}
        <span className="spacer" />
        <select className="select" style={{ width: 'auto', fontSize: 12.5 }} value={ws} onChange={(e) => setParams((p) => (e.target.value ? p.set('ws', e.target.value) : p.delete('ws'), p))} aria-label="Workspace">
          <option value="">All workspaces</option>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      {!q.trim() ? (
        <Empty title="Search everything in this space">Matches titles first, then content. Every word must match; the last word matches as you type.</Empty>
      ) : hits.length === 0 && !isFetching ? (
        <Empty title="No matches">Try fewer or different words.</Empty>
      ) : (
        <div className="card">
          <div className="card-head small muted mono">{hits.length} result{hits.length === 1 ? '' : 's'}</div>
          {hits.map((h) => {
            const Icon = ICON[h.type];
            return (
              <Link key={`${h.type}-${h.id}`} to={hitPath(h)} className="hit">
                <div className="row" style={{ gap: 8 }}>
                  <Icon size={14} color="var(--muted)" />
                  <span style={{ fontWeight: 500 }} className="truncate">{h.title || '(untitled)'}</span>
                  {h.origin && <OriginBadge origin={h.origin} />}
                  <span className="spacer" />
                  {h.workspace_name && <span className="row small muted" style={{ gap: 5 }}><WsDot color={h.workspace_color} /> {h.workspace_name}</span>}
                  <span className="mono muted" style={{ fontSize: 11 }}>{timeAgo(h.updated_at)}</span>
                </div>
                {h.snippet && <div className="snippet"><Snippet text={h.snippet} /></div>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
