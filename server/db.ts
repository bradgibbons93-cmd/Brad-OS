import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

/**
 * BRAD OS schema.
 *
 * PRIVACY MODEL — enforced in the database, not just the UI:
 *  - Every workspace has a `boundary`: 'work' or 'family'.
 *  - Every record belongs (directly or via its workspace) to exactly one boundary.
 *  - Triggers reject any link that crosses a boundary (note→folder, note→project,
 *    task→project, tag→note, capture→workspace). A family note can never be filed
 *    in a business project, tagged with a work tag, or vice versa.
 *  - Tags are per-boundary, so even tag *names* never leak across.
 *  - The search index stores the boundary on every row; queries always filter by it.
 *
 * DATA OWNERSHIP — every note carries an `origin`:
 *   native   = written in BRAD OS
 *   external = reference to an external source document (canonical copy lives elsewhere, e.g. Google Drive)
 *   imported = an imported copy of an external file (the original is untouched)
 *   link     = bookmark / web link
 *   ai       = AI-generated summary or interpretation (Phase 3)
 */
const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('business','personal','dev','family')),
  boundary TEXT NOT NULL CHECK (boundary IN ('work','family')),
  color TEXT NOT NULL DEFAULT '#d9a35b',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((kind = 'family') = (boundary = 'family'))
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planning','active','paused','done')),
  next_action TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Untitled',
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','decision','research','meeting','reference','person','business')),
  origin TEXT NOT NULL DEFAULT 'native' CHECK (origin IN ('native','external','imported','link','ai')),
  source_url TEXT,
  source_label TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  sample INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  accessed_at TEXT
);
CREATE INDEX IF NOT EXISTS notes_ws ON notes(workspace_id, updated_at);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  boundary TEXT NOT NULL CHECK (boundary IN ('work','family')),
  name TEXT NOT NULL COLLATE NOCASE,
  UNIQUE (boundary, name)
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 2),
  due_date TEXT,
  sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  boundary TEXT NOT NULL CHECK (boundary IN ('work','family')),
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  url TEXT,
  tags TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox','archived','converted')),
  converted_type TEXT,
  converted_id TEXT,
  sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  boundary TEXT NOT NULL CHECK (boundary IN ('work','family')),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  lens TEXT NOT NULL DEFAULT 'work' CHECK (lens IN ('work','family')),
  lens_until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);

-- ── Boundary guards ─────────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS guard_folder_parent BEFORE INSERT ON folders
WHEN NEW.parent_id IS NOT NULL AND (SELECT workspace_id FROM folders WHERE id = NEW.parent_id) <> NEW.workspace_id
BEGIN SELECT RAISE(ABORT, 'boundary: folder parent must be in the same workspace'); END;

CREATE TRIGGER IF NOT EXISTS guard_folder_parent_u BEFORE UPDATE OF parent_id, workspace_id ON folders
WHEN NEW.parent_id IS NOT NULL AND (SELECT workspace_id FROM folders WHERE id = NEW.parent_id) <> NEW.workspace_id
BEGIN SELECT RAISE(ABORT, 'boundary: folder parent must be in the same workspace'); END;

CREATE TRIGGER IF NOT EXISTS guard_note_links BEFORE INSERT ON notes
WHEN (NEW.folder_id IS NOT NULL AND (SELECT workspace_id FROM folders WHERE id = NEW.folder_id) <> NEW.workspace_id)
  OR (NEW.project_id IS NOT NULL AND (SELECT boundary FROM workspaces w JOIN projects p ON p.workspace_id = w.id WHERE p.id = NEW.project_id)
       <> (SELECT boundary FROM workspaces WHERE id = NEW.workspace_id))
BEGIN SELECT RAISE(ABORT, 'boundary: note links must stay inside one boundary'); END;

