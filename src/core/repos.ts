import type { DatabaseSync } from 'node:sqlite'
import { DELIVERIES, PERMISSION_MODES, RepoDefaults } from '../shared/runs'

interface RepoRow {
  workdir: string
  default_delivery: string
  default_push_branch: string | null
  default_permission_mode: string
  updated_at: string
}

export class RepoError extends Error {}

/** Built-in defaults for a directory nobody has configured yet. */
export function fallbackRepoDefaults(workdir: string): RepoDefaults {
  return {
    workdir,
    defaultDelivery: 'pr',
    defaultPushBranch: null,
    defaultPermissionMode: 'acceptEdits'
  }
}

/** Per-repository defaults for the launch dialog, keyed by workdir. */
export class RepoRepository {
  constructor(private db: DatabaseSync) {}

  get(workdir: string): RepoDefaults | null {
    const row = this.db.prepare('SELECT * FROM repo WHERE workdir = ?').get(workdir) as unknown as
      | RepoRow
      | undefined
    return row ? toDefaults(row) : null
  }

  /** Stored defaults, or the built-in ones for an unconfigured directory. */
  resolve(workdir: string): RepoDefaults {
    return this.get(workdir) ?? fallbackRepoDefaults(workdir)
  }

  set(defaults: RepoDefaults): RepoDefaults {
    if (!defaults.workdir.trim()) throw new RepoError('作業ディレクトリは必須です')
    if (!DELIVERIES.includes(defaults.defaultDelivery)) {
      throw new RepoError(`不明な delivery: ${defaults.defaultDelivery}`)
    }
    if (!PERMISSION_MODES.includes(defaults.defaultPermissionMode)) {
      throw new RepoError(`不明な permission mode: ${defaults.defaultPermissionMode}`)
    }
    this.db
      .prepare(
        `INSERT INTO repo (workdir, default_delivery, default_push_branch, default_permission_mode, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(workdir) DO UPDATE SET
           default_delivery = excluded.default_delivery,
           default_push_branch = excluded.default_push_branch,
           default_permission_mode = excluded.default_permission_mode,
           updated_at = excluded.updated_at`
      )
      .run(
        defaults.workdir,
        defaults.defaultDelivery,
        defaults.defaultPushBranch?.trim() || null,
        defaults.defaultPermissionMode,
        new Date().toISOString()
      )
    return this.get(defaults.workdir) as RepoDefaults
  }

  list(): RepoDefaults[] {
    const rows = this.db.prepare('SELECT * FROM repo ORDER BY workdir').all() as unknown as RepoRow[]
    return rows.map(toDefaults)
  }
}

function toDefaults(row: RepoRow): RepoDefaults {
  return {
    workdir: row.workdir,
    defaultDelivery: row.default_delivery as RepoDefaults['defaultDelivery'],
    defaultPushBranch: row.default_push_branch,
    defaultPermissionMode: row.default_permission_mode as RepoDefaults['defaultPermissionMode']
  }
}
