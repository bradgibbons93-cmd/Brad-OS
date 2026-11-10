export type Boundary = 'work' | 'family';
export type Origin = 'native' | 'external' | 'imported' | 'link' | 'ai';
export type NoteKind = 'note' | 'decision' | 'research' | 'meeting' | 'reference' | 'person' | 'business';
export type ProjectStatus = 'planning' | 'active' | 'paused' | 'done';
export type TaskStatus = 'todo' | 'doing' | 'done';

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  kind: 'business' | 'personal' | 'dev' | 'family';
  boundary: Boundary;
  color: string;
}
export interface Folder {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  note_count: number;
}
export interface NoteSummary {
  id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_color: string;
  folder_id: string | null;
  project_id: string | null;
  title: string;
  excerpt: string;
  kind: NoteKind;
  origin: Origin;
  source_url: string | null;
  source_label: string | null;
  favorite: number;
  sample: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  accessed_at: string | null;
  tags: string[];
}
export interface NoteDetail extends Omit<NoteSummary, 'excerpt'> {
  body: string;
  folder_name: string | null;
  project_title: string | null;
}
export interface Project {
  id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_color: string;
  title: string;
  summary: string;
  status: ProjectStatus;
  next_action: string;
  due_date: string | null;
  updated_at: string;
  open_tasks: number;
  done_tasks: number;
  note_count: number;
}
export interface Task {
  id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_color: string;
  project_id: string | null;
  project_title: string | null;
  title: string;
  details: string;
  status: TaskStatus;
  priority: number;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
}
export interface Capture {
  id: string;
  workspace_id: string | null;
  workspace_name: string | null;
  workspace_color: string | null;
  body: string;
  url: string | null;
  tags: string;
  status: 'inbox' | 'archived' | 'converted';
  converted_type: 'note' | 'task' | null;
  converted_id: string | null;
  created_at: string;
}
export interface Activity {
  id?: number;
  entity_type: string;
  entity_id: string;
  action: string;
  title: string;
  at: string;
}
export interface SearchHit {
  type: 'note' | 'project' | 'task' | 'capture';
  id: string;
  title: string;
  snippet: string;
  workspace_id: string | null;
  workspace_name: string | null;
  workspace_color: string | null;
  origin: Origin | null;
  kind: NoteKind | null;
  updated_at: string | null;
}
export interface TodayData {
  counts: { notes: number; projects: number; open_tasks: number; inbox: number; overdue: number };
  recentNotes: NoteSummary[];
  recentlyOpened: NoteSummary[];
  favorites: NoteSummary[];
  activeProjects: Project[];
  upcomingTasks: Task[];
  inbox: Capture[];
  activity: Activity[];
}
export interface Me {
  lens: Boundary;
  lensUntil: string | null;
  familyLensMinutes: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export const onUnauthorized = (fn: Listener) => {
  unauthorizedListeners.add(fn);
  return () => void unauthorizedListeners.delete(fn);
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-brad-os': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && !path.startsWith('/auth/')) unauthorizedListeners.forEach((fn) => fn());
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v === true ? 1 : v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  login: (password: string) => request<{ ok: true }>('POST', '/auth/login', { password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  me: () => request<Me>('GET', '/auth/me'),
  setLens: (lens: Boundary, password?: string) => request<{ lens: Boundary; lensUntil: string | null }>('POST', '/auth/lens', { lens, password }),

  workspaces: () => request<Workspace[]>('GET', '/workspaces'),
  folders: () => request<Folder[]>('GET', '/folders'),
  createFolder: (b: { workspaceId: string; parentId?: string | null; name: string }) => request<Folder>('POST', '/folders', b),
  updateFolder: (id: string, b: { name?: string; parentId?: string | null }) => request<Folder>('PATCH', `/folders/${id}`, b),
  deleteFolder: (id: string) => request('DELETE', `/folders/${id}`),
  tags: () => request<{ name: string; count: number }[]>('GET', '/tags'),

  notes: (f: { workspace?: string; folder?: string; project?: string; tag?: string; favorite?: boolean; trash?: boolean; sort?: string } = {}) =>
    request<NoteSummary[]>('GET', `/notes${qs(f)}`),
  note: (id: string, touch = false) => request<NoteDetail>('GET', `/notes/${id}${qs({ touch })}`),
  createNote: (b: Partial<NoteInput>) => request<NoteDetail>('POST', '/notes', b),
  updateNote: (id: string, b: Partial<NoteInput>) => request<NoteDetail>('PATCH', `/notes/${id}`, b),
  trashNote: (id: string) => request('DELETE', `/notes/${id}`),
  purgeNote: (id: string) => request('DELETE', `/notes/${id}?permanent=1`),
  restoreNote: (id: string) => request<NoteDetail>('POST', `/notes/${id}/restore`),
  backlinks: (id: string) => request<NoteLite[]>('GET', `/notes/${id}/backlinks`),
  related: (id: string) => request<(NoteLite & { reasons: string[] })[]>('GET', `/notes/${id}/related`),
  graph: () => request<{ nodes: GraphNode[]; edges: GraphEdge[] }>('GET', '/graph'),
  resolveTitles: (titles: string[]) => request<Record<string, string>>('POST', '/notes/resolve', { titles }),

  projects: (f: { workspace?: string; status?: string } = {}) => request<Project[]>('GET', `/projects${qs(f)}`),
  project: (id: string) => request<{ project: Project; tasks: Task[]; notes: NoteSummary[]; activity: Activity[] }>('GET', `/projects/${id}`),
  createProject: (b: Partial<ProjectInput>) => request<Project>('POST', '/projects', b),
  updateProject: (id: string, b: Partial<ProjectInput>) => request<Project>('PATCH', `/projects/${id}`, b),
  deleteProject: (id: string) => request('DELETE', `/projects/${id}`),

  tasks: (f: { project?: string; workspace?: string; done?: boolean } = {}) => request<Task[]>('GET', `/tasks${qs(f)}`),
  createTask: (b: Partial<TaskInput>) => request<Task>('POST', '/tasks', b),
  updateTask: (id: string, b: Partial<TaskInput>) => request<Task>('PATCH', `/tasks/${id}`, b),
  deleteTask: (id: string) => request('DELETE', `/tasks/${id}`),

  inbox: (status: 'inbox' | 'archived' | 'converted' = 'inbox') => request<Capture[]>('GET', `/inbox${qs({ status })}`),
  capture: (body: string, workspaceId?: string | null) => request<Capture>('POST', '/inbox', { body, workspaceId }),
  updateCapture: (id: string, b: { body?: string; workspaceId?: string | null; status?: 'inbox' | 'archived' }) =>
    request<Capture>('PATCH', `/inbox/${id}`, b),
  deleteCapture: (id: string) => request('DELETE', `/inbox/${id}`),
  convertCapture: (id: string, b: { to: 'note' | 'task'; workspaceId: string; projectId?: string | null; title?: string }) =>
    request<{ type: 'note' | 'task'; id: string }>('POST', `/inbox/${id}/convert`, b),

  search: (q: string, f: { types?: string; workspace?: string; limit?: number } = {}) => request<SearchHit[]>('GET', `/search${qs({ q, ...f })}`),
  today: () => request<TodayData>('GET', '/today'),
  importFiles: (b: { workspaceId: string; folderId?: string | null; files: { name: string; content: string }[] }) =>
    request<{ created: { id: string; title: string }[] }>('POST', '/import', b),
  removeSample: () => request<Record<string, number>>('POST', '/sample/remove'),
};

export interface NoteInput {
  workspaceId: string;
  folderId: string | null;
  projectId: string | null;
  title: string;
  body: string;
  kind: NoteKind;
  origin: Origin;
  sourceUrl: string | null;
  sourceLabel: string | null;
  favorite: boolean;
  tags: string[];
}
export interface ProjectInput {
  workspaceId: string;
  title: string;
  summary: string;
  status: ProjectStatus;
  nextAction: string;
  dueDate: string | null;
}
export interface TaskInput {
  workspaceId: string;
  projectId: string | null;
  title: string;
  details: string;
  status: TaskStatus;
  priority: number;
  dueDate: string | null;
}

export interface NoteLite { id: string; title: string; kind: NoteKind; origin: Origin; workspace_id: string; workspace_name: string; workspace_color: string; updated_at: string }
export interface GraphNode { id: string; type: 'note' | 'project' | 'workspace' | 'tag'; label: string; kind?: string; color: string; workspace_id?: string }
export interface GraphEdge { source: string; target: string; type: 'link' | 'project' | 'workspace' | 'tag' }
