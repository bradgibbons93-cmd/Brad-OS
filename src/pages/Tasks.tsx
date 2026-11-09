import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, type Task } from '../api';
import { rememberWorkspace, useDefaultWorkspace, useProjects, useRefresh, useWorkspaces } from '../hooks';
import { todayIso } from '../lib/format';
import { Empty, useUI } from '../components/ui';
import { TaskRow } from '../components/TaskRow';

export function Tasks() {
  const [params, setParams] = useSearchParams();
  const showDone = params.get('done') === '1';
  const wsFilter = params.get('ws') ?? '';
  const focus = params.get('focus');
  const { data: tasks = [], isLoading } = useQuery({ queryKey: ['tasks', 'all', showDone], queryFn: () => api.tasks({ done: showDone }) });
  const { data: workspaces = [] } = useWorkspaces();

  useEffect(() => {
    if (focus) setTimeout(() => document.getElementById(`task-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100);
  }, [focus, tasks.length]);

  const groups = useMemo(() => {
    const t = todayIso();
    const weekAhead = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    const list = tasks.filter((x) => !wsFilter || x.workspace_id === wsFilter);
    const g: Record<string, Task[]> = { Overdue: [], Today: [], 'This week': [], Later: [], 'No date': [], Done: [] };
    for (const x of list) {
      if (x.status === 'done') g.Done.push(x);
      else if (!x.due_date) g['No date'].push(x);
      else if (x.due_date < t) g.Overdue.push(x);
      else if (x.due_date === t) g.Today.push(x);
      else if (x.due_date <= weekAhead) g['This week'].push(x);
      else g.Later.push(x);
    }
    return Object.entries(g).filter(([, v]) => v.length);
  }, [tasks, wsFilter]);

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="row wrap" style={{ padding: '18px 0 14px', alignItems: 'flex-end' }}>
        <div>
          <div className="eyebrow">Next actions</div>
          <h1 className="h1" style={{ marginTop: 8 }}>Tasks</h1>
        </div>
        <span className="spacer" />
        <select className="select" style={{ width: 'auto' }} value={wsFilter} onChange={(e) => setParams((p) => (e.target.value ? p.set('ws', e.target.value) : p.delete('ws'), p))} aria-label="Filter by workspace">
          <option value="">All workspaces</option>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <label className="row small dim" style={{ gap: 6 }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setParams((p) => (e.target.checked ? p.set('done', '1') : p.delete('done'), p))} /> Show done
        </label>
      </div>

      <NewTask />

      {isLoading ? <div className="muted">Loading…</div> : groups.length === 0 ? (
        <Empty title="No open tasks">Add one above, or turn an Inbox capture into a task.</Empty>
      ) : groups.map(([name, list]) => (
        <section key={name} className="card" style={{ marginBottom: 14 }}>
          <div className="card-head">
            <h2 className="h2" style={name === 'Overdue' ? { color: 'var(--danger)' } : undefined}>{name}</h2>
            <span className="mono muted">{list.length}</span>
          </div>
          <div className="card-body">{list.map((t) => <TaskRow key={t.id} task={t} editable focus={t.id === focus} />)}</div>
        </section>
      ))}
    </div>
  );
}

function NewTask() {
  const { data: workspaces = [] } = useWorkspaces();
  const { data: projects = [] } = useProjects();
  const def = useDefaultWorkspace();
  const [title, setTitle] = useState('');
  const [ws, setWs] = useState('');
  const [project, setProject] = useState('');
  const [due, setDue] = useState('');
  const refresh = useRefresh();
  const ui = useUI();
  const wsId = ws || def;

  const add = async () => {
    if (!title.trim()) return;
    try {
      await api.createTask({ title, workspaceId: wsId, projectId: project || null, dueDate: due || null });
      rememberWorkspace(wsId);
      setTitle('');
      setDue('');
      refresh();
    } catch (e) {
      ui.toast((e as Error).message, { tone: 'error' });
    }
  };

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="inline-add row wrap" style={{ padding: '10px 12px' }}>
        <Plus size={16} color="var(--muted)" />
        <input placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="New task title" style={{ minWidth: 180 }} />
        <select className="select" style={{ width: 'auto', fontSize: 12.5, padding: '4px 26px 4px 8px' }} value={wsId} onChange={(e) => (setWs(e.target.value), setProject(''))} aria-label="Workspace">
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select className="select" style={{ width: 'auto', fontSize: 12.5, padding: '4px 26px 4px 8px' }} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">No project</option>
          {projects.filter((p) => p.workspace_id === wsId && p.status !== 'done').map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <input type="date" className="input" style={{ width: 140, padding: '4px 8px', fontSize: 12.5, flex: 'none' }} value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
        <button className="btn primary sm" onClick={add} disabled={!title.trim()}>Add</button>
      </div>
    </div>
  );
}
