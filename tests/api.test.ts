import { describe, it, expect, beforeEach } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { openDb, type DB } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { ensureWorkspaces, seedSample } from '../server/seed.ts';
import { toFtsQuery } from '../server/repo/search.ts';
import { parseMarkdown, serializeMarkdown } from '../server/markdown.ts';
import { parseCapture } from '../server/repo/inbox.ts';

const PASSWORD = 'correct-horse-battery';

function setup(seed = false) {
  const db = openDb(':memory:');
  ensureWorkspaces(db);
  if (seed) seedSample(db);
  const app = createApp({ db, password: PASSWORD, sessionSecret: 'test-secret-test-secret' });
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-brad-os': '1', cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data: data as any, headers: res.headers };
  };
  const login = () => call('POST', '/api/auth/login', { password: PASSWORD });
  return { db, app, call, login };
}

describe('auth', () => {
  it('rejects unauthenticated API access', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/notes')).status).toBe(401);
    expect((await call('GET', '/api/today')).status).toBe(401);
  });

  it('rejects a wrong password and accepts the right one', async () => {
    const { call, login } = setup();
    expect((await call('POST', '/api/auth/login', { password: 'nope' })).status).toBe(401);
    expect((await login()).status).toBe(200);
    expect((await call('GET', '/api/auth/me')).data.lens).toBe('work');
  });

  it('rate limits repeated failed logins', async () => {
    const { call } = setup();
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await call('POST', '/api/auth/login', { password: 'nope' })).status;
    expect(last).toBe(429);
  });

  it('requires the CSRF header on mutations', async () => {
    const { call, login } = setup();
    await login();
    const res = await call('POST', '/api/inbox', { body: 'hi' }, { 'x-brad-os': '' });
    expect(res.status).toBe(403);
  });

  it('rejects tampered session cookies', async () => {
    const { app } = setup();
    const res = await app.request('/api/notes', { headers: { cookie: 'bos_session=abc.def' } });
    expect(res.status).toBe(401);
  });

  it('logs out', async () => {
    const { call, login } = setup();
    await login();
    await call('POST', '/api/auth/logout');
    expect((await call('GET', '/api/notes')).status).toBe(401);
  });
});

describe('notes', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(async () => {
    t = setup();
    await t.login();
  });

  it('creates, reads, updates, trashes, restores and purges', async () => {
    const created = await t.call('POST', '/api/notes', { workspaceId: 'ws_personal', title: 'First', body: 'Hello **world**', tags: ['#Ideas', 'ideas', 'x'] });
    expect(created.status).toBe(201);
    expect(created.data.tags).toEqual(['ideas', 'x']);
    expect(created.data.origin).toBe('native');
    const id = created.data.id;

    const upd = await t.call('PATCH', `/api/notes/${id}`, { body: 'Changed', favorite: true, tags: ['ideas'] });
    expect(upd.data.body).toBe('Changed');
    expect(upd.data.favorite).toBe(1);
    expect((await t.call('GET', '/api/tags')).data).toEqual([{ name: 'ideas', count: 1 }]);

    expect((await t.call('DELETE', `/api/notes/${id}?permanent=1`)).status).toBe(400); // must trash first
    await t.call('DELETE', `/api/notes/${id}`);
    expect((await t.call('GET', '/api/notes')).data).toHaveLength(0);
    expect((await t.call('GET', '/api/notes?trash=1')).data).toHaveLength(1);
    await t.call('POST', `/api/notes/${id}/restore`);
    expect((await t.call('GET', '/api/notes')).data).toHaveLength(1);
    await t.call('DELETE', `/api/notes/${id}`);
    expect((await t.call('DELETE', `/api/notes/${id}?permanent=1`)).status).toBe(200);
    expect((await t.call('GET', `/api/notes/${id}`)).status).toBe(404);
  });

  it('files notes into nested folders and keeps notes when a folder is deleted', async () => {
    const parent = (await t.call('POST', '/api/folders', { workspaceId: 'ws_dev', name: 'Parent' })).data;
    const child = (await t.call('POST', '/api/folders', { workspaceId: 'ws_dev', parentId: parent.id, name: 'Child' })).data;
    const note = (await t.call('POST', '/api/notes', { workspaceId: 'ws_dev', folderId: child.id, title: 'Filed' })).data;
    expect((await t.call('GET', `/api/notes?folder=${child.id}`)).data).toHaveLength(1);
    // cycle prevention
    expect((await t.call('PATCH', `/api/folders/${parent.id}`, { parentId: child.id })).status).toBe(400);
    // folder from another workspace is rejected
    expect((await t.call('POST', '/api/notes', { workspaceId: 'ws_personal', folderId: child.id, title: 'x' })).status).toBe(400);
    await t.call('DELETE', `/api/folders/${parent.id}`);
    const after = (await t.call('GET', `/api/notes/${note.id}`)).data;
    expect(after.folder_id).toBeNull();
  });

  it('resolves wiki-link titles case-insensitively', async () => {
    const n = (await t.call('POST', '/api/notes', { workspaceId: 'ws_personal', title: 'Big Idea' })).data;
    const r = (await t.call('POST', '/api/notes/resolve', { titles: ['big idea', 'missing'] })).data;
    expect(r).toEqual({ 'big idea': n.id });
  });
});

