import { Dialog, Kbd, useUI } from './ui';

const SHORTCUTS: [string, string][] = [
  ['⌘K  or  /', 'Search and command palette'],
  ['C', 'Capture to Inbox'],
  ['N', 'New note'],
  ['G then T / I / K / P / A / S', 'Go to Today, Inbox, Knowledge, Projects, Tasks, Settings'],
  ['⌘↵', 'Save capture'],
  ['J / K', 'Move through Inbox items'],
  ['E', 'Archive focused Inbox item'],
  ['⌘S', 'Save note now (notes also autosave)'],
  ['⌘B / ⌘I', 'Bold / italic in the editor'],
  ['?', 'This help'],
];

export function ShortcutsHelp() {
  const ui = useUI();
  return (
    <Dialog open={ui.help.open} onClose={() => ui.help.set(false)} labelledBy="help-title">
      <div className="dialog-head">
        <h2 className="h2" id="help-title">Keyboard shortcuts</h2>
      </div>
      <div className="dialog-body">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="list-item" style={{ padding: '7px 0' }}>
            <span className="dim">{d}</span>
            <span className="meta"><Kbd>{k}</Kbd></span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
