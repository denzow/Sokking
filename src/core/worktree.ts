import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export class WorktreeError extends Error {}

function git(workdir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', workdir, ...args],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new WorktreeError(`git ${args.join(' ')} に失敗しました: ${stderr.trim() || error.message}`))
        else resolve(stdout)
      }
    )
  })
}

async function gitOk(workdir: string, args: string[]): Promise<boolean> {
  try {
    await git(workdir, args)
    return true
  } catch {
    return false
  }
}

/**
 * Where an issue's worktree lives: beside the checkout, in
 * `<repo>-sokking/issue-<n>` (alir's layout). One place to look for stray
 * trees, and the main checkout is never disturbed.
 */
export function issueWorktreePath(workdir: string, issueNumber: number): string {
  const dir = path.resolve(workdir)
  return path.join(path.dirname(dir), `${path.basename(dir)}-sokking`, `issue-${issueNumber}`)
}

export function issueBranchName(issueNumber: number): string {
  return `issue-${issueNumber}`
}

/** The ref new branches start from: the remote's default branch when known. */
async function baseRef(workdir: string): Promise<string | null> {
  try {
    const head = (await git(workdir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
    if (head) return head
  } catch {
    // no origin/HEAD — fall through to the usual names
  }
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    if (await gitOk(workdir, ['rev-parse', '--verify', '--quiet', ref])) return ref
  }
  return null
}

/**
 * Prepares the worktree and branch for an issue and returns the path. An
 * existing tree is reused (a relaunch continues where the last run left
 * off). A new tree branches from the fetched default branch, or from the
 * existing `issue-<n>` branch if one is around.
 */
export async function prepareIssueWorktree(workdir: string, issueNumber: number): Promise<string> {
  const target = issueWorktreePath(workdir, issueNumber)
  if (fs.existsSync(target)) return target
  if (!(await gitOk(workdir, ['rev-parse', '--is-inside-work-tree']))) {
    throw new WorktreeError(`${workdir} は git リポジトリではありません`)
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  // Best effort: offline is not fatal, the branch just starts from what's local.
  await gitOk(workdir, ['fetch', '--quiet', 'origin'])
  const branch = issueBranchName(issueNumber)
  if ((await git(workdir, ['branch', '--list', branch])).trim()) {
    await git(workdir, ['worktree', 'add', target, branch])
    return target
  }
  const args = ['worktree', 'add', '-b', branch, target]
  const base = await baseRef(workdir)
  if (base) args.push(base)
  await git(workdir, args)
  return target
}
