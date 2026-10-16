import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/core/db'
import { TaskRepository } from '../../src/core/tasks'
import { ExecutionRepository, JobError, JobRepository, nextRun, validateCron } from '../../src/core/jobs'
import { defaultShellRunner, Scheduler } from '../../src/core/scheduler'
import type { JobInput } from '../../src/shared/jobs'

function setup() {
  const db = openDatabase(':memory:')
  return {
    tasks: new TaskRepository(db),
    jobs: new JobRepository(db),
    executions: new ExecutionRepository(db)
  }
}

const shellJob: JobInput = { name: 'echo', cron: '*/5 * * * *', kind: 'shell', command: 'echo hi' }

describe('JobRepository', () => {
  it('validates cron, kind-specific fields and defaults', () => {
    const { jobs } = setup()
    expect(() => validateCron('bad cron')).toThrow(JobError)
    expect(nextRun('0 0 * * *')).toBeInstanceOf(Date)
    expect(() => jobs.add({ ...shellJob, cron: '* * *' })).toThrow(JobError)
    expect(() => jobs.add({ ...shellJob, command: '' })).toThrow(JobError)
    expect(() => jobs.add({ name: 'c', cron: '0 * * * *', kind: 'claude', prompt: 'x' })).toThrow(/作業ディレクトリ/)
    const job = jobs.add(shellJob)
    expect(job).toMatchObject({ timeoutSeconds: 3600, enabled: true, lastRunAt: null, kind: 'shell' })
    jobs.update(job.id, { ...shellJob, name: 'echo2', enabled: false })
    expect(jobs.get(job.id)?.name).toBe('echo2')
    jobs.remove(job.id)
    expect(() => jobs.remove(job.id)).toThrow(JobError)
  })
})

describe('Scheduler', () => {
  it('runs a shell job and records its output', async () => {
    const { tasks, jobs, executions } = setup()
    const job = jobs.add(shellJob)
    const scheduler = new Scheduler(jobs, executions, tasks, async () => ({
      status: 'success',
      exitCode: 0,
      stdout: 'hi\n',
      stderr: ''
    }))
    const execution = await scheduler.runJob(job.id)
    expect(execution).toMatchObject({ status: 'success', exitCode: 0, stdout: 'hi\n' })
    expect(executions.list({ jobId: job.id })).toHaveLength(1)
    expect(jobs.get(job.id)?.lastRunAt).not.toBeNull()
  })

  it('turns a claude job into an auto-pending task', async () => {
    const { tasks, jobs, executions } = setup()
    const job = jobs.add({ name: 'daily', cron: '0 9 * * *', kind: 'claude', prompt: 'do it', workdir: '/w' })
    const scheduler = new Scheduler(jobs, executions, tasks)
    const execution = await scheduler.runJob(job.id)
    expect(execution?.status).toBe('queued')
    const [task] = tasks.list()
    expect(task).toMatchObject({ source: 'schedule', title: 'daily', body: 'do it', workdir: '/w', jobId: job.id, autoPending: true })
    expect(execution?.taskId).toBe(task.id)
  })

  it('never overlaps a running job and syncs timers with enabled jobs', async () => {
    const { tasks, jobs, executions } = setup()
    const job = jobs.add(shellJob)
    let release: () => void = () => {}
    const scheduler = new Scheduler(jobs, executions, tasks, () =>
      new Promise((resolve) => {
        release = () => resolve({ status: 'success', exitCode: 0, stdout: '', stderr: '' })
      })
    )
    const first = scheduler.runJob(job.id)
    expect(scheduler.isRunning(job.id)).toBe(true)
    expect(await scheduler.runJob(job.id)).toBeNull()
    release()
    await first
    expect(executions.list()).toHaveLength(1)

    scheduler.sync()
    expect(scheduler.nextRun(job.id)).toBeInstanceOf(Date)
    jobs.update(job.id, { ...shellJob, enabled: false })
    scheduler.sync()
    expect(scheduler.nextRun(job.id)).toBeNull()
    scheduler.stop()
  })

  it('runs a real shell command with cwd, timeout and env', async () => {
    const { jobs } = setup()
    const ok = await defaultShellRunner({
      ...jobs.add({ ...shellJob, command: 'echo $SOKKING_JOB_NAME; pwd; echo err >&2', workdir: '/tmp' })
    })
    expect(ok.status).toBe('success')
    expect(ok.stdout).toContain('echo\n/tmp')
    expect(ok.stderr).toContain('err')
    const bad = await defaultShellRunner(jobs.add({ ...shellJob, name: 'bad', command: 'exit 3' }))
    expect(bad).toMatchObject({ status: 'failed', exitCode: 3 })
    const slow = await defaultShellRunner(jobs.add({ ...shellJob, name: 'slow', command: 'sleep 5', timeoutSeconds: 1 }))
    expect(slow.status).toBe('timeout')
  }, 15000)

  it('fails executions left running and prunes history', () => {
    const { jobs, executions } = setup()
    const job = jobs.add(shellJob)
    executions.start(job.id)
    expect(executions.failAllRunning()).toBe(1)
    expect(executions.list()[0].status).toBe('failed')
    for (let i = 0; i < 5; i++) {
      const e = executions.start(job.id)
      executions.finish(e.id, { status: 'success', exitCode: 0, stdout: '', stderr: '' })
    }
    expect(executions.prune({ keepDays: 30, keepPerJob: 2 })).toBe(4)
    expect(executions.list({ jobId: job.id })).toHaveLength(2)
  })
})
