import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Schema migrations, applied in order; `PRAGMA user_version` records how
 * many have run. Append only — never edit a shipped entry.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE task (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    source_app  TEXT,
    source_ref  TEXT,
    status      TEXT NOT NULL DEFAULT 'inbox',
    workdir     TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX task_status ON task(status, created_at);
  CREATE INDEX task_source_ref ON task(source_ref);
  `,
  `
  CREATE TABLE repo (
    workdir                 TEXT PRIMARY KEY,
    default_delivery        TEXT NOT NULL DEFAULT 'pr',
    default_push_branch     TEXT,
    default_permission_mode TEXT NOT NULL DEFAULT 'acceptEdits',
    updated_at              TEXT NOT NULL
  );
  CREATE TABLE run (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id         INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    tab_id          TEXT NOT NULL,
    mode            TEXT NOT NULL,
    permission_mode TEXT NOT NULL,
    delivery        TEXT NOT NULL,
    push_branch     TEXT,
    workdir         TEXT NOT NULL,
    prompt          TEXT NOT NULL,
    session_id      TEXT,
    branch          TEXT,
    pr_url          TEXT,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    result          TEXT
  );
  CREATE INDEX run_task ON run(task_id, id);
  CREATE INDEX run_open ON run(finished_at) WHERE finished_at IS NULL;
  `,
  `
  CREATE TABLE setting (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE notification_filter (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    "order"         INTEGER NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    app_pattern     TEXT NOT NULL DEFAULT '',
    title_pattern   TEXT NOT NULL DEFAULT '',
    body_pattern    TEXT NOT NULL DEFAULT '',
    action          TEXT NOT NULL,
    workdir         TEXT,
    prompt_template TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );
  CREATE TABLE notification_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    app               TEXT NOT NULL,
    title             TEXT NOT NULL,
    body              TEXT NOT NULL,
    received_at       TEXT NOT NULL,
    matched_filter_id INTEGER,
    result            TEXT NOT NULL,
    task_id           INTEGER
  );
  CREATE INDEX notification_log_received ON notification_log(received_at);
  `,
  `
  CREATE TABLE rule (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    workdir          TEXT NOT NULL,
    query            TEXT NOT NULL,
    interval_seconds INTEGER NOT NULL DEFAULT 300,
    auto             INTEGER NOT NULL DEFAULT 0,
    permission_mode  TEXT NOT NULL DEFAULT 'acceptEdits',
    delivery         TEXT NOT NULL DEFAULT 'pr',
    push_branch      TEXT,
    prompt_template  TEXT,
    enabled          INTEGER NOT NULL DEFAULT 1,
    last_checked_at  TEXT,
    last_error       TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );
  ALTER TABLE task ADD COLUMN rule_id INTEGER REFERENCES rule(id) ON DELETE SET NULL;
  ALTER TABLE task ADD COLUMN auto_pending INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX task_auto_pending ON task(auto_pending) WHERE auto_pending = 1;
  `
]

/**
 * Opens (creating if needed) the SQLite database and brings its schema up
 * to date. `':memory:'` gives a throwaway database for tests.
 */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let version = row.user_version; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version])
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}
