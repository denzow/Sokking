import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { FsNameMatch, FsSearchNamesResult, WorkspaceSearchMatch, WorkspaceSearchResult } from '../shared/ipc'

// Directory search for the workspace panel: file names + file contents in one
// call. Inside a git repo both go through git (ls-files / grep --untracked) so
// .gitignore is respected; outside one, a plain walk / grep -r with .git and
// node_modules excluded. Results are capped — the panel is for jumping to
// code, not for exhaustive listings.

const NAME_CAP = 100
const CONTENT_CAP = 300
const ENTRY_CAP = 200
const WALK_CAP = 20000
const LINE_TEXT_CAP = 500
const WALK_SKIP = new Set(['.git', 'node_modules'])

// One search at a time: a new query (or a keystroke) aborts the running one,
// killing its child processes. The two searches (workspace panel, tree
// filter) each abort their own kind only.
let current: AbortController | null = null
let currentNames: AbortController | null = null

export async function workspaceSearch(root: string, query: string): Promise<WorkspaceSearchResult> {
  current?.abort()
  const ac = new AbortController()
  current = ac
  const q = query.trim()
  if (!q) return { ok: true, files: [], matches: [], truncated: false }
  try {
    const repo = await isGitRepo(root, ac.signal)
    const [names, contents] = await Promise.all([
      searchNames(root, q, repo, ac.signal),
      searchContents(root, q, repo, ac.signal)
    ])
    if (ac.signal.aborted) return { ok: false, error: 'cancelled' }
    return {
      ok: true,
      files: names.files,
      matches: contents.matches,
      truncated: names.truncated || contents.truncated
    }
  } catch (e) {
    if (ac.signal.aborted) return { ok: false, error: 'cancelled' }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Spawn a command and feed stdout to `onLine` line by line; returning false
 * stops reading and kills the child (used when a result cap is reached).
 * Exit code 1 is success — the grep family means "no matches" by it.
 */
function runLines(
  cmd: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  onLine: (line: string) => boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    let stopped = false
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stopped) return
      buf += chunk
      let idx: number
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (!onLine(line)) {
          stopped = true
          child.kill()
          return
        }
      }
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => {
      stderr += c
    })
    child.on('error', (e) => {
      // The abort signal kills the child through an AbortError — not a failure.
      if (e.name === 'AbortError') resolve()
      else reject(e)
    })
    child.on('close', (code) => {
      if (stopped || signal.aborted) return resolve()
      if (buf) onLine(buf) // trailing line without \n
      if (code !== null && code > 1) reject(new Error(stderr.trim() || `${cmd} exited ${code}`))
      else resolve()
    })
  })
}

async function isGitRepo(root: string, signal: AbortSignal): Promise<boolean> {
  try {
    let inside = false
    await runLines('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], root, signal, (l) => {
      inside = l.trim() === 'true'
      return true
    })
    return inside
  } catch {
    return false
  }
}

async function searchNames(
  root: string,
  q: string,
  repo: boolean,
  signal: AbortSignal
): Promise<{ files: string[]; truncated: boolean }> {
  const needle = q.toLowerCase()
  const files: string[] = []
  let truncated = false
  const consider = (rel: string): boolean => {
    if (rel && rel.toLowerCase().includes(needle)) {
      if (files.length >= NAME_CAP) {
        truncated = true
        return false
      }
      files.push(rel)
    }
    return true
  }
  if (repo) {
    await runLines(
      'git',
      ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'],
      root,
      signal,
      consider
    )
  } else {
    // Files only, matching the repo branch (git ls-files lists no dirs).
    await walk(root, '', (rel, isDir) => isDir || consider(rel), { count: 0 }, signal)
  }
  return { files, truncated }
}

/**
 * Recursive entry-name search for the files-tree filter: files AND
 * directories whose name contains the query, any depth under the root. A
 * query containing '/' (e.g. "src/main") can never match a basename, so it
 * matches against the relative path instead — the directory itself and
 * everything under it. Always a filesystem walk (the tree shows the
 * filesystem, not the git view), with .git / node_modules skipped and both
 * caps reported.
 */
