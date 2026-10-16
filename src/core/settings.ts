import type { DatabaseSync } from 'node:sqlite'

/** Key/value settings that the UI may change while the app runs. */
export class SettingsRepository {
  private listeners = new Set<(key: string) => void>()

  constructor(private db: DatabaseSync) {}

  onChange(listener: (key: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as unknown as
      | { value: string }
      | undefined
    return row ? row.value : null
  }

  getOr(key: string, fallback: string): string {
    return this.get(key) ?? fallback
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, new Date().toISOString())
    for (const listener of this.listeners) listener(key)
  }

  all(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM setting').all() as unknown as {
      key: string
      value: string
    }[]
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  }
}
