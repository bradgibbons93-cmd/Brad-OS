import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api } from '../api';
import { resetSpaceData } from '../hooks';
import { Dialog, useUI } from './ui';

/** Entering the Family space always asks for the password again. */
export function LensDialog() {
  const ui = useUI();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => (ui.lens.set(false), setPw(''), setErr(''));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.setLens('family', pw);
      await resetSpaceData(qc); // drop every cached Work & Life record before showing family data
      close();
      nav('/');
      ui.toast('Family space unlocked');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={ui.lens.open} onClose={close} labelledBy="lens-title">
      <form onSubmit={submit}>
        <div className="dialog-head row">
          <Lock size={16} color="var(--family)" />
          <h2 className="h2" id="lens-title">Unlock the Family space</h2>
        </div>
        <div className="dialog-body stack">
          <p className="dim small" style={{ margin: 0 }}>
            Family records are kept apart from everything else. Work &amp; Life is hidden while you're in here, and the space locks itself again after an hour.
          </p>
          <input className="input" type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" autoComplete="current-password" />
          {err && <div className="small" style={{ color: 'var(--danger)' }}>{err}</div>}
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" disabled={!pw || busy}>Unlock</button>
        </div>
      </form>
    </Dialog>
  );
}
