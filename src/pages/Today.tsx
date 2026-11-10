import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, Star } from 'lucide-react';
import { api, type NoteSummary } from '../api';
import { useQueryClient } from '@tanstack/react-query';
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
      <div className="hq-hero">
        <div>
          <div className="eyebrow">{family ? 'Gibbons Crew · Family space' : 'Cel-X Group · Brad HQ'}</div>
          <h1 className="display" style={{ marginTop: 12 }}>
            {greeting().replace('Good ', '').replace(/^\w/, (c) => c.toUpperCase())}, <em>Brad.</em>
          </h1>
          <p className="sub">{longDate()} · Everything, one place.</p>
        </div>
        <div className="stats">
          <Link to="/inbox" className="stat"><b className={c.inbox ? 'hot' : ''}>{c.inbox}</b><span>Inbox</span></Link>
          <Link to="/tasks" className="stat"><b>{c.open_tasks}</b><span>Open tasks</span></Link>
          {c.overdue > 0 && <Link to="/tasks" className="stat"><b style={{ color: 'var(--danger)' }}>{c.overdue}</b><span>Overdue</span></Link>}
          <Link to="/projects" className="stat"><b>{c.projects}</b><span>Projects</span></Link>
        </div>
      </div>

      {!family && (
        <div className="worlds" aria-label="Your worlds">
          <a href="https://claude-code-auto-reply-city-ink-production.up.railway.app" target="_blank" rel="noopener noreferrer" style={{ ['--t' as string]: '#D9A94E' }}><i>🖋️</i>City Ink</a>
          <Link to="/projects?q=runnit" style={{ ['--t' as string]: '#00E5FF' }}><i>🚀</i>Runnit</Link>
          <Link to="/projects" style={{ ['--t' as string]: '#7A5CFF' }}><i>✕</i>Cel-X × Cyph</Link>
          <Link to="/money" style={{ ['--t' as string]: '#3DDC97' }}><i>💸</i>Money</Link>
          <a href="https://yumi-production-e794.up.railway.app" target="_blank" rel="noopener noreferrer" style={{ ['--t' as string]: '#FF6FA8' }}><i>⭐</i>Gibbons OS · Yumi</a>
        </div>
      )}

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
          {!family && <WaitingCard />}
          {!family && <MoneyCard />}
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

          {!family && <QuickLaunch />}
          <FocusTimer />
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

function WaitingCard() {
  const { data: items = [] } = useQuery({ queryKey: ['waiting'], queryFn: api.waiting });
  const qc = useQueryClient();
  const ui = useUI();
  const done = async (id: string) => {
    await api.setWaiting(id, 'done');
    qc.invalidateQueries({ queryKey: ['waiting'] });
    ui.toast('Marked handled', { action: { label: 'Undo', run: () => api.setWaiting(id, 'open').then(() => qc.invalidateQueries({ queryKey: ['waiting'] })) } });
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="h2">✉️ Waiting on you</h2>
        <span className="mono muted">{items.length || ''}</span>
        <span className="spacer" />
        <a className="btn ghost sm" href="https://mail.google.com/mail/u/0/#inbox" target="_blank" rel="noopener noreferrer">Gmail ↗</a>
      </div>
      <div className="card-body" style={{ padding: '4px 14px 14px' }}>
        {items.length ? items.slice(0, 6).map((w) => (
          <div key={w.id} className="wait">
            <div className="row" style={{ gap: 8 }}>
              <span className={`wtag ${w.category}`}>{w.category}</span>
              <span className="s truncate">{w.from_name}{w.date ? ` · ${w.date}` : ''}</span>
              <span className="spacer" />
              <button className="btn ghost sm" onClick={() => done(w.id)} title="Mark handled">✓</button>
            </div>
            {w.url ? <a className="t" href={w.url} target="_blank" rel="noopener noreferrer">{w.subject}</a> : <span className="t">{w.subject}</span>}
            {w.next && <span className="n">→ {w.next}</span>}
          </div>
        )) : <div className="card-empty" style={{ padding: 0 }}>Nothing waiting. Gmail and Granola are checked weekdays at 8:45am and 2:25pm.</div>}
      </div>
    </section>
  );
}

