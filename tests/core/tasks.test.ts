import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/core/db'
import { TaskError, TaskRepository } from '../../src/core/tasks'

function repo(): TaskRepository {
  return new TaskRepository(openDatabase(':memory:'))
}

describe('TaskRepository', () => {
  it('adds a task into the inbox with defaults', () => {
    const tasks = repo()
    const task = tasks.add({ title: '  Fix login  ' })
    expect(task.id).toBe(1)
    expect(task.title).toBe('Fix login')
    expect(task.status).toBe('inbox')
    expect(task.source).toBe('manual')
    expect(task.body).toBe('')
    expect(task.workdir).toBeNull()
  })

  it('rejects an empty title and unknown values', () => {
    const tasks = repo()
    expect(() => tasks.add({ title: '   ' })).toThrow(TaskError)
    // @ts-expect-error — deliberately invalid
    expect(() => tasks.add({ title: 'x', source: 'mail' })).toThrow(TaskError)
    const t = tasks.add({ title: 'x' })
    // @ts-expect-error — deliberately invalid
    expect(() => tasks.update(t.id, { status: 'lost' })).toThrow(TaskError)
  })

  it('lists newest first and filters by status', () => {
    const tasks = repo()
    const a = tasks.add({ title: 'a' })
    const b = tasks.add({ title: 'b' })
    tasks.setStatus(a.id, 'done')
    expect(tasks.list().map((t) => t.title)).toEqual(['b', 'a'])
    expect(tasks.list({ status: 'inbox' }).map((t) => t.id)).toEqual([b.id])
    expect(tasks.list({ status: ['inbox', 'done'] })).toHaveLength(2)
    expect(tasks.list({ limit: 1 })).toHaveLength(1)
  })

  it('updates fields, normalizes an empty workdir to null, and bumps updated_at', async () => {
    const tasks = repo()
    const t = tasks.add({ title: 'a', workdir: '/tmp/x' })
    await new Promise((r) => setTimeout(r, 5))
    const u = tasks.update(t.id, { workdir: '  ', body: 'details', status: 'running' })
    expect(u.workdir).toBeNull()
    expect(u.body).toBe('details')
    expect(u.status).toBe('running')
    expect(u.updatedAt > t.updatedAt).toBe(true)
    expect(u.title).toBe('a')
  })

  it('finds a task by its source reference and counts by status', () => {
    const tasks = repo()
    tasks.add({ title: 'issue', source: 'github', sourceRef: 'https://github.com/o/r/issues/1' })
    tasks.add({ title: 'other' })
    expect(tasks.findBySourceRef('https://github.com/o/r/issues/1')?.title).toBe('issue')
    expect(tasks.findBySourceRef('nope')).toBeNull()
    expect(tasks.countByStatus()).toMatchObject({ inbox: 2, done: 0 })
  })

  it('notifies listeners on every change and lets them unsubscribe', () => {
    const tasks = repo()
    let calls = 0
    const off = tasks.onChange(() => calls++)
    const t = tasks.add({ title: 'a' })
    tasks.update(t.id, { title: 'b' })
    tasks.remove(t.id)
    expect(calls).toBe(3)
    off()
    tasks.add({ title: 'c' })
    expect(calls).toBe(3)
    expect(() => tasks.remove(999)).toThrow(TaskError)
  })
})
