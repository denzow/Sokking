import type { Task } from '../shared/tasks'
import type { Delivery } from '../shared/runs'

/**
 * The initial prompt handed to Claude Code for a task. Plain text the user
 * can edit in the launch dialog before it goes out.
 */
export function buildPrompt(
  task: Task,
  options: { delivery: Delivery; pushBranch: string | null }
): string {
  const lines: string[] = ['次のタスクを処理してください。', '', `# ${task.title}`]
  if (task.body.trim()) lines.push('', task.body.trim())
  if (task.sourceRef) lines.push('', `参照: ${task.sourceRef}`)
  lines.push('', deliveryInstruction(options))
  return lines.join('\n') + '\n'
}

function deliveryInstruction(options: { delivery: Delivery; pushBranch: string | null }): string {
  if (options.delivery === 'push') {
    return `作業が終わったら変更をコミットし、ブランチ ${options.pushBranch ?? ''} に push してください。`
  }
  return [
    '作業が終わったら、作業用のブランチを切って変更をコミットし、PR を作成してください。',
    '最後に PR の URL を報告してください。'
  ].join('\n')
}

/** The first GitHub pull-request URL in a message, if any. */
export function findPrUrl(text: string): string | null {
  const match = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.exec(text)
  return match ? match[0] : null
}
