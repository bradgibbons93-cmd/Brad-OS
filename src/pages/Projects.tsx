import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FileText, Plus, Trash2 } from 'lucide-react';
import { api, type Project, type ProjectStatus } from '../api';
import { rememberWorkspace, useDefaultWorkspace, useProjects, useRefresh, useWorkspaces } from '../hooks';
import { dueLabel, timeAgo } from '../lib/format';
import { plainExcerpt } from '../lib/markdown';
import { Dialog, Empty, OriginBadge, WsDot, useUI } from '../components/ui';
import { TaskRow } from '../components/TaskRow';

const STATUS_LABEL: Record<ProjectStatus, string> = { planning: 'Planning', active: 'Active', paused: 'Paused', done: 'Done' };

export function Projects() {
  const [params, setParams] = useSearchParams();
  const { data: projects = [], isLoading } = useProjects();
  const { data: workspaces = [] } = useWorkspaces();
  const status = params.get('status') ?? 'open';
  const ws = params.get('ws') ?? '';
  const creating = params.get('new') === '1';

  const list = projects.filter((p) => (status === 'open' ? p.status !== 'done' : status === 'all' || p.status === status) && (!ws || p.workspace_id === ws));

  return (
    <div className="page">
      <div className="row wrap" style={{ padding: '18px 0 18px', alignItems: 'flex-end' }}>
        <div>
          <div className="eyebrow">Workspaces for real work</div>
          <h1 className="h1" style={{ marginTop: 8 }}>Projects</h1>
        </div>
        <span className="spacer" />
        <select className="select" style={{ width: 'auto' }} value={ws} onChange={(e) => setParams((p) => (e.target.value ? p.set('ws', e.target.value) : p.delete('ws'), p))} aria-label="Workspace">
          <option value="">All workspaces</option>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <div className="seg">
          {[['open', 'Open'], ['active', 'Active'], ['planning', 'Planning'], ['paused', 'Paused'], ['done', 'Done']].map(([k, v]) => (
            <button key={k} className={status === k ? 'on' : ''} onClick={() => setParams((p) => (p.set('status', k), p))}>{v}</button>
          ))}
        </div>
        <button className="btn primary" onClick={() => setParams((p) => (p.set('new', '1'), p))}><Plus /> New project</button>
      </div>

      {isLoading ? <div className="muted">Loading…</div> : list.length === 0 ? (
        <Empty title="No projects here">Projects hold the notes, tasks, decisions and research for one outcome.</Empty>
      ) : (
        <div className="project-grid">{list.map((p) => <ProjectCard key={p.id} p={p} />)}</div>
      )}
      {creating && <NewProjectDialog onClose={() => setParams((p) => (p.delete('new'), p))} />}
    </div>
  );
}

function ProjectCard({ p }: { p: Project }) {
  const total = p.open_tasks + p.done_tasks;
  const due = dueLabel(p.status === 'done' ? null : p.due_date);
  return (
    <Link to={`/projects/${p.id}`} className="project-card">
      <div className="row small muted" style={{ gap: 6 }}>
        <WsDot color={p.workspace_color} /> <span className="truncate">{p.workspace_name}</span>
        <span className="spacer" />
        <span className={`status ${p.status}`}>{STATUS_LABEL[p.status]}</span>
      </div>
      <h2 className="h2">{p.title}</h2>
      {p.summary && <p className="small dim" style={{ margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.summary}</p>}
      <span className="spacer" />
      {p.next_action && <div className="small truncate"><span className="muted">Next → </span>{p.next_action}</div>}
      <div className="progress"><i style={{ width: `${total ? (p.done_tasks / total) * 100 : 0}%` }} /></div>
      <div className="row mono muted" style={{ fontSize: 11 }}>
        <span>{p.done_tasks}/{total} tasks</span><span>·</span><span>{p.note_count} notes</span>
        <span className="spacer" />
        {due ? <span className={`due ${due.tone}`}>{due.text}</span> : <span>{timeAgo(p.updated_at)}</span>}
      </div>
    </Link>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { data: workspaces = [] } = useWorkspaces();
  const def = useDefaultWorkspace();
  const [ws, setWs] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [next, setNext] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('active');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const refresh = useRefresh();
  const ui = useUI();
  const wsId = ws || def;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api.createProject({ workspaceId: wsId, title, summary, nextAction: next, status });
      rememberWorkspace(wsId);
      refresh();
      nav(`/projects/${p.id}`);
    } catch (err) {
      ui.toast((err as Error).message, { tone: 'error' });
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} labelledBy="np-title">
      <form onSubmit={submit}>
        <div className="dialog-head"><h2 className="h2" id="np-title">New project</h2></div>
        <div className="dialog-body stack">
          <div className="field"><label>Title</label><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's the outcome?" /></div>
          <div className="grid2">
            <div className="field"><label>Workspace</label>
              <select className="select" value={wsId} onChange={(e) => setWs(e.target.value)}>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            </div>
            <div className="field"><label>Status</label>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
                {Object.entries(STATUS_LABEL).filter(([k]) => k !== 'done').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label>Summary</label><textarea className="textarea" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Why it matters, what done looks like" /></div>
          <div className="field"><label>Next action</label><input className="input" value={next} onChange={(e) => setNext(e.target.value)} placeholder="The very next physical step" /></div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!title.trim() || busy || !wsId}>Create project</button>
        </div>
      </form>
    </Dialog>
  );
}

