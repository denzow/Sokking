import { create } from 'zustand'
import type { Run } from '../../../shared/runs'

/**
 * Runs per task, fetched on demand (the task panel) and refreshed whenever
 * main reports a run changed. Only tasks someone looked at are cached.
 */
interface RunsState {
  byTask: Record<number, Run[]>
  load: (taskId: number) => Promise<void>
  /** Re-fetch every cached task's runs (after a RunChanged event). */
  refreshAll: () => Promise<void>
}

export const useRunsStore = create<RunsState>((set, get) => ({
  byTask: {},

  load: async (taskId) => {
    const runs = await window.sokking.runListForTask(taskId)
    set((s) => ({ byTask: { ...s.byTask, [taskId]: runs } }))
  },

  refreshAll: async () => {
    const ids = Object.keys(get().byTask).map(Number)
    await Promise.all(ids.map((id) => get().load(id)))
  }
}))

/** The most recent run of a task, if any is cached. */
export function latestRun(byTask: Record<number, Run[]>, taskId: number): Run | null {
  return byTask[taskId]?.[0] ?? null
}
