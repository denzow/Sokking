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