describe('search', () => {
  it('builds safe FTS queries', () => {
    expect(toFtsQuery('hello wor')).toBe('"hello" "wor"*');
    // Every term ends up inside double quotes, so no FTS operator syntax survives.
    expect(toFtsQuery('"); DROP TABLE notes; --')).toMatch(/^("[^"]+"\*?)( "[^"]+"\*?)*$/);
    expect(toFtsQuery('   ')).toBeNull();
    expect(toFtsQuery('NOT OR AND')).toBeNull();
  });

  it('finds notes, projects, tasks and captures with prefix matching', async () => {
    const t = setup();
    await t.login();
    await t.call('POST', '/api/notes', { workspaceId: 'ws_personal', title: 'Quarterly planning', body: 'zebra crossing ideas' });
    const p = (await t.call('POST', '/api/projects', { workspaceId: 'ws_runnit', title: 'Zebra launch' })).data;
    await t.call('POST', '/api/tasks', { projectId: p.id, title: 'Zebra checklist' });
    await t.call('POST', '/api/inbox', { body: 'zebras are striped' });
    const hits = (await t.call('GET', '/api/search?q=zeb')).data;
    expect(hits.map((h: any) => h.type).sort()).toEqual(['capture', 'note', 'project', 'task']);
    const onlyNotes = (await t.call('GET', '/api/search?q=zebra&types=note')).data;
    expect(onlyNotes).toHaveLength(1);
    // Trashed notes drop out of search
    const n = (await t.call('GET', '/api/search?q=quarterly')).data[0];
    await t.call('DELETE', `/api/notes/${n.id}`);
    expect((await t.call('GET', '/api/search?q=quarterly')).data).toHaveLength(0);
  });

  it('handles hostile input without errors', async () => {
    const t = setup();
    await t.login();
    for (const q of ['"', '*', 'a OR', '((', 'NEAR(a b)', '-x', 'title:foo']) {
      expect((await t.call('GET', `/api/search?q=${encodeURIComponent(q)}`)).status).toBe(200);
    }
  });
});

