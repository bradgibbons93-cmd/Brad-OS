import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function Login() {
  const qc = useQueryClient();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.login(pw);
      await qc.resetQueries();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <svg className="brand-x" viewBox="0 0 24 24" aria-hidden><path d="M4 4 L20 20" stroke="#FFD400" strokeWidth="3.4" strokeLinecap="round" /><path d="M4 20 L22 2" stroke="#00E5FF" strokeWidth="3.4" strokeLinecap="round" /></svg>
          <div className="brand-word">BRAD HQ<span>OS</span></div>
        </div>
        <h1 className="display">
          One place for <em>everything</em> you know.
        </h1>
        <p className="dim" style={{ margin: 0 }}>Private knowledge engine. Sign in to continue.</p>
        <input
          className="input"
          type="password"
          autoFocus
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          aria-label="Password"
          autoComplete="current-password"
          style={{ padding: '11px 14px', fontSize: 15 }}
        />
        {err && <div className="small" style={{ color: 'var(--danger)' }} role="alert">{err}</div>}
        <button className="btn primary" disabled={!pw || busy} style={{ padding: '10px 14px' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
