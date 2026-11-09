import { useState } from 'react';
import { BookMarked, Bot, Cloud, Copy, Download, Link2, PenLine, ShieldCheck, Upload } from 'lucide-react';
import { api } from '../api';
import { useMe, useRefresh, useWorkspaces } from '../hooks';
import { ImportDialog } from '../components/ImportDialog';
import { WsDot, useUI } from '../components/ui';

export function Settings() {
  const { data: me } = useMe();
  const { data: workspaces = [] } = useWorkspaces();
  const [importing, setImporting] = useState(false);
  const refresh = useRefresh();
  const ui = useUI();
  const space = me?.lens === 'family' ? 'Family' : 'Work & Life';

  const removeSample = async () => {
    const ok = await ui.confirm({
      title: `Remove sample data from ${space}?`,
      body: 'This deletes the made-up example notes, projects, tasks and captures. Anything you created or edited into a sample project is kept.',
      confirm: 'Remove sample data',
      danger: true,
    });
    if (!ok) return;
    const r = await api.removeSample();
    refresh();
    ui.toast(`Removed ${r.notes} notes, ${r.projects} projects, ${r.tasks} tasks, ${r.captures} captures`);
  };

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div style={{ padding: '18px 0 6px' }}>
        <div className="eyebrow">{space}</div>
        <h1 className="h1" style={{ marginTop: 8 }}>Settings</h1>
      </div>

      <section className="settings-section">
        <div><h2 className="h2">Your data</h2><p>Google Drive is the source of truth. BRAD OS is the layer on top: it never silently syncs, overwrites or deletes anything outside itself.</p></div>
        <div className="stack">
          {[
            [PenLine, 'Native', 'Written in BRAD OS. Lives here.'],
            [BookMarked, 'Source', 'A pointer to an original document elsewhere (e.g. Drive). BRAD OS keeps only the pointer and your notes.'],
            [Copy, 'Imported copy', 'A copy of a file you imported. The original is untouched.'],
            [Link2, 'Link', 'A bookmark or web reference.'],
            [Bot, 'AI', 'AI-generated summaries or interpretations. Always labelled, never mixed with verified notes (Phase 3).'],
          ].map(([Icon, t, d]) => {
            const I = Icon as typeof PenLine;
            return (
              <div key={t as string} className="row" style={{ alignItems: 'flex-start' }}>
                <I size={16} color="var(--accent)" style={{ marginTop: 3, flex: 'none' }} />
                <div><b>{t as string}</b> <span className="dim small">— {d as string}</span></div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="settings-section">
        <div><h2 className="h2">Import &amp; export</h2><p>Markdown in, Markdown out. Exports include frontmatter (workspace, origin, tags, dates) and only cover the space you're in.</p></div>
        <div className="row wrap">
          <button className="btn" onClick={() => setImporting(true)}><Upload /> Import Markdown files</button>
          <a className="btn" href="/api/export" download><Download /> Export {space} as .zip</a>
        </div>
      </section>

      <section className="settings-section">
        <div><h2 className="h2">Privacy boundary</h2><p>Family records are separated in the database itself, not just hidden in the interface.</p></div>
        <div className="stack small dim">
          <div className="row" style={{ alignItems: 'flex-start' }}><ShieldCheck size={16} color="var(--sage)" style={{ flex: 'none', marginTop: 2 }} />
            <span>Every record belongs to exactly one space. The database refuses any link across spaces: a family note can't be filed in a business project, tagged with a work tag, or moved out.</span></div>
          <div className="row" style={{ alignItems: 'flex-start' }}><ShieldCheck size={16} color="var(--sage)" style={{ flex: 'none', marginTop: 2 }} />
            <span>Search, tags, Today, exports and the Inbox only ever read from the space you're in. There is no “everything” view that mixes them.</span></div>
          <div className="row" style={{ alignItems: 'flex-start' }}><ShieldCheck size={16} color="var(--sage)" style={{ flex: 'none', marginTop: 2 }} />
            <span>Entering Family needs your password again and locks itself after {me?.familyLensMinutes ?? 60} minutes. Photos and reference sheets stay in Google Drive (01_FAMILY).</span></div>
        </div>
      </section>

      <section className="settings-section">
        <div><h2 className="h2">Workspaces</h2><p>The spaces visible here. A workspace's privacy boundary is fixed when it's created.</p></div>
        <div className="stack" style={{ gap: 6 }}>
          {workspaces.map((w) => (
            <div key={w.id} className="row"><WsDot color={w.color} /> {w.name} <span className="chip">{w.kind}</span></div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div><h2 className="h2">Integrations</h2><p>Built as modules, switched on only when real credentials and permissions exist.</p></div>
        <div className="stack small">
          {['Google Drive', 'Google Calendar', 'Gmail', 'GitHub'].map((name) => (
            <div key={name} className="row"><Cloud size={15} color="var(--faint)" /> <span>{name}</span> <span className="badge sample">Not connected — Phase 4</span></div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div><h2 className="h2">Sample data</h2><p>The example records are made up. Remove them once you've had a look around.</p></div>
        <div><button className="btn danger" onClick={removeSample}>Remove sample data from {space}</button></div>
      </section>

      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}
