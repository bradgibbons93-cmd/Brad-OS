import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookMarked, Download, MoreHorizontal, RotateCcw, Star, Trash2 } from 'lucide-react';
import { api, type NoteDetail, type NoteInput, type NoteKind, type Origin } from '../api';
import { rememberWorkspace, useDefaultWorkspace, useFolders, useProjects, useRefresh, useWorkspaces } from '../hooks';
import { KIND_LABEL, ORIGIN_HINT, ORIGIN_LABEL, timeAgo } from '../lib/format';
import { extractWikiTitles, renderMarkdown } from '../lib/markdown';
import { OriginBadge, useUI } from '../components/ui';
import { TagInput } from '../components/TagInput';

type Mode = 'write' | 'split' | 'read';
type Draft = Pick<NoteInput, 'title' | 'body' | 'workspaceId' | 'folderId' | 'projectId' | 'kind' | 'origin' | 'sourceUrl' | 'sourceLabel' | 'favorite' | 'tags'>;

const fromNote = (n: NoteDetail): Draft => ({
  title: n.title === 'Untitled' ? '' : n.title,
  body: n.body,
  workspaceId: n.workspace_id,
  folderId: n.folder_id,
  projectId: n.project_id,
  kind: n.kind,
  origin: n.origin,
  sourceUrl: n.source_url,
  sourceLabel: n.source_label,
  favorite: !!n.favorite,
  tags: n.tags,
});

export function NoteEditor({ id, editorKey, defaults }: { id: string; editorKey: string; defaults: { workspaceId: string; folderId: string; tag: string } }) {
  const isNew = id === 'new';
  const { data: note, error } = useQuery({
    queryKey: ['note', id],
    queryFn: () => api.note(id, true),
    enabled: !isNew,
    staleTime: Infinity,
    retry: false,
  });
  if (error) return <div className="editor"><p className="muted">This note doesn't exist in this space.</p><Link to="/knowledge" className="btn">Back to Knowledge</Link></div>;
  if (!isNew && !note) return <div className="editor muted">Loading…</div>;
  return <EditorInner note={note ?? null} defaults={defaults} editorKey={editorKey} />;
}

