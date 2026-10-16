import { create } from 'zustand'
import type { NewTask, Task, TaskPatch, TaskStatus } from '../../../shared/tasks'

/**
 * Renderer-side mirror of the task box. Main owns the data; this store
 * holds the last fetched list and re-fetches whenever main says the box
 * changed (which covers writes from the CLI and background sources too).
 */
interface TasksState {
  tasks: Task[]
  loaded: boolean
  /** Last failed write's message, for the task box to show; cleared on success. */
  error: string | null
  refresh: () => Promise<void>
  add: (input: NewTask) => Promise<Task | null>
  update: (id: number, patch: TaskPatch) => Promise<Task | null>
  setStatus: (id: number, status: TaskStatus) => Promise<Task | null>
  remove: (id: number) => Promise<boolean>
  clearError: () => void
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loaded: false,
  error: null,

  refresh: async () => {
    const tasks = await window.sokking.taskList()
    set({ tasks, loaded: true })
  },

  add: async (input) => {
    const result = await window.sokking.taskAdd(input)
    if (!result.ok) {
      set({ error: result.error })
      return null
    }
    set({ error: null })
    await get().refresh()
    return result.task
  },

  update: async (id, patch) => {
    const result = await window.sokking.taskUpdate(id, patch)
    if (!result.ok) {
      set({ error: result.error })
      return null
    }
    set({ error: null })
    await get().refresh()
    return result.task
  },

  setStatus: (id, status) => get().update(id, { status }),

  remove: async (id) => {
    const result = await window.sokking.taskRemove(id)
    if (!result.ok) {
      set({ error: result.error })
      return false
    }
    set({ error: null })
    await get().refresh()
    return true
  },

  clearError: () => set({ error: null })
}))

/** Number of tasks waiting in the inbox — the sidebar badge. */
export function selectInboxCount(s: TasksState): number {
  return s.tasks.reduce((n, t) => (t.status === 'inbox' ? n + 1 : n), 0)
}
