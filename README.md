# BRAD OS

Private knowledge engine: notes, captures, projects, tasks and search in one place, with a hard
privacy boundary between **Work & Life** and **Family**.

**Phase 1 (this release):** app shell, Today dashboard, Inbox quick capture, Markdown notes with
autosave and `[[wiki links]]`, nested folders, tags, pinned notes, trash, projects with tasks and next
actions, a Tasks view, full-text search (⌘K palette + search page), Markdown import/export, light/dark.

## Run it locally

```bash
npm install
npm run dev          # API on :3000, web on :5173 (password: brad-os-dev)
```

Production-style:

```bash
npm run build
BRAD_OS_PASSWORD='a long passphrase' SESSION_SECRET=$(openssl rand -hex 32) npm start
```

## Tests

```bash
npm test             # API, privacy boundary, search, import/export (vitest)
npm run typecheck
npm run build && npm run e2e   # drives the real UI in Chromium (needs Playwright installed globally)
```

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `BRAD_OS_PASSWORD` | yes (prod) | The single owner password |
| `SESSION_SECRET` | yes (prod) | Signs session cookies (32+ random bytes) |
| `DATA_DIR` | no | Where `brad-os.db` lives. On Railway, mount a volume at `/data` and set `DATA_DIR=/data` |
| `SEED_SAMPLE` | no | `false` to skip the made-up sample records on first run |

No API keys, no paid services. Secrets live only in environment variables.

## Architecture

- **Server:** Node 22 + [Hono](https://hono.dev), TypeScript run directly via Node's type stripping (no build step).
- **Storage:** SQLite through Node's built-in `node:sqlite` (no native modules) with WAL and an FTS5 full-text index.
- **Web:** React 19 + Vite + TanStack Query. Self-hosted fonts; strict CSP.
- **Auth:** one owner password (scrypt-compared), server-side sessions, `HttpOnly; SameSite=Strict` cookies,
  CSRF header check, login rate limiting.

```
server/
  db.ts          schema, boundary triggers, FTS index
  auth.ts        sessions + family lens
  app.ts         HTTP API (zod-validated)
  repo/          data access — every function takes a Scope
  markdown.ts    frontmatter import/export
  seed.ts        workspaces + made-up sample data
src/             React app (pages/, components/)
tests/           vitest API tests + Playwright smoke test
```

## Privacy model (enforced in the database)

- Every workspace has a fixed boundary: `work` or `family`. *Family* and *The Gibbons Crew* are family.
- Every request runs under one boundary (the session's "lens"). There is no query path that reads both.
- SQLite triggers reject any link across boundaries (note→project, note→folder, task→project, tag→note,
  capture→workspace) and forbid changing a workspace's boundary, even if application code is bypassed.
- Tags are per-boundary, so tag names never leak.
- Entering the Family lens re-asks for the password and expires after 60 minutes.
- Records outside your lens return 404, not 403, so their existence isn't revealed.
- Family photos and reference sheets stay in Google Drive. They are never stored here, in seed data or in tests.

## Data ownership

Every note records its **origin**: `native` (written here), `external` (pointer to an original elsewhere,
e.g. Drive), `imported` (a copy; the original is untouched), `link`, or `ai` (Phase 3, always labelled).
BRAD OS never syncs, overwrites or deletes anything outside itself. Integrations (Phase 4) are not connected.

## Roadmap

- **Phase 2:** backlinks, related notes, knowledge graph, advanced search, document indexing, source references.
- **Phase 3:** source-grounded AI search and summaries, suggested categories/relationships — all changes need approval.
- **Phase 4:** Google Drive, Calendar, Gmail, GitHub via modular integrations, once real OAuth exists.
