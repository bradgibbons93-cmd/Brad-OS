import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArrowUpRight, CheckSquare, FileText, Inbox as InboxIcon, Link2, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { api, type Capture } from '../api';
import { rememberWorkspace, useDefaultWorkspace, useProjects, useRefresh, useWorkspaces } from '../hooks';
import { isTyping, timeAgo } from '../lib/format';
import { Dialog, Empty, Kbd, WsDot, useUI } from '../components/ui';

type Tab = 'inbox' | 'archived' | 'converted';

export function Inbox() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'inbox';
  const focusId = params.get('focus');
  const { data: items = [], isLoading } = useQuery({ queryKey: ['inbox', tab], queryFn: () => api.inbox(tab) });
  const [sel, setSel] = useState(0);
  const [converting, setConverting] = useState<{ cap: Capture; to: 'note' | 'task' } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = useRefresh();
  const ui = useUI();

  useEffect(() => {
    if (focusId) {
      const i = items.findIndex((c) => c.id === focusId);
      if (i >= 0) setSel(i);
    }
  }, [focusId, items]);
  useEffect(() => {
    document.getElementById(`cap-${items[sel]?.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [sel, items]);

  const archive = async (c: Capture) => {
    await api.updateCapture(c.id, { status: 'archived' });
    refresh();
    ui.toast('Archived', { action: { label: 'Undo', run: () => api.updateCapture(c.id, { status: 'inbox' }).then(() => refresh()) } });
  };
  const restore = async (c: Capture) => {
    await api.updateCapture(c.id, { status: 'inbox' });
    refresh();
  };
  const remove = async (c: Capture) => {
    if (!(await ui.confirm({ title: 'Delete this capture?', body: 'This permanently removes it. Archive instead if you might want it later.', confirm: 'Delete', danger: true }))) return;
    await api.deleteCapture(c.id);
    refresh();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || document.querySelector('.overlay') || tab !== 'inbox') return;
      const cur = items[sel];
      if (e.key === 'j' || e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(s + 1, items.length - 1)));
      else if (e.key === 'k' || e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
      else if (cur && e.key === 'e') (e.preventDefault(), archive(cur));
      else if (cur && e.key === 'Enter') (e.preventDefault(), setConverting({ cap: cur, to: 'note' }));
      else if (cur && e.key === 't') (e.preventDefault(), setConverting({ cap: cur, to: 'task' }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div className="row" style={{ padding: '18px 0 6px', alignItems: 'flex-end' }}>
        <div>
          <div className="eyebrow">Capture · review · organise</div>
          <h1 className="h1" style={{ marginTop: 8 }}>Inbox</h1>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => ui.capture.set(true)}>Capture <Kbd>C</Kbd></button>
      </div>
      <div className="tabs" style={{ marginTop: 14 }}>
        {(['inbox', 'archived', 'converted'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => (setParams({ tab: t }), setSel(0))}>
            {t === 'inbox' ? 'To review' : t === 'archived' ? 'Archived' : 'Converted'}
          </button>
        ))}
      </div>
      {tab === 'inbox' && items.length > 0 && (
        <p className="small muted" style={{ margin: '0 0 10px' }}>
          <Kbd>J</Kbd>/<Kbd>K</Kbd> move · <Kbd>↵</Kbd> make note · <Kbd>T</Kbd> make task · <Kbd>E</Kbd> archive
        </p>
      )}

      {isLoading ? <div className="muted">Loading…</div> : items.length === 0 ? (
        <Empty title={tab === 'inbox' ? 'Inbox zero' : 'Nothing here'}>
          {tab === 'inbox' ? <>Press <Kbd>C</Kbd> anywhere to capture a thought, idea or link.</> : 'Items you archive or convert will show up here.'}
        </Empty>
      ) : (
        <div className="stack" style={{ gap: 2 }}>
          {items.map((c, i) => (
            <div key={c.id} id={`cap-${c.id}`} className={`capture-item ${i === sel && tab === 'inbox' ? 'focus' : ''}`} onClick={() => setSel(i)}>
              <InboxIcon size={15} color="var(--faint)" style={{ marginTop: 4, flex: 'none' }} />
              <div className="body">
                {editing === c.id ? (
                  <EditCapture cap={c} onDone={() => (setEditing(null), refresh())} />
                ) : (
                  <>
                    <div>{c.body}</div>
                    {c.url && (
                      <a className="url" href={/^https?:/i.test(c.url) ? c.url : '#'} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                        <Link2 /> <span className="truncate">{c.url.replace(/^https?:\/\//, '')}</span>
                      </a>
                    )}
                    <div className="row small muted" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
                      <span className="mono" style={{ fontSize: 11 }}>{timeAgo(c.created_at)}</span>
                      {c.workspace_name && <span className="row" style={{ gap: 5 }}><WsDot color={c.workspace_color} /> {c.workspace_name}</span>}
                      {c.tags.split(' ').filter(Boolean).map((t) => <span key={t} className="chip tag">{t}</span>)}
                      {c.status === 'converted' && c.converted_id && (
                        <Link to={c.converted_type === 'note' ? `/knowledge/${c.converted_id}` : `/tasks?focus=${c.converted_id}`} className="chip on">
                          Became a {c.converted_type} <ArrowUpRight />
                        </Link>
                      )}
                    </div>
                  </>
                )}
              </div>
              {editing !== c.id && (
                <div className="actions">
                  {c.status === 'inbox' && (
                    <>
                      <button className="btn sm" onClick={() => setConverting({ cap: c, to: 'note' })} title="Make a note"><FileText /> Note</button>
                      <button className="btn sm" onClick={() => setConverting({ cap: c, to: 'task' })} title="Make a task"><CheckSquare /> Task</button>
                      <button className="btn ghost icon sm" onClick={() => setEditing(c.id)} aria-label="Edit"><Pencil /></button>
                      <button className="btn ghost icon sm" onClick={() => archive(c)} aria-label="Archive"><Archive /></button>
                    </>
                  )}
                  {c.status === 'archived' && <button className="btn sm" onClick={() => restore(c)}><RotateCcw /> Back to inbox</button>}
                  {c.status !== 'converted' && <button className="btn ghost icon sm danger" onClick={() => remove(c)} aria-label="Delete"><Trash2 /></button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {converting && <ConvertDialog cap={converting.cap} to={converting.to} onClose={() => setConverting(null)} />}
    </div>
  );
}

function EditCapture({ cap, onDone }: { cap: Capture; onDone: () => void }) {
  const [text, setText] = useState(cap.body);
  const save = async () => {
    if (text.trim() && text !== cap.body) await api.updateCapture(cap.id, { body: text });
    onDone();
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <textarea className="textarea" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
        if (e.key === 'Escape') onDone();
      }} />
      <div className="row"><button className="btn primary sm" onClick={save}>Save</button><button className="btn ghost sm" onClick={onDone}>Cancel</button></div>
    </div>
  );
}

function ConvertDialog({ cap, to, onClose }: { cap: Capture; to: 'note' | 'task'; onClose: () => void }) {
  const { data: workspaces = [] } = useWorkspaces();
  const { data: projects = [] } = useProjects();
  const defaultWs = useDefaultWorkspace();
  const [ws, setWs] = useState(cap.workspace_id ?? defaultWs);
  const [project, setProject] = useState('');
  const [title, setTitle] = useState(cap.body.split('\n')[0].replace(/https?:\/\/\S+/g, '').replace(/(^|\s)#[\w-]+/g, '').trim().slice(0, 120));
  const [busy, setBusy] = useState(false);
  const refresh = useRefresh();
  const ui = useUI();
  const nav = useNavigate();
  const wsId = ws || defaultWs;

  const submit = async (open: boolean) => {
    setBusy(true);
    try {
      const r = await api.convertCapture(cap.id, { to, workspaceId: wsId, projectId: project || null, title });
      rememberWorkspace(wsId);
      refresh();
      onClose();
      ui.toast(to === 'note' ? 'Note created' : 'Task created');
      if (open) nav(r.type === 'note' ? `/knowledge/${r.id}` : `/tasks?focus=${r.id}`);
    } catch (e) {
      ui.toast((e as Error).message, { tone: 'error' });
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} labelledBy="conv-title">
      <div className="dialog-head"><h2 className="h2" id="conv-title">Turn into a {to}</h2></div>
      <div className="dialog-body stack">
        <div className="field"><label>Title</label><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit(false)} /></div>
        <div className="grid2">
          <div className="field"><label>Workspace</label>
            <select className="select" value={wsId} onChange={(e) => (setWs(e.target.value), setProject(''))}>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Project (optional)</label>
            <select className="select" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">None</option>
              {projects.filter((p) => p.workspace_id === wsId && p.status !== 'done').map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>The original capture is kept under “Converted”, linked to what it became.</p>
      </div>
      <div className="dialog-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !wsId} onClick={() => submit(true)}>Create &amp; open</button>
        <button className="btn primary" disabled={busy || !wsId} onClick={() => submit(false)}>Create</button>
      </div>
    </Dialog>
  );
}
