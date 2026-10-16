import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/core/db'
import { TaskRepository } from '../../src/core/tasks'
import { RunError, RunRepository } from '../../src/core/runs'
import { RepoRepository } from '../../src/core/repos'
import { buildPrompt, findPrUrl } from '../../src/core/prompt'
import type { RunOptions } from '../../src/shared/runs'

function setup(): { tasks: TaskRepository; runs: RunRepository; repos: RepoRepository } {
  const db = openDatabase(':memory:')
  return { tasks: new TaskRepository(db), runs: new RunRepository(db), repos: new RepoRepository(db) }
}

const options: RunOptions = {
  workdir: '/tmp/repo',
  permissionMode: 'acceptEdits',
  delivery: 'pr',
  pushBranch: null,
  prompt: 'do it'
}

describe('RunRepository', () => {
  it('starts a run for a task and finds it by tab', () => {
    const { tasks, runs } = setup()
    const task = tasks.add({ title: 't' })
    const run = runs.start(task.id, 'tab-1', options)
    expect(run.taskId).toBe(task.id)
    expect(run.mode).toBe('interactive')
    expect(run.finishedAt).toBeNull()
    expect(runs.openForTab('tab-1')?.id).toBe(run.id)
    expect(runs.listForTask(task.id)).toHaveLength(1)
  })

  it('validates the options', () => {
    const { tasks, runs } = setup()
    const task = tasks.add({ title: 't' })
    expect(() => runs.start(task.id, 'tab', { ...options, delivery: 'push' })).toThrow(RunError)
    expect(() =>
      // @ts-expect-error — deliberately invalid
      runs.start(task.id, 'tab', { ...options, permissionMode: 'yolo' })
    ).toThrow(RunError)
    expect(() => runs.start(task.id, 'tab', { ...options, workdir: ' ' })).toThrow(RunError)
    const run = runs.start(task.id, 'tab', { ...options, delivery: 'push', pushBranch: ' develop ' })
    expect(run.pushBranch).toBe('develop')
  })

  it('records session, PR and completion; finishing twice is a no-op', () => {
    const { tasks, runs } = setup()
    const task = tasks.add({ title: 't' })
    const run = runs.start(task.id, 'tab', options)
    runs.setSessionId(run.id, 'sess')
    runs.setPrUrl(run.id, 'https://github.com/o/r/pull/3')
    runs.finish(run.id, 'done')
    runs.finish(run.id, 'failed')
    const stored = runs.get(run.id)
    expect(stored?.sessionId).toBe('sess')
    expect(stored?.prUrl).toBe('https://github.com/o/r/pull/3')
    expect(stored?.result).toBe('done')
    expect(runs.openForTab('tab')).toBeNull()
  })

  it('closes every open run after a restart', () => {
    const { tasks, runs } = setup()
    const task = tasks.add({ title: 't' })
    runs.start(task.id, 'a', options)
    runs.start(task.id, 'b', options)
    expect(runs.finishAllOpen('interrupted')).toBe(2)
    expect(runs.listOpen()).toHaveLength(0)
    expect(runs.finishAllOpen('interrupted')).toBe(0)
  })

  it('removes runs with their task', () => {
    const { tasks, runs } = setup()
    const task = tasks.add({ title: 't' })
    runs.start(task.id, 'a', options)
    tasks.remove(task.id)
    expect(runs.listForTask(task.id)).toHaveLength(0)
  })
})

describe('RepoRepository', () => {
  it('falls back to built-in defaults and upserts stored ones', () => {
    const { repos } = setup()
    expect(repos.get('/x')).toBeNull()
    expect(repos.resolve('/x')).toMatchObject({ defaultDelivery: 'pr', defaultPermissionMode: 'acceptEdits' })
    repos.set({ workdir: '/x', defaultDelivery: 'push', defaultPushBranch: 'develop', defaultPermissionMode: 'plan' })
    repos.set({ workdir: '/x', defaultDelivery: 'push', defaultPushBranch: ' ', defaultPermissionMode: 'default' })
    expect(repos.resolve('/x')).toEqual({
      workdir: '/x',
      defaultDelivery: 'push',
      defaultPushBranch: null,
      defaultPermissionMode: 'default'
    })
    expect(repos.list()).toHaveLength(1)
  })
})

describe('prompt', () => {
  it('builds the prompt from the task and the delivery', () => {
    const { tasks } = setup()
    const task = tasks.add({ title: 'Fix it', body: 'details', sourceRef: 'https://example/1' })
    const pr = buildPrompt(task, { delivery: 'pr', pushBranch: null })
    expect(pr).toContain('# Fix it')
    expect(pr).toContain('details')
    expect(pr).toContain('参照: https://example/1')
    expect(pr).toContain('PR を作成')
    const push = buildPrompt(task, { delivery: 'push', pushBranch: 'develop' })
    expect(push).toContain('ブランチ develop に push')
  })

  it('finds a PR URL in a message', () => {
    expect(findPrUrl('done: https://github.com/denzow/Sokking/pull/12 ok')).toBe(
      'https://github.com/denzow/Sokking/pull/12'
    )
    expect(findPrUrl('https://github.com/denzow/Sokking/issues/12')).toBeNull()
  })
})
