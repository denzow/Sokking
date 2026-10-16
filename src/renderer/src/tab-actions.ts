import { useTabsStore } from './stores/tabs'
import { useTasksStore } from './stores/tasks'
import { closeEditorFilesForTab } from './components/EditorPanel'
import { forgetTreeState } from './components/FilesPanel'

/**
 * Closes a session tab from anywhere (sidebar ×, the shortcut, the shell
 * exiting). Besides the tab itself: its pty (unless it already exited),
 * its editor files and tree state, and — for a task's processing tab —
 * the task goes back to the box as "review" so the result isn't lost.
 */
export function closeTab(tabId: string, options: { ptyAlive: boolean }): void {
  const store = useTabsStore.getState()
  const tab = store.tabs.find((t) => t.id === tabId)
  if (options.ptyAlive) window.sokking.ptyDispose(tabId)
  store.removeTab(tabId)
  closeEditorFilesForTab(tabId)
  forgetTreeState(tabId)
  if (tab?.taskId !== null && tab?.taskId !== undefined) {
    const task = useTasksStore.getState().tasks.find((t) => t.id === tab.taskId)
    if (task?.status === 'running') void useTasksStore.getState().setStatus(task.id, 'review')
  }
}
