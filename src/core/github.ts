import { execFile } from 'node:child_process'
import type { GitHubIssue } from '../shared/rules'

/** How long one `gh issue list` may take. */
const FETCH_TIMEOUT_MS = 60_000
const FETCH_LIMIT = 50

export class GitHubError extends Error {}

/** Signature of the issue search, so the rule runner can be tested without gh. */
export type IssueFetcher = (workdir: string, query: string) => Promise<GitHubIssue[]>

/**
 * Open issues matching a GitHub search query, through the `gh` CLI (which
 * also holds the authentication). The repository comes from the working
 * directory's remote, like any `gh` command run there.
 */
export function fetchIssues(workdir: string, query: string): Promise<GitHubIssue[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      [
        'issue',
        'list',
        '--state',
        'open',
        '--search',
        query,
        '--limit',
        String(FETCH_LIMIT),
        '--json',
        'number,title,body,url,labels'
      ],
      { cwd: workdir, timeout: FETCH_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message
          reject(new GitHubError(`gh issue list に失敗しました: ${detail}`))
          return
        }
        try {
          const raw = JSON.parse(stdout) as {
            number: number
            title: string
            body: string | null
            url: string
            labels?: { name: string }[]
          }[]
          resolve(
            raw.map((i) => ({
              number: i.number,
              title: i.title,
              body: i.body ?? '',
              url: i.url,
              labels: (i.labels ?? []).map((l) => l.name)
            }))
          )
        } catch (e) {
          reject(new GitHubError(`gh の出力を読めません: ${e instanceof Error ? e.message : e}`))
        }
      }
    )
  })
}

/** Issue number from an issue URL, or null for anything else. */
export function issueNumberFromUrl(url: string): number | null {
  const match = /\/issues\/(\d+)(?:[#?].*)?$/.exec(url)
  return match ? Number(match[1]) : null
}