CREATE TRIGGER IF NOT EXISTS guard_note_links_u BEFORE UPDATE OF folder_id, project_id, workspace_id ON notes
WHEN (NEW.folder_id IS NOT NULL AND (SELECT workspace_id FROM folders WHERE id = NEW.folder_id) <> NEW.workspace_id)
  OR (NEW.project_id IS NOT NULL AND (SELECT boundary FROM workspaces w JOIN projects p ON p.workspace_id = w.id WHERE p.id = NEW.project_id)
       <> (SELECT boundary FROM workspaces WHERE id = NEW.workspace_id))
  OR ((SELECT boundary FROM workspaces WHERE id = NEW.workspace_id) <> (SELECT boundary FROM workspaces WHERE id = OLD.workspace_id))
BEGIN SELECT RAISE(ABORT, 'boundary: note links must stay inside one boundary'); END;

CREATE TRIGGER IF NOT EXISTS guard_note_tags BEFORE INSERT ON note_tags
WHEN (SELECT boundary FROM tags WHERE id = NEW.tag_id)
  <> (SELECT w.boundary FROM notes n JOIN workspaces w ON w.id = n.workspace_id WHERE n.id = NEW.note_id)
BEGIN SELECT RAISE(ABORT, 'boundary: tag and note must share a boundary'); END;

CREATE TRIGGER IF NOT EXISTS guard_task_project BEFORE INSERT ON tasks
WHEN NEW.project_id IS NOT NULL AND (SELECT workspace_id FROM projects WHERE id = NEW.project_id) <> NEW.workspace_id
BEGIN SELECT RAISE(ABORT, 'boundary: task must be in its project''s workspace'); END;

CREATE TRIGGER IF NOT EXISTS guard_task_project_u BEFORE UPDATE OF project_id, workspace_id ON tasks
WHEN (NEW.project_id IS NOT NULL AND (SELECT workspace_id FROM projects WHERE id = NEW.project_id) <> NEW.workspace_id)
  OR ((SELECT boundary FROM workspaces WHERE id = NEW.workspace_id) <> (SELECT boundary FROM workspaces WHERE id = OLD.workspace_id))
BEGIN SELECT RAISE(ABORT, 'boundary: task must be in its project''s workspace'); END;

CREATE TRIGGER IF NOT EXISTS guard_project_move BEFORE UPDATE OF workspace_id ON projects
WHEN (SELECT boundary FROM workspaces WHERE id = NEW.workspace_id) <> (SELECT boundary FROM workspaces WHERE id = OLD.workspace_id)
BEGIN SELECT RAISE(ABORT, 'boundary: a project cannot move across boundaries'); END;

CREATE TRIGGER IF NOT EXISTS guard_capture_ws BEFORE INSERT ON captures
WHEN NEW.workspace_id IS NOT NULL AND (SELECT boundary FROM workspaces WHERE id = NEW.workspace_id) <> NEW.boundary
BEGIN SELECT RAISE(ABORT, 'boundary: capture workspace must match its boundary'); END;

CREATE TRIGGER IF NOT EXISTS guard_capture_ws_u BEFORE UPDATE OF workspace_id, boundary ON captures
WHEN (NEW.workspace_id IS NOT NULL AND (SELECT boundary FROM workspaces WHERE id = NEW.workspace_id) <> NEW.boundary)
  OR NEW.boundary <> OLD.boundary
BEGIN SELECT RAISE(ABORT, 'boundary: capture workspace must match its boundary'); END;

CREATE TRIGGER IF NOT EXISTS guard_workspace_boundary BEFORE UPDATE OF boundary ON workspaces
WHEN NEW.boundary <> OLD.boundary
BEGIN SELECT RAISE(ABORT, 'boundary: a workspace boundary cannot change'); END;

-- ── Unified full-text index ─────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  title, body,
  etype UNINDEXED, eid UNINDEXED, boundary UNINDEXED, workspace_id UNINDEXED,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS si_note_i AFTER INSERT ON notes WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO search_index (title, body, etype, eid, boundary, workspace_id)
  VALUES (NEW.title, NEW.body, 'note', NEW.id, (SELECT boundary FROM workspaces WHERE id = NEW.workspace_id), NEW.workspace_id);
