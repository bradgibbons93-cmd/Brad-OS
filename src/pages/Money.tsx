import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Sub } from '../api';
import { Empty } from '../components/ui';

const STATUS: Record<string, string> = { active: 'Active', expiring: 'Expiring', payment_failing: 'Payment failing', cancelled: 'Cancelled', unknown: 'Unknown' };

export function Money() {
  const { data: subs = [], isLoading } = useQuery({ queryKey: ['money'], queryFn: api.money });
  const qc = useQueryClient();
  const decide = async (s: Sub, decision: string) => {
    await api.updateSub(s.id, { decision });
    qc.invalidateQueries({ queryKey: ['money'] });
  };
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const live = subs.filter((s) => s.status !== 'cancelled');
  const ended = subs.filter((s) => s.status === 'cancelled');
  const renewing = live.filter((s) => s.renews && s.renews >= today && s.renews <= soon);
  const toReview = live.filter((s) => /cancel|trim|review|drop/i.test(s.suggest) && !s.decision);
  const groups = [...new Set(live.map((s) => s.grp || 'Other'))];

  const Row = ({ s }: { s: Sub }) => (
    <div className="subrow">
      <div>
        <div style={{ fontWeight: 600 }}>{s.name} <span className={`st ${s.status}`}>{STATUS[s.status] ?? s.status}</span></div>
        <div className="small muted">{s.plan}{s.renews ? ` · renews ${s.renews}` : ''}{s.via ? ` · via ${s.via}` : ''}</div>
        {s.note && <div className="small muted" style={{ marginTop: 4 }}>{s.note}</div>}
        <div className="row small" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          {s.suggest && <span className="muted">Suggest: <b style={{ color: 'var(--accent)' }}>{s.suggest}</b></span>}
          {s.manage && <span className="muted">Manage: {s.manage}</span>}
          {s.evidence && <a href={s.evidence} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)' }}>Email ↗</a>}
        </div>
      </div>
      <select className="select" value={s.decision} onChange={(e) => decide(s, e.target.value)} style={{ width: 'auto', alignSelf: 'start', fontSize: 12.5, padding: '4px 26px 4px 10px' }} aria-label={`Decision for ${s.name}`}>
        <option value="">Decide…</option>
        <option value="keep">Keep</option>
        <option value="trim">Trim</option>
        <option value="cancel">Cancel</option>
      </select>
    </div>
  );

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div style={{ padding: '18px 0 14px' }}>
        <div className="eyebrow">Money</div>
        <h1 className="h1" style={{ marginTop: 8 }}>Subscriptions & bills</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>Nothing here pays, cancels or changes anything. Decisions are notes for you; Manus's Money Monday keeps it current.</p>
      </div>
      {isLoading ? <div className="muted">Loading…</div> : !subs.length ? <Empty title="No subscriptions yet">Import them from Master HQ.</Empty> : (
        <>
          <div className="money-tot">
            <div><b>{live.length}</b><span>active or expiring</span></div>
            <div><b>{renewing.length}</b><span>renew in the next 30 days</span></div>
            <div><b style={{ color: 'var(--accent)' }}>{toReview.length}</b><span>suggested to cancel or trim</span></div>
          </div>
          {groups.map((g) => (
            <section key={g} className="card" style={{ marginBottom: 14 }}>
              <div className="card-head"><h2 className="h2">{g}</h2><span className="mono muted">{live.filter((s) => (s.grp || 'Other') === g).length}</span></div>
              {live.filter((s) => (s.grp || 'Other') === g).map((s) => <Row key={s.id} s={s} />)}
            </section>
          ))}
          {ended.length > 0 && (
            <details className="card" style={{ padding: '6px 0' }}>
              <summary className="muted small" style={{ cursor: 'pointer', padding: '8px 16px' }}>Ended · {ended.length}</summary>
              {ended.map((s) => <Row key={s.id} s={s} />)}
            </details>
          )}
        </>
      )}
    </div>
  );
}