function MoneyCard() {
  const { data: subs = [] } = useQuery({ queryKey: ['money'], queryFn: api.money });
  if (!subs.length) return null;
  const soon = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const failing = subs.filter((s) => s.status === 'payment_failing');
  const renewing = subs.filter((s) => s.status === 'active' && s.renews && s.renews <= soon && s.renews >= new Date().toISOString().slice(0, 10));
  const review = subs.filter((s) => /cancel|trim|review|drop/i.test(s.suggest) && s.status !== 'cancelled' && !s.decision);
  return (
    <section className="card">
      <div className="card-head"><h2 className="h2">💸 Money this month</h2><span className="spacer" /><Link to="/money" className="btn ghost sm">Open <ArrowRight /></Link></div>
      <div className="card-body" style={{ padding: '0 14px 14px' }}>
        {failing.map((s) => <div key={s.id} className="wait"><span className="t" style={{ color: 'var(--danger)' }}>Payment failing: {s.name}</span>{s.note && <span className="s">{s.note}</span>}</div>)}
        <div className="row small" style={{ gap: 16, padding: '6px 2px' }}>
          <span><b>{subs.filter((s) => s.status === 'active').length}</b> <span className="muted">active</span></span>
          <span><b>{renewing.length}</b> <span className="muted">renew in 30 days</span></span>
          <span><b style={{ color: 'var(--accent)' }}>{review.length}</b> <span className="muted">to cancel or trim</span></span>
        </div>
      </div>
    </section>
  );
}

const LAUNCH: [string, string, string][] = [
  ['💬', 'City Ink app', 'https://claude-code-auto-reply-city-ink-production.up.railway.app'],
  ['🚀', 'Runnit HQ', 'https://claude.ai/artifact/DBEv1pxAc2jiphN1bCKLap'],
  ['🖋️', 'Studio Links', 'https://claude.ai/artifact/HydToY6e5nPNhs78SFJcy2'],
  ['🧪', 'SOFTR', 'https://claude.ai/artifact/Xb3JS3FL64jt79Y4V59QVS'],
  ['⭐', 'Yumi', 'https://yumi-production-e794.up.railway.app'],
  ['📁', 'Drive', 'https://drive.google.com/drive/folders/1daZ3Zd1qt_ZH3It5CUiavejHrxJV_7at'],
  ['✉️', 'Gmail', 'https://mail.google.com/mail/u/0/#inbox'],
  ['📅', 'Calendar', 'https://calendar.google.com/calendar/r/week'],
];
function QuickLaunch() {
  return (
    <section className="card">
      <div className="card-head"><h2 className="h2">🚀 Quick launch</h2></div>
      <div className="apps">
        {LAUNCH.map(([ic, label, url]) => (
          <a key={label} className="app" href={url} target="_blank" rel="noopener noreferrer"><span className="ic">{ic}</span>{label}</a>
        ))}
      </div>
    </section>
  );
}

function FocusTimer() {
  const [left, setLeft] = useState(25 * 60);
  const [on, setOn] = useState(false);
  const ref = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => {
    if (!on) return;
    ref.current = setInterval(() => setLeft((l) => (l <= 1 ? (setOn(false), 0) : l - 1)), 1000);
    return () => clearInterval(ref.current);
  }, [on]);
  const m = String(Math.floor(left / 60)).padStart(2, '0'), s = String(left % 60).padStart(2, '0');
  return (
    <section className="card" style={{ padding: 16 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>⏱️ 25-minute block</div>
      <div className="timer-big">{m}:{s}</div>
      <div className="bar" style={{ margin: '12px 0' }}><i style={{ width: `${(1 - left / 1500) * 100}%` }} /></div>
      <div className="row">
        <button className="btn primary sm" onClick={() => setOn(!on)}>{on ? 'Pause' : left === 1500 ? 'Start' : 'Resume'}</button>
        <button className="btn sm" onClick={() => (setOn(false), setLeft(1500))}>Reset</button>
      </div>
    </section>
  );
}
