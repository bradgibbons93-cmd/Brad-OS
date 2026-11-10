import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Trash2 } from 'lucide-react';
import { api, parseLinks, type Task, type TaskStatus } from '../api';
import { useRefresh } from '../hooks';
import { dueLabel } from '../lib/format';
import { WsDot, useUI } from './ui';

const NEXT: Record<TaskStatus, TaskStatus> = { todo: 'done', doing: 'done', done: 'todo' };

export function TaskRow({ task, showProject = true, editable = false, focus = false }: { task: Task; showProject?: boolean; editable?: boolean; focus?: boolean }) {
  const refresh = useRefresh();
  const ui = useUI();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const due = dueLabel(task.status === 'done' ? null : task.due_date);

  const update = async (b: Parameters<typeof api.updateTask>[1], msg?: string) => {
    try {
      await api.updateTask(task.id, b);
      refresh();
      if (msg) ui.toast(msg, b.status === 'done' ? { action: { label: 'Undo', run: () => api.updateTask(task.id, { status: task.status }).then(() => refresh()) } } : undefined);
    } catch (e) {
      ui.toast((e as Error).message, { tone: 'error' });
    }
  };

  const remove = async () => {
    if (!(await ui.confirm({ title: 'Delete this task?', body: `“${task.title}” will be removed permanently.`, confirm: 'Delete', danger: true }))) return;
    await api.deleteTask(task.id);
    refresh();
  };

  return (
    <div className={`task ${task.status === 'done' ? 'done' : ''}`} id={`task-${task.id}`} style={focus ? { background: 'var(--accent-wash)' } : undefined}>
      <button
        className={`check ${task.status}`}
        aria-label={task.status === 'done' ? 'Mark as not done' : 'Mark as done'}
        onClick={() => update({ status: NEXT[task.status] }, task.status === 'done' ? undefined : 'Task completed')}
      >
        {task.status === 'done' && <Check strokeWidth={3} />}
      </button>
      <div className="title">
        {editing ? (
          <input
            className="input"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => (setEditing(false), title.trim() && title !== task.title && update({ title }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') (setTitle(task.title), setEditing(false));
            }}
            style={{ padding: '2px 6px' }}
          />
        ) : (
          <span onDoubleClick={() => editable && setEditing(true)}>{task.title}</span>
        )}
        {(task.tool || parseLinks(task.links).length > 0) && task.status !== 'done' && (
          <div className="tool">
            {task.tool && <span>Use: {task.tool}</span>}
            {parseLinks(task.links).map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}
          </div>
        )}
        {showProject && (
          <div className="small muted row" style={{ gap: 6, marginTop: 2 }}>
            <WsDot color={task.workspace_color} />
            {task.project_id ? <Link to={`/projects/${task.project_id}`} className="truncate">{task.project_title}</Link> : <span className="truncate">{task.workspace_name}</span>}
          </div>
        )}
      </div>
      {!!task.needs_me && task.status !== 'done' && <span className="wtag bill" title="Needs you">You</span>}
      {task.priority > 0 && task.status !== 'done' && <span className="prio" title="Priority">{task.priority === 2 ? 'NOW' : 'NEXT'}</span>}
      {task.status === 'doing' && <span className="due today">Doing</span>}
      {due && <span className={`due ${due.tone}`}>{due.text}</span>}
      {editable && (
        <div className="row" style={{ gap: 2 }}>
          <input
            type="date"
            className="input"
            value={task.due_date ?? ''}
            onChange={(e) => update({ dueDate: e.target.value || null })}
            style={{ width: 128, padding: '2px 6px', fontSize: 12 }}
            aria-label="Due date"
          />
          <select
            className="select"
            value={task.priority}
            onChange={(e) => update({ priority: Number(e.target.value) })}
            style={{ width: 70, padding: '2px 22px 2px 6px', fontSize: 12 }}
            aria-label="Priority"
          >
            <option value={0}>—</option>
            <option value={1}>!</option>
            <option value={2}>!!</option>
          </select>
          {task.status !== 'done' && (
            <button className="btn ghost sm" onClick={() => update({ status: task.status === 'doing' ? 'todo' : 'doing' })} title="Toggle doing">
              {task.status === 'doing' ? 'Pause' : 'Start'}
            </button>
          )}
          <button className="btn ghost icon sm" onClick={remove} aria-label="Delete task"><Trash2 size={14} /></button>
        </div>
      )}
    </div>
  );
}