export function ProjectDetail() {
  const { id = '' } = useParams();
  const { data, error } = useQuery({ queryKey: ['project', id], queryFn: () => api.project(id), retry: false });
  const { data: workspaces = [] } = useWorkspaces();
  const qc = useQueryClient();
  const refresh = useRefresh();
  const ui = useUI();
  const nav = useNavigate();
  const [tab, setTab] = useState<'tasks' | 'notes'>('tasks');
  const [newTask, setNewTask] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [form, setForm] = useState<{ title: string; summary: string; next: string; due: string } | null>(null);

  useEffect(() => {
    if (data) setForm({ title: data.project.title, summary: data.project.summary, next: data.project.next_action, due: data.project.due_date ?? '' });
  }, [data?.project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="page"><Empty title="Project not found">It may have been deleted, or it belongs to the other space.</Empty></div>;
  if (!data || !form) return <div className="page muted">Loading…</div>;
  const p = data.project;

  const save = async (b: Parameters<typeof api.updateProject>[1]) => {
    try {
      await api.updateProject(p.id, b);
      refresh();
    } catch (e) {
      ui.toast((e as Error).message, { tone: 'error' });
    }
  };
  const addTask = async () => {
    if (!newTask.trim()) return;
    await api.createTask({ projectId: p.id, title: newTask });
    setNewTask('');
    qc.invalidateQueries({ queryKey: ['project', id] });
    refresh();
  };
  const remove = async () => {
    const ok = await ui.confirm({
      title: `Delete “${p.title}”?`,
      body: `This deletes the project and its ${p.open_tasks + p.done_tasks} task(s). Its ${p.note_count} note(s) are kept and simply unlinked.`,
      confirm: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    await api.deleteProject(p.id);
    refresh();
    nav('/projects');
  };

  const open = data.tasks.filter((t) => t.status !== 'done');
  const done = data.tasks.filter((t) => t.status === 'done');
  const total = open.length + done.length;

  return (
    <div className="page">
      <div className="row" style={{ padding: '10px 0 4px' }}>
        <Link to="/projects" className="btn ghost sm"><ArrowLeft /> Projects</Link>
      </div>
      <div className="project-layout">
        <div style={{ minWidth: 0 }}>
          <div className="row small muted" style={{ gap: 6, marginTop: 8 }}>
            <WsDot color={p.workspace_color} /> {p.workspace_name}
          </div>
          <input className="title-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} onBlur={() => form.title.trim() && form.title !== p.title && save({ title: form.title })} aria-label="Project title" />
          <textarea className="body-input" style={{ minHeight: 0, fontSize: 15, color: 'var(--text-2)' }} rows={2} value={form.summary} placeholder="Add a summary: why this matters, what done looks like…" onChange={(e) => setForm({ ...form, summary: e.target.value })} onBlur={() => form.summary !== p.summary && save({ summary: form.summary })} aria-label="Summary" />

          <div className="next-action" style={{ margin: '14px 0 22px' }}>
            <ArrowRight />
            <div style={{ flex: 1 }}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Next action</div>
              <input className="input" style={{ border: 0, background: 'transparent', padding: 0, boxShadow: 'none' }} value={form.next} placeholder="What's the very next step?" onChange={(e) => setForm({ ...form, next: e.target.value })} onBlur={() => form.next !== p.next_action && save({ nextAction: form.next })} aria-label="Next action" />
            </div>
          </div>

          <div className="tabs">
            <button className={tab === 'tasks' ? 'on' : ''} onClick={() => setTab('tasks')}>Tasks · {open.length}</button>
            <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>Notes &amp; research · {data.notes.length}</button>
          </div>

          {tab === 'tasks' ? (
            <div className="card">
              <div className="inline-add" style={{ borderBottom: '1px solid var(--line)', padding: '10px 14px' }}>
                <Plus size={16} color="var(--muted)" />
                <input placeholder="Add a task and press Enter" value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTask()} aria-label="New task" />
              </div>
              <div className="card-body">
                {open.map((t) => <TaskRow key={t.id} task={t} showProject={false} editable />)}
                {!open.length && <div className="card-empty">No open tasks.</div>}
                {done.length > 0 && (
                  <button className="btn ghost sm" style={{ margin: '6px 8px' }} onClick={() => setShowDone((s) => !s)}>
                    {showDone ? 'Hide' : 'Show'} {done.length} done
                  </button>
                )}
                {showDone && done.map((t) => <TaskRow key={t.id} task={t} showProject={false} editable />)}
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-head">
                <span className="small muted">Notes, decisions and research filed under this project</span>
                <span className="spacer" />
                <Link to={`/knowledge/new?ws=${p.workspace_id}&project=${p.id}`} className="btn sm"><Plus /> New note</Link>
              </div>
              <div className="card-body">
                {data.notes.length ? data.notes.map((n) => (
                  <Link key={n.id} to={`/knowledge/${n.id}`} className="note-row">
                    <span className="t row truncate" style={{ gap: 8 }}><FileText size={14} color="var(--muted)" /> <span className="truncate">{n.title}</span> <span className="chip">{n.kind}</span> <OriginBadge origin={n.origin} /></span>
                    <span className="meta">{timeAgo(n.updated_at)}</span>
                    {n.excerpt && <span className="x truncate">{plainExcerpt(n.excerpt, 140)}</span>}
                  </Link>
                )) : <div className="card-empty">No notes yet. Link a note from its editor, or create one here.</div>}
              </div>
            </div>
          )}
        </div>

        <aside className="stack">
          <div className="card" style={{ padding: 16 }}>
            <div className="stack">
              <div className="field"><label>Status</label>
                <select className="select" value={p.status} onChange={(e) => save({ status: e.target.value as ProjectStatus })}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="field"><label>Workspace</label>
                <select className="select" value={p.workspace_id} onChange={(e) => save({ workspaceId: e.target.value })}>
                  {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Target date</label>
                <input type="date" className="input" value={form.due} onChange={(e) => (setForm({ ...form, due: e.target.value }), save({ dueDate: e.target.value || null }))} />
              </div>
              <div>
                <div className="row small muted" style={{ marginBottom: 6 }}><span>Progress</span><span className="spacer" /><span className="mono">{done.length}/{total}</span></div>
                <div className="progress"><i style={{ width: `${total ? (done.length / total) * 100 : 0}%` }} /></div>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2 className="h2">Activity</h2></div>
            {data.activity.length ? (
              <div className="timeline">
                {data.activity.map((a, i) => (
                  <div key={i} className="tl-item"><span className="muted" style={{ flex: 'none' }}>{a.action}</span> <span className="truncate">{a.title}</span><span className="when">{timeAgo(a.at)}</span></div>
                ))}
              </div>
            ) : <div className="card-empty">No activity yet.</div>}
          </div>
          <button className="btn danger" onClick={remove}><Trash2 /> Delete project</button>
        </aside>
      </div>
    </div>
  );
}
