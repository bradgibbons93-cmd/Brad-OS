import { timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import type { DB } from './db.ts';
import type { Scope } from './repo/base.ts';
import { listWorkspaces } from './repo/base.ts';
import * as notes from './repo/notes.ts';
import * as projects from './repo/projects.ts';
import * as inbox from './repo/inbox.ts';
import { search } from './repo/search.ts';
import { today } from './repo/today.ts';
import { addWaiting, listWaiting } from './repo/money.ts';

/**
 * A minimal MCP server (Streamable HTTP, JSON responses) so Poke, claude.ai custom connectors and
 * other MCP clients can read and write BRAD OS.
 *
 * Privacy: it ONLY ever sees the Work & Life boundary. Family records are unreachable from MCP.
 * Safety: new items from outside land in the Inbox (or as tasks/notes the caller explicitly asks for);
 * nothing is ever deleted through MCP.
 * Auth: Bearer token (MCP_TOKEN) in the Authorization header, or ?key= for clients that only take a URL.
 */
const SCOPE: Scope = { boundary: 'work' };
const PROTOCOL = '2025-06-18';

type Args = Record<string, unknown>;
const str = (v: unknown, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : undefined);

function tools(db: DB) {
  const wsId = (name?: string) => {
    const all = listWorkspaces(db, SCOPE);
    if (!name) return all.find((w) => w.kind === 'personal')!.id;
    const n = name.toLowerCase();
    const w = all.find((x) => x.id === name || x.slug === n || x.name.toLowerCase() === n || x.name.toLowerCase().includes(n));
    if (!w) throw new Error(`Unknown workspace "${name}". Options: ${all.map((x) => x.name).join(', ')}`);
    return w.id;
  };
  const wsProp = { type: 'string', description: 'Workspace name, e.g. Runnit, City Ink Tattoo, Cel-X Digital, Personal. Defaults to Personal.' };

  return {
    today: {
      description: "Brad's Today view: counts, tasks due or in progress, active projects, inbox items and recent notes.",
      inputSchema: { type: 'object', properties: {} },
      run: () => {
        const t = today(db, SCOPE);
        return {
          counts: t.counts,
          upNext: t.upcomingTasks.map((x) => ({ id: x.id, title: x.title, due: x.due_date, project: x.project_title, status: x.status })),
          activeProjects: t.activeProjects.map((p) => ({ id: p.id, title: p.title, workspace: p.workspace_name, nextAction: p.next_action, open: p.open_tasks })),
          inbox: t.inbox.map((c) => ({ id: c.id, text: c.body })),
          recentNotes: t.recentNotes.map((n) => ({ id: n.id, title: n.title })),
        };
      },
    },
    search: {
      description: 'Full-text search across notes, projects, tasks and inbox captures.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      run: (a: Args) => search(db, SCOPE, str(a.query, 300) ?? '', { limit: 20 }).map((h) => ({
        type: h.type, id: h.id, title: h.title, workspace: h.workspace_name, snippet: h.snippet.replace(/[\u0002\u0003]/g, ''),
      })),
    },
    add_waiting: {
      description: 'Add emails or messages that are waiting on Brad (the "Waiting on you" card). Safe to call repeatedly: items are matched by url, so re-runs update instead of duplicating. category: client | bill | official | family | other.',
      inputSchema: {
        type: 'object',
        properties: { items: { type: 'array', items: { type: 'object', properties: {
          category: { type: 'string' }, from: { type: 'string' }, subject: { type: 'string' }, why: { type: 'string', description: 'Why it needs Brad' },
          next: { type: 'string', description: 'The next step' }, url: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, source: { type: 'string', description: 'gmail | granola | beeper' },
        }, required: ['subject'] } } },
        required: ['items'],
      },
      run: (a: Args) => addWaiting(db, SCOPE, Array.isArray(a.items) ? (a.items as Record<string, string>[]) : []),
    },
    list_waiting: {
      description: 'What is currently on the "Waiting on you" list.',
      inputSchema: { type: 'object', properties: {} },
      run: () => listWaiting(db, SCOPE).map((w) => ({ id: w.id, from: w.from_name, subject: w.subject, next: w.next, url: w.url })),
    },
    get_note: {
      description: 'Read one note in full (Markdown).',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: (a: Args) => {
        const n = notes.getNote(db, SCOPE, str(a.id, 100) ?? '');
        return { id: n.id, title: n.title, workspace: n.workspace_name, tags: n.tags, origin: n.origin, source: n.source_url, body: n.body };
      },
    },
    list_tasks: {
      description: 'Open tasks, soonest due first. Optionally filter by workspace.',
      inputSchema: { type: 'object', properties: { workspace: wsProp } },
      run: (a: Args) => projects.listTasks(db, SCOPE, { workspaceId: a.workspace ? wsId(str(a.workspace)) : undefined, limit: 100 })
        .map((t) => ({ id: t.id, title: t.title, due: t.due_date, priority: t.priority, status: t.status, project: t.project_title, workspace: t.workspace_name })),
    },
    list_projects: {
      description: 'All projects with status and next action.',
      inputSchema: { type: 'object', properties: {} },
      run: () => projects.listProjects(db, SCOPE).map((p) => ({ id: p.id, title: p.title, status: p.status, workspace: p.workspace_name, nextAction: p.next_action, openTasks: p.open_tasks })),
    },
    capture: {
      description: 'Drop something into the BRAD OS Inbox for Brad to review later. Preferred for anything pulled from email, meetings or messages. Include the source (e.g. "From Gmail: <subject>") and a link if there is one.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' }, workspace: wsProp }, required: ['text'] },
      run: (a: Args) => {
        const text = str(a.text) ?? '';
        const dup = inbox.listCaptures(db, SCOPE, 'inbox', 500).find((c) => c.body.trim().toLowerCase() === text.trim().toLowerCase());
        if (dup) return { skipped: 'already in inbox', id: dup.id };
        const c = inbox.createCapture(db, SCOPE, { body: text, workspaceId: a.workspace ? wsId(str(a.workspace)) : null });
        return { id: c.id, status: 'in inbox' };
      },
    },
    create_task: {
      description: 'Create a task. Skips it if an open task with the same title already exists.',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' }, details: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD' }, priority: { type: 'integer', minimum: 0, maximum: 2 }, workspace: wsProp, project: { type: 'string', description: 'Project title (optional)' } },
        required: ['title'],
      },
      run: (a: Args) => {
        const title = (str(a.title, 300) ?? '').trim();
        const dup = projects.listTasks(db, SCOPE, { limit: 1000 }).find((t) => t.title.trim().toLowerCase() === title.toLowerCase());
        if (dup) return { skipped: 'duplicate of an open task', id: dup.id };
        let projectId: string | null = null;
        if (a.project) {
          const p = projects.listProjects(db, SCOPE).find((x) => x.title.toLowerCase().includes(String(a.project).toLowerCase()));
          if (p) projectId = p.id;
        }
        const due = str(a.due, 10);
        const t = projects.createTask(db, SCOPE, {
          title, details: str(a.details, 10000), projectId, workspaceId: projectId ? undefined : wsId(str(a.workspace)),
          dueDate: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null, priority: typeof a.priority === 'number' ? Math.max(0, Math.min(2, a.priority)) : 0,
        });
        return { id: t.id, title: t.title, project: t.project_title, workspace: t.workspace_name };
      },
    },
    complete_task: {
      description: 'Mark a task done.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: (a: Args) => {
        const t = projects.updateTask(db, SCOPE, str(a.id, 100) ?? '', { status: 'done' });
        return { id: t.id, status: t.status };
      },
    },
    create_note: {
      description: 'Create a Markdown note. Use origin "external" with source_url when summarising an email or meeting, so the original stays the source of truth.',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' }, body: { type: 'string' }, workspace: wsProp, tags: { type: 'array', items: { type: 'string' } }, origin: { type: 'string', enum: ['native', 'external', 'link'] }, source_url: { type: 'string' }, source_label: { type: 'string' } },
        required: ['title', 'body'],
      },
      run: (a: Args) => {
        const origin = (['native', 'external', 'link'] as const).find((o) => o === a.origin) ?? 'native';
        const n = notes.createNote(db, SCOPE, {
          workspaceId: wsId(str(a.workspace)), title: str(a.title, 300), body: str(a.body, 200000), origin,
          sourceUrl: str(a.source_url, 500) ?? null, sourceLabel: str(a.source_label, 500) ?? null,
          tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === 'string').slice(0, 20) : [],
        });
        return { id: n.id, title: n.title };
      },
    },
  } as Record<string, { description: string; inputSchema: object; run: (a: Args) => unknown }>;
}