END;
CREATE TRIGGER IF NOT EXISTS si_note_u AFTER UPDATE ON notes BEGIN
  DELETE FROM search_index WHERE etype = 'note' AND eid = OLD.id;
  INSERT INTO search_index (title, body, etype, eid, boundary, workspace_id)
  SELECT NEW.title, NEW.body, 'note', NEW.id, (SELECT boundary FROM workspaces WHERE id = NEW.workspace_id), NEW.workspace_id
  WHERE NEW.deleted_at IS NULL;
END;
CREATE TRIGGER IF NOT EXISTS si_note_d AFTER DELETE ON notes BEGIN
  DELETE FROM search_index WHERE etype = 'note' AND eid = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS si_project_i AFTER INSERT ON projects BEGIN
  INSERT INTO search_index (title, body, etype, eid, boundary, workspace_id)
  VALUES (NEW.title, NEW.summary || ' ' || NEW.next_action, 'project', NEW.id, (SELECT boundary FROM workspaces WHERE id = NEW.workspace_id), NEW.workspace_id);
END;
CREATE TRIGGER IF NOT EXISTS si_project_u AFTER UPDATE ON projects BEGIN
  DELETE FROM search_index WHERE etype = 'project' AND eid = OLD.id;
  INSERT INTO search_index (title, body, etype, eid, boundary, workspace_id)
  VALUES (NEW.title, NEW.summary || ' ' || NEW.next_action, 'project', NEW.id, (SELECT boundary FROM workspaces WHERE id = NEW.workspace_id), NEW.workspace_id);
END;
CREATE TRIGGER IF NOT EXISTS si_project_d AFTER DELETE ON projects BEGIN
  DELETE FROM search_index WHERE etype = 'project' AND eid = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS si_task_i AFTER INSERT ON tasks BEGIN
  INSERT INTO search_index (title, body, etype, eid, boundary, workspace_id)
  VALUES (NEW.title, NEW.details, 'task', NEW.id, (SELECT boundary FROM workspaces WHERE id = NEW.workspace_id), NEW.workspace_id);
END;
CREATE TRIGGER IF NOT EXISTS si_task_u AFTER UPDATE ON tasks BEGIN
  DELETE FROM search_index WHERE etype = 'task' AND eid = OLD.id;
  INSERT INTO search_index (title, body, etype, eid, boundary, workspace_id)
  VALUES (NEW.title, NEW.details, 'task', NEW.id, (SELECT boundary FROM workspaces WHERE id = NEW.workspace_id), NEW.workspace_id);
END;
CREATE TRIGGER IF NOT EXISTS si_task_d AFTER DELETE ON tasks BEGIN
  DELETE FROM search_index WHERE etype = 'task' AND eid = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS si_capture_i AFTER INSERT ON captures WHEN NEW.status = 'inbox' BEGIN
  INSERT INTO search_index (title, body, etype, eid, boundary, workspace_id)
  VALUES ('', NEW.body || ' ' || COALESCE(NEW.url, '') || ' ' || NEW.tags, 'capture', NEW.id, NEW.boundary, NEW.workspace_id);
END;
CREATE TRIGGER IF NOT EXISTS si_capture_u AFTER UPDATE ON captures BEGIN
  DELETE FROM search_index WHERE etype = 'capture' AND eid = OLD.id;
  INSERT INTO search_index (title, body, etype, eid, boundary, workspace_id)
  SELECT '', NEW.body || ' ' || COALESCE(NEW.url, '') || ' ' || NEW.tags, 'capture', NEW.id, NEW.boundary, NEW.workspace_id
  WHERE NEW.status = 'inbox';
END;
CREATE TRIGGER IF NOT EXISTS si_capture_d AFTER DELETE ON captures BEGIN
  DELETE FROM search_index WHERE etype = 'capture' AND eid = OLD.id;
END;
`;

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

let savepointSeq = 0;

/** Run fn atomically. Re-entrant: nested calls become savepoints inside the outer transaction. */
export function tx<T>(db: DB, fn: () => T): T {
  if (db.isTransaction) {
    const sp = `sp_${++savepointSeq}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const out = fn();
      db.exec(`RELEASE ${sp}`);
      return out;
    } catch (err) {
      db.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw err;
    }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => new Date().toISOString();
export const newId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
