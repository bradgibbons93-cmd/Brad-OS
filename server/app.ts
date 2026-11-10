import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { zipSync, strToU8 } from 'fflate';
import type { DB } from './db.ts';
import { Auth, SESSION_COOKIE, FAMILY_LENS_MINUTES } from './auth.ts';
import { HttpError, listWorkspaces, requireWorkspace, type Scope, type Boundary } from './repo/base.ts';
import * as notes from './repo/notes.ts';
import * as folders from './repo/folders.ts';
import * as projects from './repo/projects.ts';
import * as inbox from './repo/inbox.ts';
import { search } from './repo/search.ts';
import { today } from './repo/today.ts';
import { parseMarkdown, serializeMarkdown, safeFilename, titleFromBody } from './markdown.ts';
import { removeSample } from './seed.ts';
import { backlinks, related, graph } from './repo/graph.ts';
import { mountMcp } from './mcp.ts';

type Env = { Variables: { scope: Scope; sessionId: string; lensUntil: string | null } };

export interface AppOptions {
  db: DB;
  password: string;
  sessionSecret: string;
  secureCookies?: boolean;
  mcpToken?: string;
}

const optStr = z.string().max(500).nullable().optional();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const noteSchema = z.object({
  workspaceId: z.string().optional(),
  folderId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  title: z.string().max(300).optional(),
  body: z.string().max(1_000_000).optional(),
  kind: z.enum(notes.NOTE_KINDS).optional(),
  origin: z.enum(notes.ORIGINS).optional(),
  sourceUrl: optStr,
  sourceLabel: optStr,
  favorite: z.boolean().optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
});

const projectSchema = z.object({
  workspaceId: z.string().optional(),
  title: z.string().max(200).optional(),
  summary: z.string().max(5000).optional(),
  status: z.enum(projects.PROJECT_STATUSES).optional(),
  nextAction: z.string().max(500).optional(),
  dueDate: dateStr,
});

const taskSchema = z.object({
  workspaceId: z.string().optional(),
  projectId: z.string().nullable().optional(),
  title: z.string().max(300).optional(),
  details: z.string().max(10000).optional(),
  status: z.enum(projects.TASK_STATUSES).optional(),
  priority: z.number().int().min(0).max(2).optional(),
  dueDate: dateStr,
});