export function mountMcp(app: Hono<any>, db: DB, token: string | undefined) {
  const t = tools(db);
  const ok = (given: string) => !!token && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));

  app.get('/mcp', (c) => c.json({ error: 'Use POST (MCP Streamable HTTP)' }, 405));
  app.post('/mcp', async (c) => {
    if (!token) return c.json({ error: 'MCP is not enabled (set MCP_TOKEN)' }, 503);
    const given = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? c.req.query('key') ?? '';
    if (!ok(given)) return c.json({ error: 'Unauthorized' }, 401);
    const msg = await c.req.json().catch(() => null);
    const handle = (m: { id?: unknown; method?: string; params?: { name?: string; arguments?: Args; protocolVersion?: string } }) => {
      const reply = (result: unknown) => ({ jsonrpc: '2.0', id: m.id, result });
      const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: m.id, error: { code, message } });
      if (m.id === undefined) return null; // notification
      switch (m.method) {
        case 'initialize':
          return reply({ protocolVersion: m.params?.protocolVersion ?? PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'brad-os', version: '0.2.0' },
            instructions: "Brad's private knowledge base (Work & Life only). Put things pulled from email, meetings or messages into the Inbox with `capture` unless Brad asks for a task or note." });
        case 'ping':
          return reply({});
        case 'tools/list':
          return reply({ tools: Object.entries(t).map(([name, d]) => ({ name, description: d.description, inputSchema: d.inputSchema })) });
        case 'tools/call': {
          const tool = t[m.params?.name ?? ''];
          if (!tool) return fail(-32602, `Unknown tool ${m.params?.name}`);
          try {
            return reply({ content: [{ type: 'text', text: JSON.stringify(tool.run(m.params?.arguments ?? {}), null, 2) }] });
          } catch (e) {
            return reply({ content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true });
          }
        }
        default:
          return fail(-32601, `Method not found: ${m.method}`);
      }
    };
    if (Array.isArray(msg)) {
      const out = msg.map(handle).filter(Boolean);
      return out.length ? c.json(out) : c.body(null, 202);
    }
    if (!msg || typeof msg !== 'object') return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
    const out = handle(msg);
    return out ? c.json(out) : c.body(null, 202);
  });
}