describe('family privacy boundary', () => {
  async function familyNote(t: ReturnType<typeof setup>) {
    await t.call('POST', '/api/auth/lens', { lens: 'family', password: PASSWORD });
    const n = (await t.call('POST', '/api/notes', { workspaceId: 'ws_family', title: 'Private family plan', body: 'secretword', tags: ['homeonly'] })).data;
    await t.call('POST', '/api/auth/lens', { lens: 'work' });
    return n;
  }

  it('needs the password to enter the family lens', async () => {
    const t = setup();
    await t.login();
    expect((await t.call('POST', '/api/auth/lens', { lens: 'family' })).status).toBe(401);
    expect((await t.call('POST', '/api/auth/lens', { lens: 'family', password: 'wrong' })).status).toBe(401);
    const ok = await t.call('POST', '/api/auth/lens', { lens: 'family', password: PASSWORD });
    expect(ok.data.lens).toBe('family');
    expect(ok.data.lensUntil).toBeTruthy();
  });

  it('hides family workspaces, notes, tags, search hits and exports from the work lens', async () => {
    const t = setup();
    await t.login();
    const n = await familyNote(t);
    const ws = (await t.call('GET', '/api/workspaces')).data.map((w: any) => w.id);
    expect(ws).not.toContain('ws_family');
    expect(ws).not.toContain('ws_gibbons-crew');
    expect((await t.call('GET', `/api/notes/${n.id}`)).status).toBe(404);
    expect((await t.call('PATCH', `/api/notes/${n.id}`, { title: 'x' })).status).toBe(404);
    expect((await t.call('DELETE', `/api/notes/${n.id}`)).status).toBe(404);
    expect((await t.call('GET', '/api/search?q=secretword')).data).toHaveLength(0);
    expect((await t.call('GET', '/api/tags')).data).toHaveLength(0);
    expect((await t.call('GET', '/api/notes')).data).toHaveLength(0);
    const today = (await t.call('GET', '/api/today')).data;
    expect(JSON.stringify(today)).not.toContain('secretword');
    expect(JSON.stringify(today)).not.toContain('Private family plan');
    const zip = unzipSync(new Uint8Array((await t.call('GET', '/api/export')).data));
    expect(Object.values(zip).map((u) => strFromU8(u)).join('\n')).not.toContain('secretword');
  });

  it('rejects writing into a family workspace from the work lens', async () => {
    const t = setup();
    await t.login();
    expect((await t.call('POST', '/api/notes', { workspaceId: 'ws_family', title: 'x' })).status).toBe(404);
    expect((await t.call('POST', '/api/projects', { workspaceId: 'ws_gibbons-crew', title: 'x' })).status).toBe(404);
    expect((await t.call('POST', '/api/import', { workspaceId: 'ws_family', files: [{ name: 'a.md', content: 'x' }] })).status).toBe(404);
  });

  it('the work lens is hidden from the family lens too', async () => {
    const t = setup();
    await t.login();
    const w = (await t.call('POST', '/api/notes', { workspaceId: 'ws_runnit', title: 'Work only', body: 'invoice' })).data;
    await t.call('POST', '/api/auth/lens', { lens: 'family', password: PASSWORD });
    expect((await t.call('GET', `/api/notes/${w.id}`)).status).toBe(404);
    expect((await t.call('GET', '/api/search?q=invoice')).data).toHaveLength(0);
  });

  it('database triggers block cross-boundary links even if app code is bypassed', () => {
    const { db } = setup();
    db.exec("INSERT INTO projects (id, workspace_id, title) VALUES ('p_work', 'ws_runnit', 'Work project')");
    db.exec("INSERT INTO notes (id, workspace_id, title) VALUES ('n_fam', 'ws_family', 'Family note')");
    expect(() => db.exec("UPDATE notes SET project_id = 'p_work' WHERE id = 'n_fam'")).toThrow(/boundary/);
    expect(() => db.exec("UPDATE notes SET workspace_id = 'ws_personal' WHERE id = 'n_fam'")).toThrow(/boundary/);
    expect(() => db.exec("INSERT INTO tasks (id, workspace_id, project_id, title) VALUES ('t1', 'ws_family', 'p_work', 'x')")).toThrow(/boundary/);
    expect(() => db.exec("UPDATE workspaces SET boundary = 'work' WHERE id = 'ws_family'")).toThrow(/boundary/);
    expect(() => db.exec("UPDATE workspaces SET kind = 'business' WHERE id = 'ws_family'")).toThrow();
    db.exec("INSERT INTO tags (id, boundary, name) VALUES ('tg_w', 'work', 'shared')");
    expect(() => db.exec("INSERT INTO note_tags (note_id, tag_id) VALUES ('n_fam', 'tg_w')")).toThrow(/boundary/);
    expect(() => db.exec("INSERT INTO captures (id, boundary, workspace_id, body) VALUES ('c1', 'work', 'ws_family', 'x')")).toThrow(/boundary/);
  });

  it('the family lens expires', async () => {
    const t = setup();
    await t.login();
    await t.call('POST', '/api/auth/lens', { lens: 'family', password: PASSWORD });
    t.db.exec("UPDATE sessions SET lens_until = '2000-01-01T00:00:00.000Z'");
    expect((await t.call('GET', '/api/auth/me')).data.lens).toBe('work');
  });
});