export async function searchEntryNames(root: string, query: string): Promise<FsSearchNamesResult> {
  currentNames?.abort()
  const ac = new AbortController()
  currentNames = ac
  const q = query.trim().toLowerCase()
  if (!q) return { ok: true, entries: [], truncated: false }
  const matchPath = q.includes('/')
  const entries: FsNameMatch[] = []
  let truncated = false
  const counter = { count: 0 }
  try {
    await walk(
      root,
      '',
      (rel, isDir) => {
        const target = matchPath ? rel : rel.slice(rel.lastIndexOf('/') + 1)
        if (target.toLowerCase().includes(q)) {
          if (entries.length >= ENTRY_CAP) {
            truncated = true
            return false
          }
          entries.push({ path: rel, isDir })
        }
        return true
      },
      counter,
      ac.signal
    )
    if (ac.signal.aborted) return { ok: false, error: 'cancelled' }
    entries.sort((a, b) => a.path.localeCompare(b.path, 'ja'))
    return { ok: true, entries, truncated: truncated || counter.count > WALK_CAP }
  } catch (e) {
    if (ac.signal.aborted) return { ok: false, error: 'cancelled' }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Recursive walk feeding every entry (dirs included) to `consider`, bounded
    by WALK_CAP visited entries; returning false from `consider` stops it. */
async function walk(
  base: string,
  rel: string,
  consider: (rel: string, isDir: boolean) => boolean,
  counter: { count: number },
  signal: AbortSignal
): Promise<boolean> {
  if (signal.aborted) return false
  let dirents: fs.Dirent[]
  try {
    dirents = await fs.promises.readdir(path.join(base, rel), { withFileTypes: true })
  } catch {
    return true // unreadable directory — skip, keep walking elsewhere
  }
  for (const d of dirents) {
    if (signal.aborted || ++counter.count > WALK_CAP) return false
    const childRel = rel ? `${rel}/${d.name}` : d.name
    if (d.isDirectory()) {
      if (WALK_SKIP.has(d.name)) continue
      if (!consider(childRel, true)) return false
      if (!(await walk(base, childRel, consider, counter, signal))) return false
    } else if (!consider(childRel, false)) {
      return false
    }
  }
  return true
}

async function searchContents(
  root: string,
  q: string,
  repo: boolean,
  signal: AbortSignal
): Promise<{ matches: WorkspaceSearchMatch[]; truncated: boolean }> {
  const matches: WorkspaceSearchMatch[] = []
  let truncated = false
  const push = (file: string, line: number, text: string): boolean => {
    if (matches.length >= CONTENT_CAP) {
      truncated = true
      return false
    }
    matches.push({ file, line, text: text.slice(0, LINE_TEXT_CAP) })
    return true
  }
  if (repo) {
    // -z makes the record `path\0line\0text` — safe for paths containing ':'.
    await runLines(
      'git',
      ['-C', root, 'grep', '-I', '-n', '-i', '-F', '-z', '--untracked', '--no-color', '-e', q, '--'],
      root,
      signal,
      (l) => {
        const first = l.indexOf('\0')
        const second = l.indexOf('\0', first + 1)
        if (first === -1 || second === -1) return true
        const line = Number(l.slice(first + 1, second))
        if (!Number.isFinite(line)) return true
        return push(l.slice(0, first), line, l.slice(second + 1))
      }
    )
  } else {
    await runLines(
      'grep',
      ['-r', '-I', '-n', '-i', '-F', '--exclude-dir=.git', '--exclude-dir=node_modules', '-e', q, '.'],
      root,
      signal,
      (l) => {
        // `./path:line:text` — a path containing ":<digits>:" could split
        // early, which is acceptable for a jump-to-code list.
        const m = /^\.\/(.+?):(\d+):(.*)$/.exec(l)
        if (!m) return true
        return push(m[1], Number(m[2]), m[3])
      }
    )
  }
  return { matches, truncated }
}