function EditorInner({ note, defaults, editorKey }: { note: NoteDetail | null; defaults: { workspaceId: string; folderId: string; tag: string }; editorKey: string }) {
  const defWs = useDefaultWorkspace();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const refresh = useRefresh();
  const ui = useUI();
  const { data: workspaces = [] } = useWorkspaces();
  const { data: folders = [] } = useFolders();
  const { data: projects = [] } = useProjects();

  const [draft, setDraft] = useState<Draft>(() =>
    note
      ? fromNote(note)
      : {
          title: '', body: '', workspaceId: defaults.workspaceId || defWs, folderId: defaults.folderId || null, projectId: params.get('project'),
          kind: 'note', origin: 'native', sourceUrl: null, sourceLabel: null, favorite: false, tags: defaults.tag ? [defaults.tag] : [],
        },
  );
  const [noteId, setNoteId] = useState<string | null>(note?.id ?? null);
  const [savedAt, setSavedAt] = useState<string | null>(note?.updated_at ?? null);
  const [status, setStatus] = useState<'idle' | 'dirty' | 'saving' | 'error'>('idle');
  const [mode, setMode] = useState<Mode>(() => {
    try { return (localStorage.getItem('bos:editorMode') as Mode) || 'write'; } catch { return 'write'; }
  });
  const [menu, setMenu] = useState(false);
  const deleted = !!note?.deleted_at;
  const pending = useRef<Partial<Draft>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const creating = useRef<Promise<string> | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { localStorage.setItem('bos:editorMode', mode); } catch { /* ignore */ }
  }, [mode]);

  // Workspaces may still be loading when a new note opens: adopt the default once it's known.
  useEffect(() => {
    if (!draft.workspaceId && defWs) setDraft((d) => ({ ...d, workspaceId: defWs }));
  }, [defWs, draft.workspaceId]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const changes = pending.current;
    if (!Object.keys(changes).length) return;
    pending.current = {};
    setStatus('saving');
    try {
      let saved: NoteDetail;
      if (!noteId) {
        // First keystroke on a new note creates it. Later saves wait on that create.
        if (!creating.current) {
          creating.current = api.createNote({ ...draft, ...changes, workspaceId: changes.workspaceId || draft.workspaceId || defWs, title: (changes.title ?? draft.title) || 'Untitled' }).then((n) => {
            setNoteId(n.id);
            rememberWorkspace(n.workspace_id);
            qc.setQueryData(['note', n.id], n);
            nav(`/knowledge/${n.id}${window.location.search}`, { replace: true, state: { keepEditor: editorKey } });
            return n.id;
          });
          saved = await creating.current.then((nid) => qc.getQueryData<NoteDetail>(['note', nid])!);
        } else {
          const nid = await creating.current;
          saved = await api.updateNote(nid, changes);
        }
      } else {
        saved = await api.updateNote(noteId, changes);
      }
      setSavedAt(saved.updated_at);
      setStatus((s) => (s === 'saving' && !Object.keys(pending.current).length ? 'idle' : s));
      refresh({ except: [`note:${saved.id}`] });
    } catch (e) {
      pending.current = { ...changes, ...pending.current };
      setStatus('error');
      ui.toast(`Not saved: ${(e as Error).message}`, { tone: 'error' });
    }
  }, [draft, noteId, nav, qc, refresh, ui, editorKey, defWs]);

  const change = (patch: Partial<Draft>, immediate = false) => {
    if (deleted) return;
    setDraft((d) => ({ ...d, ...patch }));
    pending.current = { ...pending.current, ...patch };
    setStatus('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), immediate ? 0 : 700);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Save on unmount / tab close so nothing typed is lost.
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) {
        flushRef.current();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', before);
    return () => {
      window.removeEventListener('beforeunload', before);
      flushRef.current();
    };
  }, []);

  const onBodyKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    const el = e.currentTarget;
    const wrap = (mark: string) => {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en, value } = el;
      const next = value.slice(0, s) + mark + value.slice(s, en) + mark + value.slice(en);
      change({ body: next });
      requestAnimationFrame(() => el.setSelectionRange(s + mark.length, en + mark.length));
    };
    if (mod && e.key === 'b') return wrap('**');
    if (mod && e.key === 'i') return wrap('_');
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, value } = el;
      change({ body: value.slice(0, s) + '  ' + value.slice(el.selectionEnd) });
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      // Continue Markdown lists.
      const { selectionStart: s, value } = el;
      const line = value.slice(value.lastIndexOf('\n', s - 1) + 1, s);
      const m = line.match(/^(\s*)([-*+]|\d+\.)(\s+\[[ x]\])?\s+(.*)$/);
      if (m) {
        e.preventDefault();
        if (!m[4]) {
          const start = s - line.length;
          change({ body: value.slice(0, start) + value.slice(s) });
          requestAnimationFrame(() => el.setSelectionRange(start, start));
          return;
        }
        const bullet = /\d+\./.test(m[2]) ? `${parseInt(m[2]) + 1}.` : m[2];
        const ins = `\n${m[1]}${bullet}${m[3] ? ' [ ]' : ''} `;
        change({ body: value.slice(0, s) + ins + value.slice(el.selectionEnd) });
        requestAnimationFrame(() => el.setSelectionRange(s + ins.length, s + ins.length));
      }
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        flushRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, window.innerHeight * 0.55)}px`;
  }, [draft.body, mode]);

  const wsFolders = folders.filter((f) => f.workspace_id === draft.workspaceId);
  const folderOptions = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (parent: string | null, depth: number) =>
      wsFolders.filter((f) => f.parent_id === parent).forEach((f) => (out.push({ id: f.id, label: `${'— '.repeat(depth)}${f.name}` }), walk(f.id, depth + 1)));
    walk(null, 0);
    return out;
  }, [wsFolders]);

  const doTrash = async () => {
    if (!noteId) return nav('/knowledge');
    await flush();
    await api.trashNote(noteId);
    refresh();
    qc.removeQueries({ queryKey: ['note', noteId] });
    ui.toast('Moved to Trash', { action: { label: 'Undo', run: () => api.restoreNote(noteId).then(() => (refresh(), nav(`/knowledge/${noteId}`))) } });
    nav(`/knowledge${window.location.search}`);
  };
  const doRestore = async () => {
    await api.restoreNote(noteId!);
    qc.removeQueries({ queryKey: ['note', noteId] });
    refresh();
    ui.toast('Restored');
    nav(`/knowledge/${noteId}`);
  };
  const doPurge = async () => {
    const ok = await ui.confirm({ title: 'Delete permanently?', body: `“${draft.title || 'Untitled'}” will be gone for good. This can't be undone.`, confirm: 'Delete forever', danger: true });
    if (!ok) return;
    await api.purgeNote(noteId!);
    refresh();
    nav('/knowledge?view=trash');
  };

  const saveLabel =
    status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Editing' : status === 'error' ? 'Not saved' : savedAt ? `Saved ${timeAgo(savedAt)}` : 'New note';

  return (
    <div>
      <div className="editor-bar">
        <Link to={`/knowledge${window.location.search}`} className="btn ghost icon sm show-mobile" aria-label="Back to list"><ArrowLeft size={16} /></Link>
        <div className="seg" role="group" aria-label="Editor mode">
          {(['write', 'split', 'read'] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'write' ? 'Write' : m === 'split' ? 'Split' : 'Read'}</button>
          ))}
        </div>
        <span className="spacer" />
        <span className="small mono" style={{ color: status === 'error' ? 'var(--danger)' : 'var(--muted)', fontSize: 11 }} aria-live="polite">{deleted ? 'In Trash' : saveLabel}</span>
        {!deleted && (
          <button className="btn ghost icon sm" onClick={() => change({ favorite: !draft.favorite }, true)} aria-label={draft.favorite ? 'Unpin' : 'Pin'} title={draft.favorite ? 'Unpin' : 'Pin to Today'}>
            <Star size={15} color={draft.favorite ? 'var(--accent)' : undefined} fill={draft.favorite ? 'var(--accent)' : 'none'} />
          </button>
        )}
        <div style={{ position: 'relative' }}>
          <button className="btn ghost icon sm" onClick={() => setMenu((m) => !m)} aria-label="More" aria-expanded={menu}><MoreHorizontal size={16} /></button>
          {menu && (
            <div className="card" style={{ position: 'absolute', right: 0, top: 34, zIndex: 10, minWidth: 210, padding: 6 }} onMouseLeave={() => setMenu(false)}>
              {noteId && !deleted && (
                <a className="list-item" href={`/api/notes/${noteId}/export`} download onClick={() => setMenu(false)}><Download size={14} /> Export as Markdown</a>
              )}
              {!deleted && <button className="list-item" style={{ color: 'var(--danger)' }} onClick={() => (setMenu(false), doTrash())}><Trash2 size={14} /> Move to Trash</button>}
              {deleted && <button className="list-item" onClick={() => (setMenu(false), doRestore())}><RotateCcw size={14} /> Restore</button>}
              {deleted && <button className="list-item" style={{ color: 'var(--danger)' }} onClick={() => (setMenu(false), doPurge())}><Trash2 size={14} /> Delete forever</button>}
            </div>
          )}
        </div>
      </div>

      <div className="editor" style={mode === 'split' ? { maxWidth: 1400 } : undefined}>
        {deleted && (
          <div className="source-box" style={{ borderColor: 'rgba(224,122,104,.4)' }}>
            <Trash2 color="var(--danger)" /> This note is in Trash. <span className="spacer" />
            <button className="btn sm" onClick={doRestore}><RotateCcw /> Restore</button>
            <button className="btn sm danger" onClick={doPurge}>Delete forever</button>
          </div>
        )}
        <input
          className="title-input"
          value={draft.title}
          placeholder="Untitled"
          onChange={(e) => change({ title: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), bodyRef.current?.focus())}
          aria-label="Title"
          readOnly={deleted}
          autoFocus={!noteId}
        />
        <div className="meta-grid">
          <select className="select" value={draft.workspaceId} onChange={(e) => change({ workspaceId: e.target.value, folderId: null, projectId: null }, true)} aria-label="Workspace" disabled={deleted}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select className="select" value={draft.folderId ?? ''} onChange={(e) => change({ folderId: e.target.value || null }, true)} aria-label="Folder" disabled={deleted}>
            <option value="">No folder</option>
            {folderOptions.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <select className="select" value={draft.projectId ?? ''} onChange={(e) => change({ projectId: e.target.value || null }, true)} aria-label="Project" disabled={deleted}>
            <option value="">No project</option>
            {projects.filter((p) => p.workspace_id === draft.workspaceId || p.id === draft.projectId).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <select className="select" value={draft.kind} onChange={(e) => change({ kind: e.target.value as NoteKind }, true)} aria-label="Type" disabled={deleted}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select" value={draft.origin} onChange={(e) => change({ origin: e.target.value as Origin }, true)} aria-label="Origin" title={ORIGIN_HINT[draft.origin]} disabled={deleted || draft.origin === 'imported' || draft.origin === 'ai'}>
            {(['native', 'external', 'link'] as Origin[]).concat(draft.origin === 'imported' || draft.origin === 'ai' ? [draft.origin] : []).map((o) => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
          </select>
          <TagInput value={draft.tags} onChange={(tags) => change({ tags }, true)} />
        </div>

        {draft.origin !== 'native' && (
          <div className="source-box">
            <BookMarked color="var(--sky)" />
            <OriginBadge origin={draft.origin} />
            <input className="input" placeholder="Source label (e.g. Google Drive › Contracts)" value={draft.sourceLabel ?? ''} onChange={(e) => change({ sourceLabel: e.target.value || null })} style={{ flex: 1, padding: '4px 8px' }} aria-label="Source label" readOnly={deleted} />
            <input className="input" placeholder="https://…" value={draft.sourceUrl ?? ''} onChange={(e) => change({ sourceUrl: e.target.value || null })} style={{ flex: 1, padding: '4px 8px' }} aria-label="Source URL" readOnly={deleted} />
            {draft.sourceUrl && /^https?:\/\//.test(draft.sourceUrl) && <a className="btn sm" href={draft.sourceUrl} target="_blank" rel="noopener noreferrer">Open</a>}
          </div>
        )}

        <div className={mode === 'split' ? 'split' : ''}>
          {mode !== 'read' && (
            <textarea
              ref={bodyRef}
              className="body-input"
              value={draft.body}
              onChange={(e) => change({ body: e.target.value })}
              onKeyDown={onBodyKey}
              placeholder={'Start writing… Markdown works. Link notes with [[Note title]].'}
              aria-label="Note body"
              readOnly={deleted}
              spellCheck
            />
          )}
          {mode !== 'write' && <Preview body={draft.body} workspaceId={draft.workspaceId} />}
        </div>
        {noteId && !deleted && <Connections id={noteId} />}
      </div>
    </div>
  );
}

function Preview({ body, workspaceId }: { body: string; workspaceId: string }) {
  const html = useMemo(() => renderMarkdown(body), [body]);
  const titles = useMemo(() => extractWikiTitles(body), [body]);
  const key = titles.join('\n');
  const { data: resolved = {} } = useQuery({ queryKey: ['resolve', key], queryFn: () => api.resolveTitles(titles), enabled: titles.length > 0, staleTime: 10_000 });
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const ui = useUI();
  const refresh = useRefresh();

  useEffect(() => {
    ref.current?.querySelectorAll<HTMLAnchorElement>('a.wikilink').forEach((a) => {
      const t = a.dataset.wiki ?? '';
      const hit = Object.entries(resolved).find(([k]) => k.toLowerCase() === t.toLowerCase());
      a.classList.toggle('missing', !hit);
      a.title = hit ? 'Open note' : 'No note with this title yet — click to create it';
    });
  }, [html, resolved]);

  const onClick = async (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a.wikilink') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const t = a.dataset.wiki ?? '';
    const hit = Object.entries(resolved).find(([k]) => k.toLowerCase() === t.toLowerCase());
    if (hit) return nav(`/knowledge/${hit[1]}`);
    if (!(await ui.confirm({ title: `Create “${t}”?`, body: 'There is no note with this title yet.', confirm: 'Create note' }))) return;
    const n = await api.createNote({ workspaceId, title: t });
    refresh();
    nav(`/knowledge/${n.id}`);
  };

  return (
    <div ref={ref} className="prose" onClick={onClick} dangerouslySetInnerHTML={{ __html: html || '<p style="color:var(--faint)">Nothing to preview yet.</p>' }} />
  );
}

function Connections({ id }: { id: string }) {
  const { data: back = [] } = useQuery({ queryKey: ['backlinks', id], queryFn: () => api.backlinks(id) });
  const { data: rel = [] } = useQuery({ queryKey: ['related', id], queryFn: () => api.related(id) });
  if (!back.length && !rel.length) return null;
  return (
    <div className="connections">
      {back.length > 0 && (
        <section>
          <div className="eyebrow">Linked from · {back.length}</div>
          {back.map((n) => (
            <Link key={n.id} to={`/knowledge/${n.id}`} className="list-item">
              <span className="ws-dot" style={{ background: n.workspace_color }} /> <span className="truncate">{n.title}</span>
              <span className="meta">{timeAgo(n.updated_at)}</span>
            </Link>
          ))}
        </section>
      )}
      {rel.length > 0 && (
        <section>
          <div className="eyebrow">Related</div>
          {rel.map((n) => (
            <Link key={n.id} to={`/knowledge/${n.id}`} className="list-item">
              <span className="ws-dot" style={{ background: n.workspace_color }} /> <span className="truncate">{n.title}</span>
              <span className="meta truncate" style={{ maxWidth: '45%' }}>{n.reasons.join(' · ')}</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
