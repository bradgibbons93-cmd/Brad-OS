import { useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder as FolderIcon, FolderPlus, Hash, Library, PanelLeft, Pencil, Plus, Star, Trash2, Upload } from 'lucide-react';
import { api, type Folder, type Workspace } from '../api';
import { useFolders, useRefresh, useTags, useWorkspaces } from '../hooks';
import { timeAgo } from '../lib/format';
import { plainExcerpt } from '../lib/markdown';
import { Empty, OriginBadge, WsDot, useUI } from '../components/ui';
import { NoteEditor } from './NoteEditor';
import { ImportDialog } from '../components/ImportDialog';

export function Knowledge() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [showTree, setShowTree] = useState(false);
  const [importing, setImporting] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  // A new note keeps the same editor instance when it gets its real id, so typing is never interrupted.
  const editorKey = (loc.state as { keepEditor?: string } | null)?.keepEditor ?? (id === 'new' ? `new-${loc.key}` : id);
  const ws = params.get('ws') ?? '';
  const folder = params.get('folder') ?? '';
  const tag = params.get('tag') ?? '';
  const view = params.get('view') ?? '';
  const sort = params.get('sort') ?? 'updated';
  const { data: workspaces = [] } = useWorkspaces();
  const { data: folders = [] } = useFolders();

  const filters = { workspace: ws || undefined, folder: folder || undefined, tag: tag || undefined, favorite: view === 'fav', trash: view === 'trash', sort };
  const { data: notes = [], isLoading } = useQuery({ queryKey: ['notes', filters], queryFn: () => api.notes(filters) });

  const title =
    view === 'trash' ? 'Trash'
    : view === 'fav' ? 'Pinned'
    : tag ? `#${tag}`
    : folder ? folders.find((f) => f.id === folder)?.name ?? 'Folder'
    : ws ? workspaces.find((w) => w.id === ws)?.name ?? 'Workspace'
    : 'All notes';

  const qs = params.toString();
  const linkTo = (noteId: string) => `/knowledge/${noteId}${qs ? `?${qs}` : ''}`;
  const setFilter = (next: Record<string, string>) => {
    nav(`/knowledge?${new URLSearchParams(Object.entries(next).filter(([, v]) => v)).toString()}`);
    setShowTree(false);
  };

  return (
    <div className={`kb ${showTree ? 'show-tree' : ''} ${id ? 'has-note' : ''}`}>
      <aside className="kb-tree" aria-label="Folders and tags">
        <Tree workspaces={workspaces} folders={folders} active={{ ws, folder, tag, view }} onPick={setFilter} />
      </aside>

      <section className="kb-list" aria-label="Notes">
        <div className="kb-list-head">
          <div className="row">
            <button className="btn ghost icon sm" onClick={() => setShowTree((s) => !s)} aria-label="Toggle folders" title="Folders & tags">
              <PanelLeft size={15} />
            </button>
            <h1 className="h2 truncate" style={{ fontSize: 19 }}>{title}</h1>
            <span className="spacer" />
            {view !== 'trash' && (
              <>
                <button className="btn ghost icon sm" onClick={() => setImporting(true)} aria-label="Import Markdown" title="Import Markdown"><Upload size={15} /></button>
                <button className="btn sm" onClick={() => nav(`/knowledge/new${qs ? `?${qs}` : ''}`)}><Plus /> New</button>
              </>
            )}
          </div>
          <div className="row small muted" style={{ marginTop: 8 }}>
            <span className="mono">{notes.length} {notes.length === 1 ? 'note' : 'notes'}</span>
            <span className="spacer" />
            <select className="select" value={sort} onChange={(e) => setParams((p) => (p.set('sort', e.target.value), p))} style={{ width: 'auto', padding: '2px 24px 2px 6px', fontSize: 12 }} aria-label="Sort">
              <option value="updated">Last edited</option>
              <option value="accessed">Last opened</option>
              <option value="created">Created</option>
              <option value="title">Title</option>
            </select>
          </div>
        </div>
        {isLoading ? <div className="card-empty">Loading…</div> : notes.length === 0 ? (
          <div style={{ padding: 16 }}>
            <Empty title={view === 'trash' ? 'Trash is empty' : 'No notes here yet'}>
              {view === 'trash' ? 'Deleted notes wait here until you remove them for good.' : 'Press N to write one, or import Markdown files.'}
            </Empty>
          </div>
        ) : notes.map((n) => (
          <Link key={n.id} to={linkTo(n.id)} className={`note-card ${n.id === id ? 'active' : ''}`}>
            <div className="t">
              <span className="truncate" style={{ flex: 1 }}>{n.title}</span>
              {!!n.favorite && <Star size={12} color="var(--accent)" fill="var(--accent)" style={{ flex: 'none' }} />}
            </div>
            {n.excerpt && <div className="x">{plainExcerpt(n.excerpt)}</div>}
            <div className="m">
              <WsDot color={n.workspace_color} /> <span className="truncate" style={{ maxWidth: 120 }}>{n.workspace_name}</span>
              <span>·</span><span>{timeAgo(view === 'trash' ? n.deleted_at : n.updated_at)}</span>
              <OriginBadge origin={n.origin} />
              {!!n.sample && <span className="badge sample">Sample</span>}
              {n.tags.slice(0, 3).map((t) => <span key={t} className="chip tag">{t}</span>)}
            </div>
          </Link>
        ))}
      </section>

      <section className="kb-editor">
        {id ? <NoteEditor key={editorKey} editorKey={editorKey ?? ''} id={id} defaults={{ workspaceId: ws, folderId: folder, tag }} /> : (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24 }}>
            <div style={{ textAlign: 'center', maxWidth: 360 }} className="muted">
              <Library size={28} style={{ opacity: 0.4 }} />
              <p className="h2" style={{ color: 'var(--text)', margin: '12px 0 6px' }}>Pick a note, or start a new one</p>
              <p className="small">Write <code>[[Note title]]</code> to link notes together. Everything autosaves.</p>
            </div>
          </div>
        )}
      </section>
      {importing && <ImportDialog defaultWorkspace={ws} defaultFolder={folder} onClose={() => setImporting(false)} />}
    </div>
  );
}

