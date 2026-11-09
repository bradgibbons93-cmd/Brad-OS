import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { api } from '../api';
import { useRefresh, useWorkspaces } from '../hooks';
import { Dialog, Kbd, useUI } from './ui';

export function CaptureDialog() {
  const ui = useUI();
  const refresh = useRefresh();
  const { data: workspaces = [] } = useWorkspaces();
  const [text, setText] = useState('');
  const [ws, setWs] = useState('');
  const [busy, setBusy] = useState(false);
  const open = ui.capture.open;

  useEffect(() => {
    if (open) setText((t) => t);
  }, [open]);

  const save = async (keepOpen = false) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.capture(text, ws || null);
      setText('');
      refresh();
      ui.toast('Captured to Inbox');
      if (!keepOpen) ui.capture.set(false);
    } catch (e) {
      ui.toast((e as Error).message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => ui.capture.set(false)} labelledBy="cap-title">
      <div className="dialog-head row">
        <Zap size={16} color="var(--accent)" />
        <h2 className="h2" id="cap-title">Capture</h2>
        <span className="spacer" />
        <span className="small muted">Lands in Inbox</span>
      </div>
      <div className="dialog-body stack">
        <textarea
          className="textarea"
          autoFocus
          rows={5}
          value={text}
          placeholder="A thought, idea, link or note. Use #tags. Markdown works."
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), save(e.shiftKey));
          }}
          style={{ fontFamily: 'var(--serif)', fontSize: 17 }}
          aria-label="Capture text"
        />
        <div className="row">
          <select className="select" style={{ width: 'auto' }} value={ws} onChange={(e) => setWs(e.target.value)} aria-label="Workspace">
            <option value="">No workspace yet</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="dialog-foot">
        <span className="small muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>
          <Kbd>⌘↵</Kbd> save · <Kbd>⌘⇧↵</Kbd> save &amp; next
        </span>
        <button className="btn ghost" onClick={() => ui.capture.set(false)}>Cancel</button>
        <button className="btn primary" disabled={!text.trim() || busy} onClick={() => save()}>Capture</button>
      </div>
    </Dialog>
  );
}