describe('projects, tasks and inbox', () => {
  it('runs a project workflow end to end', async () => {
    const t = setup();
    await t.login();
    const p = (await t.call('POST', '/api/projects', { workspaceId: 'ws_softr', title: 'Launch', nextAction: 'Write brief' })).data;
    const task = (await t.call('POST', '/api/tasks', { projectId: p.id, title: 'Brief', dueDate: '2030-01-01' })).data;
    expect(task.workspace_id).toBe('ws_softr');
    await t.call('POST', '/api/notes', { workspaceId: 'ws_softr', projectId: p.id, title: 'Research' });
    await t.call('PATCH', `/api/tasks/${task.id}`, { status: 'done' });
    const detail = (await t.call('GET', `/api/projects/${p.id}`)).data;
    expect(detail.project.done_tasks).toBe(1);
    expect(detail.notes).toHaveLength(1);
    expect(detail.activity.length).toBeGreaterThan(0);
    // moving a project carries its tasks
    await t.call('PATCH', `/api/projects/${p.id}`, { workspaceId: 'ws_cyph-media' });
    expect((await t.call('GET', `/api/tasks?project=${p.id}&done=1`)).data[0].workspace_id).toBe('ws_cyph-media');
    // deleting a project keeps its notes
    await t.call('DELETE', `/api/projects/${p.id}`);
    expect((await t.call('GET', '/api/notes')).data).toHaveLength(1);
    expect((await t.call('GET', '/api/tasks?done=1')).data).toHaveLength(0);
  });

  it('captures, converts and archives inbox items', async () => {
    const t = setup();
    await t.login();
    const c = (await t.call('POST', '/api/inbox', { body: 'Read later https://example.com/a #reading' })).data;
    expect(c.url).toBe('https://example.com/a');
    expect(c.tags).toBe('reading');
    const r = (await t.call('POST', `/api/inbox/${c.id}/convert`, { to: 'note', workspaceId: 'ws_personal' })).data;
    const note = (await t.call('GET', `/api/notes/${r.id}`)).data;
    expect(note.title).toBe('Read later');
    expect(note.source_url).toBe('https://example.com/a');
    expect(note.tags).toEqual(['reading']);
    expect((await t.call('GET', '/api/inbox')).data).toHaveLength(0);
    expect((await t.call('GET', '/api/inbox?status=converted')).data).toHaveLength(1);
    expect((await t.call('POST', `/api/inbox/${c.id}/convert`, { to: 'note', workspaceId: 'ws_personal' })).status).toBe(400);

    const c2 = (await t.call('POST', '/api/inbox', { body: 'Call the printer' })).data;
    const r2 = (await t.call('POST', `/api/inbox/${c2.id}/convert`, { to: 'task', workspaceId: 'ws_city-ink' })).data;
    expect(r2.type).toBe('task');
    const c3 = (await t.call('POST', '/api/inbox', { body: 'Old idea' })).data;
    await t.call('PATCH', `/api/inbox/${c3.id}`, { status: 'archived' });
    expect((await t.call('GET', '/api/inbox?status=archived')).data).toHaveLength(1);
    expect((await t.call('POST', '/api/inbox', { body: '   ' })).status).toBe(400);
  });

  it('a failed conversion leaves the capture untouched', async () => {
    const t = setup();
    await t.login();
    const c = (await t.call('POST', '/api/inbox', { body: 'x' })).data;
    expect((await t.call('POST', `/api/inbox/${c.id}/convert`, { to: 'task', workspaceId: 'ws_personal', projectId: 'nope' })).status).toBe(404);
    expect((await t.call('GET', '/api/inbox')).data).toHaveLength(1);
  });
});

