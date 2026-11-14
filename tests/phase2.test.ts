import { describe, it, expect } from 'vitest';
import { openDb } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { ensureWorkspaces } from '../server/seed.ts';

const PW = 'correct-horse-battery';
function setup() {
  const db = openDb(':memory:');
  ensureWorkspaces(db);
  const app = createApp({ db, password: PW, sessionSecret: 'test-secret-test-secret', mcpToken: 'tok-123' });
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-brad-os': '1', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null } as { status: number; data: any };
  };
  return { db, call };
}

describe('backlinks, related, graph', () => {
  it('finds backlinks, related notes and builds a graph inside one boundary', async () => {
    const { call } = setup();
    await call('POST', '/api/auth/login', { password: PW });
    const a = (await call('POST', '/api/notes', { workspaceId: 'ws_runnit', title: 'Pricing Plan', body: 'founding price', tags: ['pricing'] })).data;
    const b = (await call('POST', '/api/notes', { workspaceId: 'ws_runnit', title: 'Deck', body: 'See [[pricing plan|the plan]].', tags: ['pricing'] })).data;
    await call('POST', '/api/notes', { workspaceId: 'ws_dev', title: 'Unrelated', body: 'nothing' });
    expect((await call('GET', `/api/notes/${a.id}/backlinks`)).data.map((n: any) => n.id)).toEqual([b.id]);
    const rel = (await call('GET', `/api/notes/${a.id}/related`)).data;
    expect(rel[0].id).toBe(b.id);
    expect(rel[0].reasons).toContain('linked');
    const g = (await call('GET', '/api/graph')).data;
    expect(g.edges).toContainEqual({ source: b.id, target: a.id, type: 'link' });
    expect(g.nodes.some((n: any) => n.id === 'ws_family')).toBe(false);
  });

  it('family notes never appear as backlinks or graph nodes in the work lens', async () => {
    const { call } = setup();
    await call('POST', '/api/auth/login', { password: PW });
    const w = (await call('POST', '/api/notes', { workspaceId: 'ws_personal', title: 'Shared Title' })).data;
    await call('POST', '/api/auth/lens', { lens: 'family', password: PW });
    await call('POST', '/api/notes', { workspaceId: 'ws_family', title: 'Fam', body: '[[Shared Title]]' });
    await call('POST', '/api/auth/lens', { lens: 'work' });
    expect((await call('GET', `/api/notes/${w.id}/backlinks`)).data).toEqual([]);
    expect(JSON.stringify((await call('GET', '/api/graph')).data)).not.toContain('Fam');
  });
});

describe('MCP endpoint', () => {
  const rpc = (call: any, method: string, params?: unknown, key = 'tok-123') =>
    call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params }, { authorization: `Bearer ${key}` });

  it('requires the token', async () => {
    const { call } = setup();
    expect((await rpc(call, 'tools/list', undefined, 'wrong')).status).toBe(401);
  });

  it('initializes, lists tools, captures, dedupes tasks, and never sees family data', async () => {
    const { call } = setup();
    expect((await rpc(call, 'initialize', { protocolVersion: '2025-06-18' })).data.result.serverInfo.name).toBe('brad-os');
    const names = (await rpc(call, 'tools/list')).data.result.tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(['today', 'search', 'capture', 'create_task', 'create_note']));
    const cap = await rpc(call, 'tools/call', { name: 'capture', arguments: { text: 'From Gmail: invoice from printer' } });
    expect(cap.data.result.content[0].text).toContain('in inbox');
    const again = await rpc(call, 'tools/call', { name: 'capture', arguments: { text: 'From Gmail: invoice from printer' } });
    expect(again.data.result.content[0].text).toContain('already in inbox');
    await rpc(call, 'tools/call', { name: 'create_task', arguments: { title: 'Call Johnny', workspace: 'Runnit' } });
    const dup = await rpc(call, 'tools/call', { name: 'create_task', arguments: { title: 'call johnny' } });
    expect(dup.data.result.content[0].text).toContain('duplicate');
    const bad = await rpc(call, 'tools/call', { name: 'create_task', arguments: { title: 'x', workspace: 'Family' } });
    expect(bad.data.result.isError).toBe(true);
    const ok = await call('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'ping' }, {});
    expect(ok.status).toBe(401);
    expect((await call('POST', '/mcp?key=tok-123', { jsonrpc: '2.0', id: 2, method: 'ping' })).status).toBe(200);
  });
});

describe('Yumi → Family ingest', () => {
  const mk = () => {
    const db = openDb(':memory:');
    ensureWorkspaces(db);
    const app = createApp({ db, password: PW, sessionSecret: 'test-secret-test-secret', familyIngestToken: 'fam-tok' });
    const post = (body: unknown, token = 'fam-tok') => app.request('/ingest/family', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { db, app, post };
  };

  it('rejects a wrong token and works without any session', async () => {
    const { post } = mk();
    expect((await post({ items: [] }, 'nope')).status).toBe(401);
    expect((await post({ items: [] })).status).toBe(200);
  });

  it('creates Family tasks/captures, dedupes by id, and ignores extra fields', async () => {
    const { db, post } = mk();
    const items = [
      { id: 'event:1', kind: 'event', title: 'Dance class', who: 'Sam', due: '2030-02-03', at: '2030-02-03T16:00:00Z', diary: 'SECRET' },
      { id: 'task:2', kind: 'task', title: 'Tidy room' },
      { id: 'reward:3', kind: 'reward', title: 'Extra screen time' },
      { id: 'bad', kind: 'diary', title: 'x' },
    ];
    expect(await (await post({ items })).json()).toEqual({ added: 3, skipped: 1 });
    expect(await (await post({ items })).json()).toEqual({ added: 0, skipped: 4 });
    const t = db.prepare("SELECT t.title, t.details, w.boundary FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE t.ext_id = 'yumi:event:1'").get() as any;
    expect(t.boundary).toBe('family');
    expect(t.title).toContain('Dance class');
    expect(JSON.stringify(db.prepare('SELECT * FROM tasks').all())).not.toContain('SECRET');
    expect((db.prepare("SELECT boundary FROM captures WHERE ext_id = 'yumi:reward:3'").get() as any).boundary).toBe('family');
  });

  it('never appears in the Work & Life lens', async () => {
    const { db, app, post } = mk();
    await post({ items: [{ id: 'task:9', kind: 'task', title: 'Family only thing' }] });
    const call = async (method: string, path: string, body?: unknown) => {
      const r = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-brad-os': '1', cookie: cookieRef.v }, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = r.headers.get('set-cookie'); if (set) cookieRef.v = set.split(';')[0];
      return r.json() as Promise<any>;
    };
    const cookieRef = { v: '' };
    await call('POST', '/api/auth/login', { password: PW });
    expect(JSON.stringify(await call('GET', '/api/tasks'))).not.toContain('Family only thing');
    expect(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE ext_id LIKE 'yumi:%'").get()).toEqual({ n: 1 });
  });
});
