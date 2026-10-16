import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Claude Code asks "do you trust this folder?" the first time it starts in
 * a directory, and records the answer in ~/.claude.json under
 * projects[<path>].hasTrustDialogAccepted. An automatic run has nobody to
 * answer, and the worktree it runs in was just created by sokking from a
 * repository the person already works in — so the answer is written ahead
 * of the launch.
 */
export function claudeConfigPath(): string {
  return process.env.SOKKING_CLAUDE_CONFIG ?? path.join(os.homedir(), '.claude.json')
}

interface ClaudeConfig {
  projects?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

/** Marks the directory trusted; returns true when the file was changed. */
export function ensureFolderTrusted(workdir: string, file = claudeConfigPath()): boolean {
  const dir = path.resolve(workdir)
  let config: ClaudeConfig = {}
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8')
    config = raw.trim() ? (JSON.parse(raw) as ClaudeConfig) : {}
  }
  const projects = (config.projects ??= {})
  const entry = (projects[dir] ??= {})
  if (entry.hasTrustDialogAccepted === true) return false
  entry.hasTrustDialogAccepted = true
  // Write-then-rename so a crash mid-write can't leave Claude Code's config truncated.
  const tmp = `${file}.sokking-${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, file)
  return true
}