describe('markdown import/export', () => {
  it('round-trips frontmatter', () => {
    const md = serializeMarkdown({ title: 'A: B', tags: ['x', 'y'], empty: '' }, 'Body\n');
    const { meta, body } = parseMarkdown(md);
    expect(meta.title).toBe('A: B');
    expect(meta.tags).toEqual(['x', 'y']);
    expect(body).toBe('Body\n');
    expect(parseMarkdown('---\ntags:\n  - one\n  - two\n---\nhi').meta.tags).toEqual(['one', 'two']);
  });

  it('imports files as marked copies and exports a zip', async () => {
    const t = setup();
    await t.login();
    const res = await t.call('POST', '/api/import', {
      workspaceId: 'ws_dev',
      files: [
        { name: 'with-front.md', content: '---\ntitle: Front Title\ntags: [a, b]\n---\nBody one' },
        { name: 'heading.md', content: '# From Heading\n\ntext' },
        { name: 'plain.txt', content: 'just text' },
      ],
    });
    expect(res.status).toBe(201);
    const list = (await t.call('GET', '/api/notes?sort=title')).data;
    expect(list.map((n: any) => n.title)).toEqual(['From Heading', 'Front Title', 'plain']);
    expect(list.every((n: any) => n.origin === 'imported')).toBe(true);
    expect(list.find((n: any) => n.title === 'Front Title').tags).toEqual(['a', 'b']);
    expect((await t.call('POST', '/api/import', { workspaceId: 'ws_dev', files: [{ name: 'x.exe', content: '' }] })).status).toBe(400);

    const zipRes = await t.call('GET', '/api/export');
    const zip = unzipSync(new Uint8Array(zipRes.data));
    const paths = Object.keys(zip);
    expect(paths).toContain('manifest.json');
    expect(paths).toContain('Development & experiments/Front Title.md');
    expect(strFromU8(zip['Development & experiments/Front Title.md'])).toContain('origin: imported');
  });
});

describe('sample data', () => {
  it('seeds once, shows on Today, and can be removed without touching user data', async () => {
    const t = setup(true);
    expect(seedSample(t.db)).toBe(false);
    await t.login();
    const today = (await t.call('GET', '/api/today')).data;
    expect(today.counts.notes).toBeGreaterThan(3);
    expect(today.activeProjects.length).toBeGreaterThan(0);
    const mine = (await t.call('POST', '/api/notes', { workspaceId: 'ws_personal', title: 'Mine' })).data;
    await t.call('POST', '/api/sample/remove');
    const left = (await t.call('GET', '/api/notes')).data;
    expect(left.map((n: any) => n.id)).toEqual([mine.id]);
    // family sample stays until removed from the family lens
    await t.call('POST', '/api/auth/lens', { lens: 'family', password: PASSWORD });
    expect((await t.call('GET', '/api/notes')).data).toHaveLength(1);
  });

  it('sample data contains no real-family details', () => {
    const { db } = setup(true);
    const text = JSON.stringify(db.prepare('SELECT title, body FROM notes').all()).toLowerCase();
    for (const banned of ['custody', 'court', 'solicitor', 'daughter']) expect(text).not.toContain(banned);
  });
});

describe('capture parsing', () => {
  it('extracts url and hashtags', () => {
    expect(parseCapture('see https://x.io/p?q=1 #One #two #one')).toEqual({ url: 'https://x.io/p?q=1', tags: ['one', 'two'] });
  });
});

export type { DB };
