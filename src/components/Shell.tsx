import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Briefcase, CheckSquare, Network, FolderKanban, Home, Inbox, Library, Lock, LogOut, Menu, Moon, Plus, Search, Settings, Sun, Unlock, Users,
} from 'lucide-react';
import { api } from '../api';
import { resetSpaceData, useInboxCount, useMe, useWorkspaces } from '../hooks';
import { isTyping } from '../lib/format';
import { Kbd, WsDot, useUI } from './ui';
import { CommandPalette } from './CommandPalette';
import { CaptureDialog } from './CaptureDialog';
import { LensDialog } from './LensDialog';
import { ShortcutsHelp } from './ShortcutsHelp';

export function Shell({ children }: { children: ReactNode }) {
  const ui = useUI();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: workspaces = [] } = useWorkspaces();
  const { data: inboxCount = 0 } = useInboxCount();
  const [railOpen, setRailOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('bos:theme') ?? 'dark';
    } catch {
      return 'dark';
    }
  });
  const mainRef = useRef<HTMLDivElement>(null);
  const family = me?.lens === 'family';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('bos:theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.lens = me?.lens ?? 'work';
  }, [me?.lens]);
  useEffect(() => {
    setRailOpen(false);
  }, [loc.pathname, loc.search]);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [loc.pathname]);

  // Re-lock automatically when the family lens timer runs out, even while idle.
  useEffect(() => {
    if (!me?.lensUntil) return;
    const ms = new Date(me.lensUntil).getTime() - Date.now();
    const t = setTimeout(() => {
      resetSpaceData(qc);
      ui.toast('Family space locked');
      nav('/');
    }, Math.max(ms + 500, 0));
    return () => clearTimeout(t);
  }, [me?.lensUntil, qc, nav, ui]);

  // Global keyboard shortcuts.
  useEffect(() => {
    let g = false;
    let gTimer: ReturnType<typeof setTimeout>;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.palette.set(!ui.palette.open);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        ui.capture.set(true);
        return;
      }
      if (isTyping(e) || mod || e.altKey || document.querySelector('.overlay')) return;
      if (g) {
        g = false;
        const map: Record<string, string> = { t: '/', i: '/inbox', k: '/knowledge', p: '/projects', a: '/tasks', r: '/graph', s: '/settings' };
        if (map[e.key]) (e.preventDefault(), nav(map[e.key]));
        return;
      }
      if (e.key === 'g') {
        g = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(() => (g = false), 900);
      } else if (e.key === 'c') (e.preventDefault(), ui.capture.set(true));
      else if (e.key === '/') (e.preventDefault(), ui.palette.set(true));
      else if (e.key === 'n') (e.preventDefault(), nav('/knowledge/new'));
      else if (e.key === '?') (e.preventDefault(), ui.help.set(true));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui, nav]);

  const switchLens = async (lens: 'work' | 'family') => {
    if (lens === me?.lens) return;
    if (lens === 'family') return ui.lens.set(true);
    await api.setLens('work');
    await resetSpaceData(qc); // never keep family data cached once you leave the family space
    nav('/');
    ui.toast('Back in Work & Life');
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    qc.clear();
    window.location.href = '/';
  };

  const NavItem = ({ to, icon: Icon, label, count, end }: { to: string; icon: typeof Home; label: string; count?: number; end?: boolean }) => (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      <Icon /> <span>{label}</span>
      {!!count && <span className={`count ${to === '/inbox' ? 'hot' : ''}`}>{count}</span>}
    </NavLink>
  );

  return (
    <div className="shell">
      <div className={`rail-backdrop ${railOpen ? 'open' : ''}`} onClick={() => setRailOpen(false)} />
      <aside className={`rail ${railOpen ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <svg className="brand-x" viewBox="0 0 24 24" aria-hidden><path d="M4 4 L20 20" stroke="#FFD400" strokeWidth="3.4" strokeLinecap="round" /><path d="M4 20 L22 2" stroke="#00E5FF" strokeWidth="3.4" strokeLinecap="round" /></svg>
          <div className="brand-word">BRAD HQ<span>OS</span></div>
        </div>

        <div className="lens" role="group" aria-label="Space">
          <button className={!family ? 'on' : ''} onClick={() => switchLens('work')} aria-pressed={!family}>
            <Briefcase /> Work &amp; Life
          </button>
          <button className={family ? 'on' : ''} onClick={() => switchLens('family')} aria-pressed={family}>
            {family ? <Unlock /> : <Lock />} Family
          </button>
        </div>

        <div className="nav-section">
          <NavItem to="/" end icon={Home} label="Today" />
          <NavItem to="/inbox" icon={Inbox} label="Inbox" count={inboxCount} />
          <NavItem to="/knowledge" icon={Library} label="Knowledge" />
 <NavItem to="/projects" icon={FolderKanban} label="Projects" />
          <NavItem to="/tasks" icon={CheckSquare} label="Tasks" />
          <NavItem to="/graph" icon={Network} label="Graph" />
          <NavItem to="/search" icon={Search} label="Search" />
        </div>

        <div className="nav-section">
          <div className="eyebrow">
            {family ? 'Family spaces' : 'Workspaces'}
          </div>
          {workspaces.map((w) => (
            <NavLink
              key={w.id}
              to={`/knowledge?ws=${w.id}`}
              className={() => `nav-item ${loc.pathname.startsWith('/knowledge') && new URLSearchParams(loc.search).get('ws') === w.id ? 'active' : ''}`}
            >
              <WsDot color={w.color} />
              <span className="truncate">{w.name}</span>
              {w.kind === 'family' && <Users style={{ marginLeft: 'auto', width: 13, opacity: 0.5 }} />}
            </NavLink>
          ))}
        </div>

        <div className="rail-foot">
          <button className="nav-item" style={{ border: 0, background: 'none', width: '100%' }} onClick={() => ui.help.set(true)}>
            <span style={{ width: 16, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12 }}>?</span> Shortcuts
          </button>
          <NavItem to="/settings" icon={Settings} label="Settings" />
          <div className="row" style={{ padding: '4px 4px 0' }}>
            <button className="btn ghost sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </button>
            <span className="spacer" />
            <button className="btn ghost sm" onClick={logout}>
              <LogOut /> Lock
            </button>
          </div>
        </div>
      </aside>

      <div className="main" ref={mainRef} onScroll={(e) => setScrolled((e.target as HTMLElement).scrollTop > 4)}>
        {family && (
          <div className="family-banner">
            <Unlock /> Family space — separate from Work &amp; Life. Locks itself after {me?.familyLensMinutes ?? 60} minutes.
            <button className="btn sm" onClick={() => switchLens('work')}>
              <Lock /> Lock now
            </button>
          </div>
        )}
        <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
          <button className="btn ghost icon show-mobile" onClick={() => setRailOpen(true)} aria-label="Open menu">
            <Menu />
          </button>
          <button className="search-trigger" onClick={() => ui.palette.set(true)}>
            <Search /> <span>Search or jump to…</span> <Kbd>⌘K</Kbd>
          </button>
          <span className="spacer" />
          <button className="btn hide-mobile" onClick={() => nav('/knowledge/new')}>
            <Plus /> Note
          </button>
          <button className="btn primary" onClick={() => ui.capture.set(true)}>
            <Plus /> <span className="hide-mobile">Capture</span> <Kbd>C</Kbd>
          </button>
        </header>
        {children}
      </div>

      <nav className="mobile-bar" aria-label="Quick navigation">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}><Home /> Today</NavLink>
        <NavLink to="/inbox" className={({ isActive }) => (isActive ? 'active' : '')}><Inbox /> Inbox</NavLink>
        <button className="cap" onClick={() => ui.capture.set(true)} aria-label="Capture"><span className="ring"><Plus /></span></button>
        <NavLink to="/knowledge" className={({ isActive }) => (isActive ? 'active' : '')}><Library /> Notes</NavLink>
        <NavLink to="/projects" className={({ isActive }) => (isActive ? 'active' : '')}><FolderKanban /> Projects</NavLink>
      </nav>

      <CommandPalette />
      <CaptureDialog />
      <LensDialog />
      <ShortcutsHelp />
    </div>
  );
}