function Tree({
  workspaces,
  folders,
  active,
  onPick,
}: {
  workspaces: Workspace[];
  folders: Folder[];
  active: { ws: string; folder: string; tag: string; view: string };
  onPick: (f: Record<string, string>) => void;
}) {
  const { data: tags = [] } = useTags();
  const ui = useUI();
  const refresh = useRefresh();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<{ ws: string; parent: string | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const children = useMemo(() => {
    const m = new Map<string, Folder[]>();
    for (const f of folders) {
      const k = f.parent_id ?? `ws:${f.workspace_id}`;
      m.set(k, [...(m.get(k) ?? []), f]);
    }
    return m;
  }, [folders]);

  const isOn = (o: Partial<typeof active>) =>
    (o.ws ?? '') === active.ws && (o.folder ?? '') === active.folder && (o.tag ?? '') === active.tag && (o.view ?? '') === active.view;

  const createFolder = async (name: string) => {
    if (!adding || !name.trim()) return setAdding(null);
    try {
      const f = await api.createFolder({ workspaceId: adding.ws, parentId: adding.parent, name });
      refresh();
      onPick({ ws: adding.ws, folder: f.id });
    } catch (e) {
      ui.toast((e as Error).message, { tone: 'error' });
    }
    setAdding(null);
  };

  const removeFolder = async (f: Folder) => {
    const ok = await ui.confirm({
      title: `Delete folder “${f.name}”?`,
      body: 'The folder and any sub-folders are removed. Notes inside are kept and become unfiled — nothing is deleted.',
      confirm: 'Delete folder',
      danger: true,
    });
    if (!ok) return;
    await api.deleteFolder(f.id);
    refresh();
    if (active.folder === f.id) onPick({ ws: f.workspace_id });
  };

  const renderFolders = (key: string, depth: number) =>
    (children.get(key) ?? []).map((f) => (
      <div key={f.id}>
        {renaming === f.id ? (
          <InlineName initial={f.name} depth={depth} onDone={async (name) => {
            setRenaming(null);
            if (name && name !== f.name) await api.updateFolder(f.id, { name }).then(() => refresh()).catch((e) => ui.toast(e.message, { tone: 'error' }));
          }} />
        ) : (
          <div className={`tree-item ${isOn({ ws: f.workspace_id, folder: f.id }) ? 'active' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} role="button" tabIndex={0}
            onClick={() => onPick({ ws: f.workspace_id, folder: f.id })} onKeyDown={(e) => e.key === 'Enter' && onPick({ ws: f.workspace_id, folder: f.id })}>
            <FolderIcon /> <span className="truncate">{f.name}</span>
            <span className="count">{f.note_count || ''}</span>
            <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
              <button className="btn ghost icon sm" title="New sub-folder" aria-label="New sub-folder" onClick={() => setAdding({ ws: f.workspace_id, parent: f.id })}><FolderPlus size={12} /></button>
              <button className="btn ghost icon sm" title="Rename" aria-label="Rename folder" onClick={() => setRenaming(f.id)}><Pencil size={12} /></button>
              <button className="btn ghost icon sm" title="Delete" aria-label="Delete folder" onClick={() => removeFolder(f)}><Trash2 size={12} /></button>
            </span>
          </div>
        )}
        {adding?.parent === f.id && <InlineName depth={depth + 1} onDone={createFolder} />}
        {renderFolders(f.id, depth + 1)}
      </div>
    ));

  return (
    <>
      <div className="tree-group">
        <button className={`tree-item ${isOn({}) ? 'active' : ''}`} onClick={() => onPick({})}><Library /> All notes</button>
        <button className={`tree-item ${isOn({ view: 'fav' }) ? 'active' : ''}`} onClick={() => onPick({ view: 'fav' })}><Star /> Pinned</button>
        <button className={`tree-item ${isOn({ view: 'trash' }) ? 'active' : ''}`} onClick={() => onPick({ view: 'trash' })}><Trash2 /> Trash</button>
      </div>
      <div className="tree-group">
        <div className="eyebrow">Workspaces</div>
        {workspaces.map((w) => (
          <div key={w.id}>
            <div className={`tree-item ${isOn({ ws: w.id }) ? 'active' : ''}`} role="button" tabIndex={0} onClick={() => onPick({ ws: w.id })} onKeyDown={(e) => e.key === 'Enter' && onPick({ ws: w.id })}>
              <span onClick={(e) => (e.stopPropagation(), setCollapsed((c) => ({ ...c, [w.id]: !c[w.id] })))} style={{ display: 'inline-flex', opacity: children.get(`ws:${w.id}`) ? 1 : 0.2 }}>
                <ChevronRight size={12} style={{ transform: collapsed[w.id] ? 'none' : 'rotate(90deg)', transition: 'transform .15s' }} />
              </span>
              <WsDot color={w.color} /> <span className="truncate">{w.name}</span>
              <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn ghost icon sm" title="New folder" aria-label={`New folder in ${w.name}`} onClick={() => setAdding({ ws: w.id, parent: null })}><FolderPlus size={12} /></button>
              </span>
            </div>
            {adding?.ws === w.id && adding.parent === null && <InlineName depth={1} onDone={createFolder} />}
            {!collapsed[w.id] && renderFolders(`ws:${w.id}`, 1)}
          </div>
        ))}
      </div>
      {tags.length > 0 && (
        <div className="tree-group">
          <div className="eyebrow">Tags</div>
          {tags.map((t) => (
            <button key={t.name} className={`tree-item ${isOn({ tag: t.name }) ? 'active' : ''}`} onClick={() => onPick({ tag: t.name })}>
              <Hash /> <span className="truncate">{t.name}</span> <span className="count">{t.count}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function InlineName({ initial = '', depth, onDone: done }: { initial?: string; depth: number; onDone: (name: string) => void }) {
  const [v, setV] = useState(initial);
  const fired = useRef(false);
  const onDone = (name: string) => {
    if (fired.current) return;
    fired.current = true;
    done(name);
  };
  return (
    <div style={{ paddingLeft: 8 + depth * 14, paddingRight: 4, margin: '2px 0' }}>
      <input className="input" autoFocus value={v} placeholder="Folder name" onChange={(e) => setV(e.target.value)} onBlur={() => onDone(v.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onDone(v.trim());
          if (e.key === 'Escape') onDone('');
        }}
        style={{ padding: '3px 8px', fontSize: 13 }} aria-label="Folder name" />
    </div>
  );
}