export function createApp(opts: AppOptions) {
  const { db } = opts;
  const auth = new Auth(db, { password: opts.password, sessionSecret: opts.sessionSecret });
  const app = new Hono<Env>();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
      referrerPolicy: 'same-origin',
    }),
  );

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof z.ZodError) return c.json({ error: 'Invalid input', issues: err.issues.slice(0, 5) }, 400);
    const msg = String((err as Error)?.message ?? '');
    if (msg.includes('boundary:')) return c.json({ error: msg.slice(msg.indexOf('boundary:')) }, 400);
    console.error(err);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  const clientKey = (c: Context) =>
    c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || 'local';

  const cookieOpts = {
    httpOnly: true,
    secure: opts.secureCookies ?? false,
    sameSite: 'Strict' as const,
    path: '/',
    maxAge: 30 * 86400,
  };

  // CSRF defence in depth (cookies are already SameSite=Strict): every mutating API call must
  // carry a custom header, which cross-site forms cannot set.
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-brad-os') !== '1') {
      return c.json({ error: 'Missing request header' }, 403);
    }
    await next();
  });

  mountMcp(app, db, opts.mcpToken);

  app.get('/api/health', (c) => c.json({ ok: true }));

  // ── Auth ──────────────────────────────────────────────────────
  app.post('/api/auth/login', async (c) => {
    const key = clientKey(c);
    if (auth.rateLimited(key)) return c.json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
    const { password } = z.object({ password: z.string().max(500) }).parse(await c.req.json());
    if (!auth.checkPassword(password)) return c.json({ error: 'Wrong password' }, 401);
    auth.clearAttempts(key);
    setCookie(c, SESSION_COOKIE, auth.createSession(), cookieOpts);
    return c.json({ ok: true });
  });

  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/auth/login' || c.req.path === '/api/health') return next();
    const s = auth.readSession(getCookie(c, SESSION_COOKIE));
    if (!s) return c.json({ error: 'Not signed in' }, 401);
    c.set('scope', { boundary: s.lens });
    c.set('sessionId', s.id);
    c.set('lensUntil', s.lensUntil);
    await next();
  });

  app.get('/api/auth/me', (c) =>
    c.json({ lens: c.var.scope.boundary, lensUntil: c.var.lensUntil, familyLensMinutes: FAMILY_LENS_MINUTES }),
  );

  app.post('/api/auth/logout', (c) => {
    auth.destroySession(c.var.sessionId);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  /** Entering the Family lens always requires the password again. Leaving it never does. */
  app.post('/api/auth/lens', async (c) => {
    const body = z.object({ lens: z.enum(['work', 'family']), password: z.string().max(500).optional() }).parse(await c.req.json());
    if (body.lens === 'family') {
      const key = `lens:${clientKey(c)}`;
      if (auth.rateLimited(key)) return c.json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
      if (!auth.checkPassword(body.password ?? '')) return c.json({ error: 'Wrong password' }, 401);
      auth.clearAttempts(key);
    }
    const until = auth.setLens(c.var.sessionId, body.lens as Boundary);
    return c.json({ lens: body.lens, lensUntil: until });
  });

  // ── Workspaces, folders, tags ─────────────────────────────────
  app.get('/api/workspaces', (c) => c.json(listWorkspaces(db, c.var.scope)));
  app.get('/api/folders', (c) => c.json(folders.listFolders(db, c.var.scope)));
  app.post('/api/folders', async (c) => {
    const b = z.object({ workspaceId: z.string(), parentId: z.string().nullable().optional(), name: z.string().max(120) }).parse(await c.req.json());
    return c.json(folders.createFolder(db, c.var.scope, b), 201);
  });
  app.patch('/api/folders/:id', async (c) => {
    const b = z.object({ name: z.string().max(120).optional(), parentId: z.string().nullable().optional() }).parse(await c.req.json());
    return c.json(folders.updateFolder(db, c.var.scope, c.req.param('id'), b));
  });
  app.delete('/api/folders/:id', (c) => {
    folders.deleteFolder(db, c.var.scope, c.req.param('id'));
    return c.json({ ok: true });
  });
  app.get('/api/tags', (c) => c.json(notes.listTags(db, c.var.scope)));

  // ── Notes ─────────────────────────────────────────────────────
  app.get('/api/notes', (c) => {
    const q = c.req.query();
    return c.json(
      notes.listNotes(db, c.var.scope, {
        workspaceId: q.workspace || undefined,
        folderId: q.folder || undefined,
        projectId: q.project || undefined,
        tag: q.tag || undefined,
        favorite: q.favorite === '1',
        trash: q.trash === '1',
        sort: (['updated', 'created', 'title', 'accessed'] as const).find((s) => s === q.sort),
        limit: q.limit ? Number(q.limit) : undefined,
      }),
    );
  });
  app.post('/api/notes', async (c) => c.json(notes.createNote(db, c.var.scope, noteSchema.parse(await c.req.json())), 201));
  app.post('/api/notes/resolve', async (c) => {
    const { titles } = z.object({ titles: z.array(z.string().max(300)).max(200) }).parse(await c.req.json());
    return c.json(notes.resolveTitles(db, c.var.scope, titles));
  });
  app.get('/api/notes/:id', (c) =>
    c.json(notes.getNote(db, c.var.scope, c.req.param('id'), { touch: c.req.query('touch') === '1', includeDeleted: true })),
  );
  app.patch('/api/notes/:id', async (c) => c.json(notes.updateNote(db, c.var.scope, c.req.param('id'), noteSchema.parse(await c.req.json()))));
  app.delete('/api/notes/:id', (c) => {
    if (c.req.query('permanent') === '1') notes.purgeNote(db, c.var.scope, c.req.param('id'));
    else notes.trashNote(db, c.var.scope, c.req.param('id'));
    return c.json({ ok: true });
  });
  app.get('/api/notes/:id/backlinks', (c) => c.json(backlinks(db, c.var.scope, c.req.param('id'))));
  app.get('/api/notes/:id/related', (c) => c.json(related(db, c.var.scope, c.req.param('id'))));
  app.get('/api/graph', (c) => c.json(graph(db, c.var.scope)));
  app.post('/api/notes/:id/restore', (c) => c.json(notes.restoreNote(db, c.var.scope, c.req.param('id'))));
  app.get('/api/notes/:id/export', (c) => {
    const n = notes.getNote(db, c.var.scope, c.req.param('id'));
    const md = serializeMarkdown(noteMeta(n), n.body);
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename(n.title))}.md`);
    return c.body(md);
  });

  // ── Projects & tasks ──────────────────────────────────────────
  app.get('/api/projects', (c) =>
    c.json(projects.listProjects(db, c.var.scope, { workspaceId: c.req.query('workspace') || undefined, status: c.req.query('status') || undefined })),
  );
  app.post('/api/projects', async (c) => c.json(projects.createProject(db, c.var.scope, projectSchema.parse(await c.req.json())), 201));
  app.get('/api/projects/:id', (c) => c.json(projects.getProjectDetail(db, c.var.scope, c.req.param('id'))));
  app.patch('/api/projects/:id', async (c) =>
    c.json(projects.updateProject(db, c.var.scope, c.req.param('id'), projectSchema.parse(await c.req.json()))),
  );
  app.delete('/api/projects/:id', (c) => {
    projects.deleteProject(db, c.var.scope, c.req.param('id'));
    return c.json({ ok: true });
  });
  app.get('/api/tasks', (c) =>
    c.json(
      projects.listTasks(db, c.var.scope, {
        projectId: c.req.query('project') || undefined,
        workspaceId: c.req.query('workspace') || undefined,
        includeDone: c.req.query('done') === '1',
      }),
    ),
  );
  app.post('/api/tasks', async (c) => c.json(projects.createTask(db, c.var.scope, taskSchema.parse(await c.req.json())), 201));
  app.patch('/api/tasks/:id', async (c) => c.json(projects.updateTask(db, c.var.scope, c.req.param('id'), taskSchema.parse(await c.req.json()))));
  app.delete('/api/tasks/:id', (c) => {
    projects.deleteTask(db, c.var.scope, c.req.param('id'));
    return c.json({ ok: true });
  });

  // ── Inbox ─────────────────────────────────────────────────────
  app.get('/api/inbox', (c) => {
    const status = (['inbox', 'archived', 'converted'] as const).find((s) => s === c.req.query('status')) ?? 'inbox';
    return c.json(inbox.listCaptures(db, c.var.scope, status));
  });
  app.post('/api/inbox', async (c) => {
    const b = z.object({ body: z.string().max(20000), workspaceId: z.string().nullable().optional() }).parse(await c.req.json());
    return c.json(inbox.createCapture(db, c.var.scope, b), 201);
  });
  app.patch('/api/inbox/:id', async (c) => {
    const b = z
      .object({ body: z.string().max(20000).optional(), workspaceId: z.string().nullable().optional(), status: z.enum(['inbox', 'archived']).optional() })
      .parse(await c.req.json());
    return c.json(inbox.updateCapture(db, c.var.scope, c.req.param('id'), b));
  });
  app.delete('/api/inbox/:id', (c) => {
    inbox.deleteCapture(db, c.var.scope, c.req.param('id'));
    return c.json({ ok: true });
  });
  app.post('/api/inbox/:id/convert', async (c) => {
    const b = z
      .object({ to: z.enum(['note', 'task']), workspaceId: z.string(), projectId: z.string().nullable().optional(), title: z.string().max(300).optional() })
      .parse(await c.req.json());
    return c.json(inbox.convertCapture(db, c.var.scope, c.req.param('id'), b));
  });

  // ── Search & Today ────────────────────────────────────────────
  app.get('/api/search', (c) => {
    const types = (c.req.query('types') ?? '')
      .split(',')
      .filter((t): t is 'note' | 'project' | 'task' | 'capture' => ['note', 'project', 'task', 'capture'].includes(t));
    return c.json(
      search(db, c.var.scope, c.req.query('q') ?? '', {
        types,
        workspaceId: c.req.query('workspace') || undefined,
        limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      }),
    );
  });
  app.get('/api/today', (c) => c.json(today(db, c.var.scope)));

  // ── Import / export ───────────────────────────────────────────
  app.post('/api/import', async (c) => {
    const b = z
      .object({
        workspaceId: z.string(),
        folderId: z.string().nullable().optional(),
        files: z.array(z.object({ name: z.string().max(260), content: z.string().max(2_000_000) })).min(1).max(200),
      })
      .parse(await c.req.json());
    requireWorkspace(db, c.var.scope, b.workspaceId);
    const created: { id: string; title: string }[] = [];
    for (const f of b.files) {
      if (!/\.(md|markdown|txt)$/i.test(f.name)) throw new HttpError(400, `Unsupported file type: ${f.name}`);
      const { meta, body } = parseMarkdown(f.content);
      const base = f.name.replace(/^.*[\\/]/, '').replace(/\.(md|markdown|txt)$/i, '');
      const title = (typeof meta.title === 'string' && meta.title) || titleFromBody(body) || base;
      const tags = Array.isArray(meta.tags) ? meta.tags : typeof meta.tags === 'string' ? meta.tags.split(/[,\s]+/) : [];
      const n = notes.createNote(db, c.var.scope, {
        workspaceId: b.workspaceId,
        folderId: b.folderId ?? null,
        title,
        body,
        origin: 'imported',
        sourceLabel: `Imported copy of ${f.name.replace(/^.*[\\/]/, '')}`,
        sourceUrl: typeof meta.source === 'string' && /^https?:\/\//.test(meta.source) ? meta.source : null,
        tags,
      });
      created.push({ id: n.id, title: n.title });
    }
    return c.json({ created }, 201);
  });

  app.get('/api/export', (c) => {
    const scope = c.var.scope;
    const wsFilter = c.req.query('workspace') || undefined;
    const workspaces = listWorkspaces(db, scope);
    const wsName = new Map(workspaces.map((w) => [w.id, w.name]));
    const allFolders = folders.listFolders(db, scope);
    const folderPath = (id: string | null): string[] => {
      const out: string[] = [];
      let cur = allFolders.find((f) => f.id === id);
      while (cur) {
        out.unshift(safeFilename(cur.name));
        const parent = cur.parent_id;
        cur = allFolders.find((f) => f.id === parent);
      }
      return out;
    };
    const files: Record<string, Uint8Array> = {};
    const manifest: unknown[] = [];
    const used = new Set<string>();
    for (const s of notes.listNotes(db, scope, { workspaceId: wsFilter, limit: 1000 })) {
      const n = notes.getNote(db, scope, s.id);
      const dir = [safeFilename(wsName.get(n.workspace_id) ?? 'Workspace'), ...folderPath(n.folder_id)].join('/');
      let path = `${dir}/${safeFilename(n.title)}.md`;
      for (let i = 2; used.has(path); i++) path = `${dir}/${safeFilename(n.title)} (${i}).md`;
      used.add(path);
      files[path] = strToU8(serializeMarkdown(noteMeta(n), n.body));
      manifest.push({ path, id: n.id, origin: n.origin });
    }
    files['manifest.json'] = strToU8(
      JSON.stringify({ exportedAt: new Date().toISOString(), space: scope.boundary === 'family' ? 'Family' : 'Work & Life', notes: manifest }, null, 2),
    );
    const zip = zipSync(files, { level: 6 });
    const stamp = new Date().toISOString().slice(0, 10);
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', `attachment; filename="brad-os-${scope.boundary}-${stamp}.zip"`);
    return c.body(zip.buffer as ArrayBuffer);
  });

  app.post('/api/sample/remove', (c) => c.json(removeSample(db, c.var.scope.boundary)));

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  return app;
}

function noteMeta(n: notes.NoteDetail) {
  return {
    title: n.title,
    id: n.id,
    workspace: n.workspace_name,
    kind: n.kind,
    origin: n.origin,
    source: n.source_url,
    source_label: n.source_label,
    tags: n.tags,
    created: n.created_at,
    updated: n.updated_at,
  };
}
