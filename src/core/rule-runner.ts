import type { GitHubIssue, Rule } from '../shared/rules'
import type { Task } from '../shared/tasks'
import type { IssueFetcher } from './github'
import type { RuleRepository } from './rules'
import type { TaskRepository } from './tasks'

export interface RuleCheckOutcome {
  rule: Rule
  /** Issues the search returned (registered or not). */
  found: number
  /** Tasks created this time. */
  imported: Task[]
  error: string | null
}

/**
 * Runs the GitHub rules: searches each due rule's issues and puts the ones
 * the box doesn't know yet into it. A rule with `auto` marks its tasks
 * auto-pending; the dispatcher (main) picks those up and opens their tabs.
 */
export class RuleRunner {
  private checking = new Set<number>()

  constructor(
    private rules: RuleRepository,
    private tasks: TaskRepository,
    private fetch: IssueFetcher,
    private log: (message: string) => void = () => {}
  ) {}

  /** Checks every due rule; rules already mid-check are skipped. */
  async tick(now = Date.now()): Promise<RuleCheckOutcome[]> {
    const outcomes: RuleCheckOutcome[] = []
    for (const rule of this.rules.due(now)) {
      if (this.checking.has(rule.id)) continue
      outcomes.push(await this.check(rule))
    }
    return outcomes
  }

  async check(rule: Rule): Promise<RuleCheckOutcome> {
    this.checking.add(rule.id)
    try {
      let issues: GitHubIssue[]
      try {
        issues = await this.fetch(rule.workdir, rule.query)
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        this.rules.markChecked(rule.id, error)
        this.log(`ルール「${rule.name}」の検索に失敗: ${error}`)
        return { rule, found: 0, imported: [], error }
      }
      const imported: Task[] = []
      for (const issue of issues) {
        if (this.tasks.findBySourceRef(issue.url)) continue
        imported.push(
          this.tasks.add({
            source: 'github',
            title: `#${issue.number} ${issue.title}`,
            body: issue.body,
            sourceRef: issue.url,
            workdir: rule.workdir,
            ruleId: rule.id,
            autoPending: rule.auto
          })
        )
      }
      this.rules.markChecked(rule.id, null)
      if (imported.length) {
        this.log(`ルール「${rule.name}」: ${issues.length} 件中 ${imported.length} 件を取り込み`)
      }
      return { rule, found: issues.length, imported, error: null }
    } finally {
      this.checking.delete(rule.id)
    }
  }
}
