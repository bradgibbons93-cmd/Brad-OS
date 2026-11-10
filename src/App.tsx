import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, onUnauthorized } from './api';
import { useMe } from './hooks';
import { UIProvider } from './components/ui';
import { Shell } from './components/Shell';
import { Login } from './pages/Login';
import { Today } from './pages/Today';
import { Inbox } from './pages/Inbox';
import { Knowledge } from './pages/Knowledge';
import { Projects, ProjectDetail } from './pages/Projects';
import { Tasks } from './pages/Tasks';
import { Search } from './pages/Search';
import { Settings } from './pages/Settings';
import { Graph } from './pages/Graph';
import { Money } from './pages/Money';

export function App() {
  const qc = useQueryClient();
  const { data: me, error, isLoading } = useMe();

  // Any 401 (session expired, logged out elsewhere) drops all cached data and shows the login screen.
  useEffect(
    () =>
      onUnauthorized(() => {
        qc.resetQueries();
      }),
    [qc],
  );

  if (isLoading) return <div className="login"><div className="brand-mark" style={{ width: 34, height: 34 }} /></div>;
  if (!me || (error instanceof ApiError && error.status === 401)) return <Login />;

  return (
    <UIProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/knowledge/:id" element={<Knowledge />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/search" element={<Search />} />
          <Route path="/graph" element={<Graph />} />
          <Route path="/money" element={<Money />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </UIProvider>
  );
}
