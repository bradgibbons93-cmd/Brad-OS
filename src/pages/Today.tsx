import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, Star } from 'lucide-react';
import { api, type NoteSummary } from '../api';
import { useMe, useRefresh } from '../hooks';
import { greeting, longDate, timeAgo } from '../lib/format';
import { plainExcerpt } from '../lib/markdown';
import { Kbd, OriginBadge, WsDot, useUI } from '../components/ui';
import { TaskRow } from '../components/TaskRow';

const ENTITY_PATH: Record<string, (id: string) => string> = {
  note: (id) => `/knowledge/${id}`,
  project: (id) => `/projects/${id}`,
  task: (id) => `/tasks?focus=${id}`,
  capture: (id) => `/inbox?focus=${id}`,
};

export function Today() {
  const { data, isLoading } = useQuery({ queryKey: ['today'], queryFn: api.today });
  const { data: me } = useMe();
  const family = me?.lens === 'family';

  if (isLoading || !data) return <div className="page"><div className="muted">Loading…</div></div>;
  const c = data.counts;

  return (
    <div className="page">
      <div className="today-head">
        <div>
          <div className="eyebrow">{longDate()} · {family ? 'Family space' : 'Work & Life'}</div>
          <h1 className="display">
            {greeting()}, <em>Brad.</em>
          </h1>
        </div>
        <div className="stats">
          <Link to="/inbox" className="stat"><b className={c.inbox ? 'hot' : ''}>{c.inbox}</b><span>Inbox</span></Link>
          <Link to="/tasks" className="stat"><b>{c.open_tasks}</b><span>Open tasks</span></Link>
          {c.overdue > 0 && <Link to="/tasks" className="stat"><b style={{ color: 'var(--danger)' }}>{c.overdue}</b><span>Overdue</span></Link>}
          <Link to="/projects" className="stat"><b>{c.projects}</b><span>Projects</span></Link>
          <Link to="/knowledge" className="stat"><b>{c.notes}</b><span>Notes</span></Link>
        </div>
      </div>

      <QuickCapture />

      <div className="today-grid">
        <div className="today-col">
          <section className="card">
            <div className="card-head">
              <h2 className="h2">Up next</h2>
              <span className="spacer" />
              <Link to="/tasks" className="btn ghost sm">All tasks <ArrowRight /></Link>
            </div>
            <div className="card-body">
              {data.upcomingTasks.length ? data.upcomingTasks.map((t) => <TaskRow key={t.id} task={t} />) : (
                <div className="card-empty">Nothing due. Tasks with a due date, priority or “doing” status show up here.</div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="h2">Active projects</h2>
              <span className="spacer" />
              <Link to="/projects" className="btn ghost sm">All projects <ArrowRight /></Link>
            </div>
            <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, padding: '4px 16px 16px' }}>
              {data.activeProjects.length ? data.activeProjects.map((p) => {
                const total = p.open_tasks + p.done_tasks;
                return (
                  <Link key={p.id} to={`/projects/${p.id}`} className="project-tile">
                    <div className="row small muted" style={{ gap: 6 }}><WsDot color={p.workspace_color} /> <span className="truncate">{p.workspace_name}</span></div>
                    <div style={{ fontFamily: 'var(--serif)', fontSize: 16, fontWeight: 500, lineHeight: 1.3 }}>{p.title}</div>
                    {p.next_action && <div className="small dim truncate">→ {p.next_action}</div>}
                    <div className="progress"><i style={{ width: `${total ? (p.done_tasks / total) * 100 : 0}%` }} /></div>
                    <div className="mono muted" style={{ fontSize: 11 }}>{p.open_tasks} open · {p.note_count} notes</div>
                  </Link>
                );
              }) : <div className="card-empty" style={{ padding: 0 }}>No active projects. <Link to="/projects?new=1" style={{ color: 'var(--accent)' }}>Start one</Link>.</div>}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="h2">Recently edited</h2>
              <span className="spacer" />
              <Link to="/knowledge" className="btn ghost sm">Knowledge <ArrowRight /></Link>
            </div>
            <div className="card-body">
              {data.recentNotes.length ? data.recentNotes.map((n) => <NoteRow key={n.id} n={n} when={n.updated_at} />) : (
                <div className="card-empty">No notes yet. Press <Kbd>N</Kbd> to write one.</div>
              )}
            </div>
          </section>
        </div>

        <div className="today-col">
          <section className="card">
            <div className="card-head">
              <h2 className="h2">Inbox</h2>
              <span className="spacer" />
              <Link to="/inbox" className="btn ghost sm">Review <ArrowRight /></Link>
            </div>
            <div className="card-body">
              {data.inbox.length ? data.inbox.map((cap) => (
                <Link key={cap.id} to={`/inbox?focus=${cap.id}`} className="list-item">
                  <span className="truncate dim">{cap.body.split('\n')[0]}</span>
                  <span className="meta">{timeAgo(cap.created_at)}</span>
                </Link>
              )) : <div className="card-empty">Inbox zero. Nice.</div>}
            </div>
          </section>

          {data.favorites.length > 0 && (
            <section className="card">
              <div className="card-head"><h2 className="h2">Pinned</h2><Star size={14} color="var(--accent)" /></div>
              <div className="card-body">
                {data.favorites.map((n) => (
                  <Link key={n.id} to={`/knowledge/${n.id}`} className="list-item">
                    <WsDot color={n.workspace_color} /> <span className="truncate">{n.title}</span>
                    <ArrowUpRight size={14} className="meta" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {data.recentlyOpened.length > 0 && (
            <section className="card">
              <div className="card-head"><h2 className="h2">Recently opened</h2></div>
              <div className="card-body">
                {data.recentlyOpened.map((n) => (
                  <Link key={n.id} to={`/knowledge/${n.id}`} className="list-item">
                    <WsDot color={n.workspace_color} /> <span className="truncate">{n.title}</span>
                    <span className="meta">{timeAgo(n.accessed_at)}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-head"><h2 className="h2">Activity</h2></div>
            {data.activity.length ? (
              <div className="timeline">
                {data.activity.map((a) => (
                  <div key={a.id} className="tl-item">
                    <span className="muted" style={{ flex: 'none' }}>{a.action}</span>
                    <Link to={ENTITY_PATH[a.entity_type]?.(a.entity_id) ?? '/'} className="truncate">{a.title}</Link>
                    <span className="when">{timeAgo(a.at)}</span>
                  </div>
                ))}
              </div>
            ) : <div className="card-empty">Activity will appear as you work.</div>}
          </section>
        </div>
      </div>
    </div>
  );
}

function NoteRow({ n, when }: { n: NoteSummary; when: string | null }) {
  return (
    <Link to={`/knowledge/${n.id}`} className="note-row">
      <span className="t row truncate" style={{ gap: 8 }}><WsDot color={n.workspace_color} /> <span className="truncate">{n.title}</span> <OriginBadge origin={n.origin} /></span>
      <span className="meta">{timeAgo(when)}</span>
      {n.excerpt && <span className="x truncate">{plainExcerpt(n.excerpt, 140)}</span>}
    </Link>
  );
}

function QuickCapture() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useRefresh();
  const ui = useUI();
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.capture(text);
      setText('');
      refresh();
      ui.toast('Captured to Inbox');
    } catch (e) {
      ui.toast((e as Error).message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="capture-hero">
      <textarea
        rows={1}
        value={text}
        placeholder="Capture a thought, idea or link…"
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), save());
        }}
        aria-label="Quick capture"
      />
      <button className="btn primary" onClick={save} disabled={!text.trim() || busy}>Capture <Kbd>↵</Kbd></button>
    </div>
  );
}
