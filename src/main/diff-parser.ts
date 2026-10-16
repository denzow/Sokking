import type { DiffFileStatus, GitDiffFile, GitDiffHunk, GitDiffLine } from '../shared/ipc'

/** Parses `git diff` unified output into a structured form for the renderer. */
export function parseUnifiedDiff(diffText: string): GitDiffFile[] {
  const files: GitDiffFile[] = []
  let current: GitDiffFile | null = null
  let hunk: GitDiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { path: '', oldPath: null, status: 'modified', hunks: [] }
      files.push(current)
      hunk = null
      continue
    }
    if (!current) continue

    if (line.startsWith('new file mode')) {
      current.status = 'added'
      continue
    }
    if (line.startsWith('deleted file mode')) {
      current.status = 'deleted'
      continue
    }
    if (line.startsWith('rename from ')) {
      current.status = 'renamed'
      current.oldPath = line.slice('rename from '.length)
      continue
    }
    if (line.startsWith('rename to ')) {
      current.path = line.slice('rename to '.length)
      continue
    }
    if (line.startsWith('--- ')) {
      const p = stripPrefix(line.slice(4))
      if (p && current.status !== 'renamed' && !current.oldPath) current.oldPath = p
      continue
    }
    if (line.startsWith('+++ ')) {
      const p = stripPrefix(line.slice(4))
      if (p) current.path = p
      else if (current.oldPath) current.path = current.oldPath // deleted file: +++ is /dev/null
      continue
    }
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (!m) continue
      oldLine = parseInt(m[1], 10)
      newLine = parseInt(m[2], 10)
      hunk = { header: line, lines: [] }
      current.hunks.push(hunk)
      continue
    }
    if (!hunk) continue

    let parsed: GitDiffLine | null = null
    if (line.startsWith('+')) {
      parsed = { type: 'add', text: line.slice(1), oldLine: null, newLine: newLine++ }
    } else if (line.startsWith('-')) {
      parsed = { type: 'del', text: line.slice(1), oldLine: oldLine++, newLine: null }
    } else if (line.startsWith(' ')) {
      parsed = { type: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ }
    }
    // ignore "\ No newline at end of file" and anything else
    if (parsed) hunk.lines.push(parsed)
  }

  return files.filter((f) => f.path !== '')
}

function stripPrefix(p: string): string | null {
  // git appends a TAB (plus an optional timestamp) after paths containing a space.
  const path = p.split('\t')[0]
  if (path === '/dev/null') return null
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2)
  return path
}

export function statusLabel(status: DiffFileStatus): string {
  switch (status) {
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    default:
      return 'M'
  }
}
