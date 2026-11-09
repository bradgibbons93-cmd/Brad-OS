import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Upload } from 'lucide-react';
import { api } from '../api';
import { useDefaultWorkspace, useFolders, useRefresh, useWorkspaces } from '../hooks';
import { Dialog, useUI } from './ui';

const MAX_FILE = 2_000_000;

export function ImportDialog({ defaultWorkspace, defaultFolder, onClose }: { defaultWorkspace?: string; defaultFolder?: string; onClose: () => void }) {
  const { data: workspaces = [] } = useWorkspaces();
  const { data: folders = [] } = useFolders();
  const def = useDefaultWorkspace();
  const [ws, setWs] = useState(defaultWorkspace || '');
  const [folder, setFolder] = useState(defaultFolder || '');
  const [files, setFiles] = useState<{ name: string; content: string; size: number }[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const refresh = useRefresh();
  const ui = useUI();
  const nav = useNavigate();
  const wsId = ws || def;

  const read = async (list: FileList | null) => {
    if (!list) return;
    setErr('');
    const out: typeof files = [];
    for (const f of Array.from(list)) {
      if (!/\.(md|markdown|txt)$/i.test(f.name)) {
        setErr(`Skipped ${f.name}: only .md, .markdown and .txt files can be imported.`);
        continue;
      }
      if (f.size > MAX_FILE) {
        setErr(`Skipped ${f.name}: larger than 2 MB.`);
        continue;
      }
      out.push({ name: f.name, content: await f.text(), size: f.size });
    }
    setFiles((prev) => [...prev, ...out].slice(0, 200));
  };

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.importFiles({ workspaceId: wsId, folderId: folder || null, files: files.map(({ name, content }) => ({ name, content })) });
      refresh();
      ui.toast(`Imported ${r.created.length} ${r.created.length === 1 ? 'copy' : 'copies'}`);
      onClose();
      if (r.created.length === 1) nav(`/knowledge/${r.created[0].id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} labelledBy="imp-title">
      <div className="dialog-head"><h2 className="h2" id="imp-title">Import Markdown</h2></div>
      <div className="dialog-body stack">
        <p className="small dim" style={{ margin: 0 }}>
          Each file becomes an <b>imported copy</b> in BRAD OS. Your original files are not changed, moved or linked.
          Frontmatter <code>title</code> and <code>tags</code> are kept.
        </p>
        <label
          className={`dropzone ${over ? 'over' : ''}`}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => (e.preventDefault(), setOver(false), read(e.dataTransfer.files))}
        >
          <Upload size={20} style={{ opacity: 0.6 }} />
          <div style={{ marginTop: 6 }}>Drop .md files here, or <span style={{ color: 'var(--accent)' }}>browse</span></div>
          <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden onChange={(e) => read(e.target.files)} />
        </label>
        {files.length > 0 && (
          <div style={{ maxHeight: 160, overflowY: 'auto' }}>
            {files.map((f, i) => (
              <div key={i} className="list-item" style={{ padding: '4px 0' }}>
                <FileText size={14} color="var(--muted)" /> <span className="truncate small">{f.name}</span>
                <span className="meta">{(f.size / 1024).toFixed(1)} KB</span>
              </div>
            ))}
          </div>
        )}
        <div className="grid2">
          <div className="field"><label>Into workspace</label>
            <select className="select" value={wsId} onChange={(e) => (setWs(e.target.value), setFolder(''))}>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Folder</label>
            <select className="select" value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">No folder</option>
              {folders.filter((f) => f.workspace_id === wsId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>
        {err && <div className="small" style={{ color: 'var(--danger)' }}>{err}</div>}
      </div>
      <div className="dialog-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!files.length || busy || !wsId} onClick={submit}>
          Import {files.length || ''} {files.length === 1 ? 'file' : 'files'}
        </button>
      </div>
    </Dialog>
  );
}
