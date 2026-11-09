import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from './api';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: api.me, retry: false, staleTime: 30_000 });
export const useWorkspaces = () => useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces, staleTime: 60_000 });
export const useFolders = () => useQuery({ queryKey: ['folders'], queryFn: api.folders });
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: api.tags });
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => api.projects() });
export const useInboxCount = () =>
  useQuery({ queryKey: ['inbox', 'inbox'], queryFn: () => api.inbox('inbox'), select: (d) => d.length });

/** Refresh everything derived from records. Kept coarse on purpose: the dataset is personal-scale. */
export function useRefresh() {
  const qc = useQueryClient();
  return useCallback(
    (opts: { except?: string[] } = {}) =>
      qc.invalidateQueries({
        predicate: (q) => {
          const key = String(q.queryKey[0]);
          if (key === 'me' || key === 'workspaces') return false;
          if (opts.except && q.queryKey.length > 1 && opts.except.includes(`${key}:${String(q.queryKey[1])}`)) return false;
          return true;
        },
      }),
    [qc],
  );
}

/** Default workspace for new items: last used, else Personal, else first available. */
export function useDefaultWorkspace() {
  const { data: ws = [] } = useWorkspaces();
  let last: string | null = null;
  try {
    last = localStorage.getItem('bos:lastWs');
  } catch {
    /* storage unavailable */
  }
  const found = ws.find((w) => w.id === last) ?? ws.find((w) => w.kind === 'personal') ?? ws[0];
  return found?.id ?? '';
}
export function rememberWorkspace(id: string) {
  try {
    localStorage.setItem('bos:lastWs', id);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Wipe every cached record (used when switching spaces) so no data from one space can be shown
 * in the other, while keeping the app shell mounted. `me` is refetched rather than wiped.
 */
export async function resetSpaceData(qc: ReturnType<typeof useQueryClient>) {
  await qc.resetQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  await qc.invalidateQueries({ queryKey: ['me'] });
}
