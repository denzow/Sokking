import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { openDatabase } from '../../src/core/db'
import { TaskRepository } from '../../src/core/tasks'
import { RuleError, RuleRepository } from '../../src/core/rules'
import { RuleRunner } from '../../src/core/rule-runner'
import { issueNumberFromUrl } from '../../src/core/github'
import { issueWorktreePath, prepareIssueWorktree } from '../../src/core/worktree'
import type { GitHubIssue } from '../../src/shared/rules'

function setup() {
  const db = openDatabase(':memory:')
  return { tasks: new TaskRepository(db), rules: new RuleRepository(db) }
}

const base = { name: 'agent-ready', workdir: '/w', query: 'label:agent-ready' }

describe('RuleRepository', () => {
  it('validates input and applies defaults', () => {
    const { rules } = setup()
    expect(() => rules.add({ ...base, name: ' ' })).toThrow(RuleError)
    expect(() => rules.add({ ...base, query: '' })).toThrow(RuleError)
    expect(() => rules.add({ ...base, intervalSeconds: 5 })).toThrow(RuleError)
    expect(() => rules.add({ ...base, delivery: 'push' })).toThrow(RuleError)
    const rule = rules.add(base)
    expect(rule).toMatchObject({
      intervalSeconds: 300,
      auto: false,
      permissionMode: 'acceptEdits',
      delivery: 'pr',
      enabled: true,
      lastCheckedAt: null
    })
  })

  it('reports due rules by interval and last check', () => {
    const { rules } = setup()
    const a = rules.add({ ...base, intervalSeconds: 60 })
    const b = rules.add({ ...base, name: 'b', enabled: false })
    expect(rules.due().map((r) => r.id)).toEqual([a.id])
    const now = Date.now()
    rules.markChecked(a.id, null, new Date(now - 30_000).toISOString())
    expect(rules.due(now)).toHaveLength(0)
    expect(rules.due(now + 31_000).map((r) => r.id)).toEqual([a.id])
    rules.update(b.id, { ...base, name: 'b', enabled: true })
    expect(rules.due(now)).toHaveLength(1)
    rules.remove(b.id)
    expect(() => rules.remove(b.id)).toThrow(RuleError)
  })
})

describe('RuleRunner', () => {
  const issues: GitHubIssue[] = [
    { number: 1, title: 'One', body: 'first', url: 'https://github.com/o/r/issues/1', labels: [] },
    { number: 2, title: 'Two', body: '', url: 'https://github.com/o/r/issues/2', labels: ['x'] }
  ]

  it('imports unknown issues as tasks and marks auto ones pending', async () => {
    const { tasks, rules } = setup()
    const rule = rules.add({ ...base, auto: true })
    const runner = new RuleRunner(rules, tasks, async () => issues)
    const [first] = await runner.tick()
    expect(first.imported).toHaveLength(2)
    expect(first.imported[0]).toMatchObject({
      source: 'github',
      title: '#1 One',
      sourceRef: 'https://github.com/o/r/issues/1',
      workdir: '/w',
      ruleId: rule.id,
      autoPending: true
    })
    expect(tasks.listAutoPending()).toHaveLength(2)
    expect(rules.get(rule.id)?.lastCheckedAt).not.toBeNull()
    // A second check right away is not due; forcing one imports nothing new.
    expect(await runner.tick()).toHaveLength(0)
    const again = await runner.check(rules.get(rule.id) as never)
    expect(again.found).toBe(2)
    expect(again.imported).toHaveLength(0)
  })

  it('records a search failure on the rule', async () => {
    const { tasks, rules } = setup()
    const rule = rules.add(base)
    const runner = new RuleRunner(rules, tasks, async () => {
      throw new Error('gh down')
    })
    const [outcome] = await runner.tick()
    expect(outcome.error).toBe('gh down')
    expect(rules.get(rule.id)?.lastError).toBe('gh down')
    expect(tasks.list()).toHaveLength(0)
  })
})

describe('github helpers', () => {
  it('extracts the issue number from a URL', () => {
    expect(issueNumberFromUrl('https://github.com/o/r/issues/12')).toBe(12)
    expect(issueNumberFromUrl('https://github.com/o/r/issues/12#issuecomment-1')).toBe(12)
    expect(issueNumberFromUrl('https://github.com/o/r/pull/12')).toBeNull()
  })
})

describe('worktree', () => {
  it('places the tree beside the checkout', () => {
    expect(issueWorktreePath('/home/u/work/app', 7)).toBe('/home/u/work/app-sokking/issue-7')
  })

  it('creates and reuses an issue worktree on a real repository', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sokking-wt-'))
    const repo = path.join(root, 'app')
    fs.mkdirSync(repo)
    const run = (args: string[]): string =>
      execFileSync('git', ['-C', repo, ...args], {
        encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' }
      })
    run(['init', '-q', '-b', 'main'])
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a')
    run(['add', '.'])
    run(['commit', '-q', '-m', 'init'])
    const tree = await prepareIssueWorktree(repo, 3)
    expect(tree).toBe(path.join(root, 'app-sokking', 'issue-3'))
    expect(fs.existsSync(path.join(tree, 'a.txt'))).toBe(true)
    expect(execFileSync('git', ['-C', tree, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe('issue-3')
    expect(await prepareIssueWorktree(repo, 3)).toBe(tree)
    fs.rmSync(root, { recursive: true, force: true })
  })
})
