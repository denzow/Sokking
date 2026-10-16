import { create } from 'zustand'
import type { Execution, JobInput, JobSummary } from '../../../shared/jobs'

/** Renderer mirror of the scheduled jobs and their execution history. */
interface JobsState {
  jobs: JobSummary[]
  executions: Execution[]
  loaded: boolean
  error: string | null
  refresh: () => Promise<void>
  refreshExecutions: () => Promise<void>
  add: (input: JobInput) => Promise<boolean>
  update: (id: number, input: JobInput) => Promise<boolean>
  remove: (id: number) => Promise<boolean>
  run: (id: number) => Promise<string>
  clearError: () => void
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  executions: [],
  loaded: false,
  error: null,

  refresh: async () => {
    set({ jobs: await window.sokking.jobList(), loaded: true })
  },

  refreshExecutions: async () => {
    set({ executions: await window.sokking.executionList(undefined, 200) })
  },

  add: async (input) => {
    const r = await window.sokking.jobAdd(input)
    if (!r.ok) {
      set({ error: r.error })
      return false
    }
    set({ error: null })
    await get().refresh()
    return true
  },

  update: async (id, input) => {
    const r = await window.sokking.jobUpdate(id, input)
    if (!r.ok) {
      set({ error: r.error })
      return false
    }
    set({ error: null })
    await get().refresh()
    return true
  },

  remove: async (id) => {
    const r = await window.sokking.jobRemove(id)
    if (!r.ok) {
      set({ error: r.error })
      return false
    }
    await get().refresh()
    await get().refreshExecutions()
    return true
  },

  run: async (id) => {
    const r = await window.sokking.jobRun(id)
    await get().refresh()
    await get().refreshExecutions()
    if (!r.ok) return `失敗: ${r.error}`
    if (!r.execution) return '実行中のため見送りました'
    return r.execution.status === 'queued' ? 'タスクを積みました' : `終了: ${r.execution.status}`
  },

  clearError: () => set({ error: null })
}))
