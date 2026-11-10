import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type GraphEdge, type GraphNode } from '../api';
import { useWorkspaces } from '../hooks';
import { KIND_LABEL } from '../lib/format';

type NodeType = GraphNode['type'];
type EdgeType = GraphEdge['type'];
interface P extends GraphNode { x: number; y: number; vx: number; vy: number; deg: number }

const NODE_LABEL: Record<NodeType, string> = { note: 'Notes', project: 'Projects', workspace: 'Businesses & spaces', tag: 'Tags' };
const EDGE_LABEL: Record<EdgeType, string> = { link: '[[Links]] between notes', project: 'Filed in project', workspace: 'Belongs to workspace', tag: 'Tagged' };

export function Graph() {
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ['graph'], queryFn: api.graph });
  const { data: workspaces = [] } = useWorkspaces();
  const [nodeOn, setNodeOn] = useState<Record<NodeType, boolean>>({ note: true, project: true, workspace: true, tag: false });
  const [edgeOn, setEdgeOn] = useState<Record<EdgeType, boolean>>({ link: true, project: true, workspace: true, tag: true });
  const [kind, setKind] = useState('');
  const [ws, setWs] = useState('');
  const [hideOrphans, setHideOrphans] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [, tick] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const pos = useRef(new Map<string, P>());
  const moved = useRef(false);

  // Filter first, so hidden things never pull on the layout ("no meaningless clutter").
  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [] as P[], edges: [] as GraphEdge[] };
    let ns = data.nodes.filter((n) => nodeOn[n.type]);
    if (kind) ns = ns.filter((n) => n.type !== 'note' || n.kind === kind);
    if (ws) ns = ns.filter((n) => n.id === ws || n.workspace_id === ws || n.type === 'tag');
    const ids = new Set(ns.map((n) => n.id));
    const es = data.edges.filter((e) => edgeOn[e.type] && ids.has(e.source) && ids.has(e.target));
    const deg = new Map<string, number>();
    for (const e of es) (deg.set(e.source, (deg.get(e.source) ?? 0) + 1), deg.set(e.target, (deg.get(e.target) ?? 0) + 1));
    if (hideOrphans) ns = ns.filter((n) => deg.get(n.id));
    const out = ns.map((n) => {
      const prev = pos.current.get(n.id);
      const p: P = prev ? { ...prev, ...n, deg: deg.get(n.id) ?? 0 } : { ...n, x: (Math.random() - 0.5) * 600, y: (Math.random() - 0.5) * 400, vx: 0, vy: 0, deg: deg.get(n.id) ?? 0 };
      pos.current.set(n.id, p);
      return p;
    });
    return { nodes: out, edges: es };
  }, [data, nodeOn, edgeOn, kind, ws, hideOrphans]);

  // Simple force simulation: repulsion, springs along edges, gentle gravity. Cools down then stops.
  useEffect(() => {
    let alpha = 1;
    let raf = 0;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const step = () => {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy || 0.01;
          if (d2 > 160000) continue;
          const f = (450 / d2) * alpha;
          dx *= f; dy *= f;
          a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
        }
      }
      for (const e of edges) {
        const a = byId.get(e.source), b = byId.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = e.type === 'link' ? 70 : e.type === 'workspace' ? 120 : 90;
        const f = ((d - rest) / d) * 0.04 * alpha;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const n of nodes) {
        n.vx -= n.x * 0.012 * alpha; n.vy -= n.y * 0.012 * alpha;
        n.x += n.vx; n.y += n.vy; n.vx *= 0.6; n.vy *= 0.6;
      }
      alpha *= 0.985;
      // Keep everything in view until Brad pans or zooms himself.
      const svg = svgRef.current;
      if (!moved.current && svg && nodes.length) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const n of nodes) (x0 = Math.min(x0, n.x), x1 = Math.max(x1, n.x), y0 = Math.min(y0, n.y), y1 = Math.max(y1, n.y));
        const k = Math.min(1.6, (svg.clientWidth - 340) / (x1 - x0 + 220), (svg.clientHeight - 60) / (y1 - y0 + 80));
        view.current = { k, x: 140 - ((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k };
      }
      tick((t) => t + 1);
      if (alpha > 0.02) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [nodes, edges]);

  // Pan and zoom.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { if ((e.target as Element).closest('.gnode')) return; drag = { x: e.clientX, y: e.clientY }; };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      moved.current = true;
      view.current.x += e.clientX - drag.x; view.current.y += e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      tick((t) => t + 1);
    };
    const up = () => (drag = null);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      moved.current = true;
      view.current.k = Math.min(3, Math.max(0.25, view.current.k * (e.deltaY > 0 ? 0.9 : 1.1)));
      tick((t) => t + 1);
    };
    svg.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => {
      svg.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      svg.removeEventListener('wheel', wheel);
    };
  }, []);

  const neighbours = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const e of edges) if (e.source === hover) s.add(e.target); else if (e.target === hover) s.add(e.source);
    return s;
  }, [hover, edges]);

  const open = (n: P) => {
    if (n.type === 'note') nav(`/knowledge/${n.id}`);
    else if (n.type === 'project') nav(`/projects/${n.id}`);
    else if (n.type === 'workspace') nav(`/knowledge?ws=${n.id}`);
    else nav(`/knowledge?tag=${encodeURIComponent(n.label.slice(1))}`);
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const w = svgRef.current?.clientWidth ?? 1000, h = svgRef.current?.clientHeight ?? 700;
  const { x, y, k } = view.current;
  const r = (n: P) => (n.type === 'workspace' ? 11 : n.type === 'project' ? 8 : n.type === 'tag' ? 4 : 4 + Math.min(n.deg, 6));

  return (
    <div className="graph-wrap">
      <div className="graph-panel card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Show</div>
        {(Object.keys(NODE_LABEL) as NodeType[]).map((t) => (
          <label key={t}><input type="checkbox" checked={nodeOn[t]} onChange={(e) => setNodeOn({ ...nodeOn, [t]: e.target.checked })} /> {NODE_LABEL[t]}</label>
        ))}
        <div className="eyebrow" style={{ margin: '10px 0 6px' }}>Connections</div>
        {(Object.keys(EDGE_LABEL) as EdgeType[]).map((t) => (
          <label key={t}><input type="checkbox" checked={edgeOn[t]} onChange={(e) => setEdgeOn({ ...edgeOn, [t]: e.target.checked })} /> {EDGE_LABEL[t]}</label>
        ))}
        <label style={{ marginTop: 6 }}><input type="checkbox" checked={hideOrphans} onChange={(e) => setHideOrphans(e.target.checked)} /> Hide unconnected</label>
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} style={{ marginTop: 8, fontSize: 12.5 }} aria-label="Note type">
          <option value="">All note types</option>
          {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="select" value={ws} onChange={(e) => setWs(e.target.value)} style={{ marginTop: 6, fontSize: 12.5 }} aria-label="Workspace">
          <option value="">All workspaces</option>
          {workspaces.map((wk) => <option key={wk.id} value={wk.id}>{wk.name}</option>)}
        </select>
        <p className="small muted" style={{ margin: '10px 0 0' }}>{nodes.length} nodes · {edges.length} connections. Click to open, drag to pan, scroll to zoom.</p>
      </div>
      <svg ref={svgRef} role="img" aria-label="Knowledge graph">
        <g transform={`translate(${w / 2 + x},${h / 2 + y}) scale(${k})`}>
          {edges.map((e, i) => {
            const a = byId.get(e.source), b = byId.get(e.target);
            if (!a || !b) return null;
            const dim = neighbours && !(neighbours.has(a.id) && neighbours.has(b.id));
            return <line key={i} className={`gedge ${e.type} ${dim ? 'dim' : ''}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={e.type === 'link' ? 1.6 : 1} />;
          })}
          {nodes.map((n) => {
            const dim = neighbours && !neighbours.has(n.id);
            const showLabel = n.type !== 'tag' || k > 1.2 || neighbours?.has(n.id);
            return (
              <g key={n.id} className={`gnode ${dim ? 'dim' : ''} ${hover === n.id ? 'hl' : ''}`} transform={`translate(${n.x},${n.y})`}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={() => open(n)}>
                {n.type === 'project'
                  ? <rect x={-r(n)} y={-r(n)} width={r(n) * 2} height={r(n) * 2} rx={3} fill={n.color} />
                  : <circle r={r(n)} fill={n.type === 'workspace' ? 'none' : n.color} stroke={n.color} strokeWidth={n.type === 'workspace' ? 2.5 : 0} />}
                {showLabel && <text x={r(n) + 4} y={4}>{n.label.length > 34 ? n.label.slice(0, 33) + '…' : n.label}</text>}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
