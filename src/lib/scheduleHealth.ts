/**
 * Schedule health labels shared by the Automations list/detail UI.
 * Kept dependency-free (aside from cron helpers) so the browser never pulls
 * the scheduler / SQLite stack.
 */
import { isValidCron, normalizeCron } from './cron.ts'

/** Non-empty cron that fails {@link isValidCron} — legacy or hand-edited junk. */
export function hasInvalidSchedule(cron: string): boolean {
  const normalized = normalizeCron(cron)
  return normalized.length > 0 && !isValidCron(normalized)
}

/**
 * Label for the automation detail "Next run" card.
 * Distinguishes paused / manual / invalid (won't fire) / missing CLI from a
 * real next time.
 */
export function nextRunDetailLabel(input: {
  enabled: boolean
  cron: string
  cronValid: boolean
  /** When false, no workspace is set on the automation. */
  workspaceValid?: boolean
  /** When false, the worktree is still creating or failed setup. */
  workspaceReady?: boolean
  /** When false, the runtime binary is missing from PATH (or the runtime row). */
  runtimeInstalled?: boolean
  /** When false, the stored prompt is empty / whitespace-only. */
  promptValid?: boolean
  /** When true, the schedule disables itself after the next successful fire. */
  fireOnce?: boolean
  /** Pre-formatted relative time when a next fire exists; ignored otherwise. */
  relativeNext?: string | null
}): string {
  if (!input.enabled) return 'paused'
  if (!normalizeCron(input.cron)) return 'manual only'
  if (!input.cronValid) return "won't fire — invalid schedule"
  if (input.workspaceValid === false) return "won't fire — no workspace"
  if (input.workspaceReady === false) return "won't fire — workspace not ready"
  if (input.runtimeInstalled === false) return "won't fire — runtime not on PATH"
  if (input.promptValid === false) return "won't fire — empty prompt"
  const next = input.relativeNext?.trim() || '—'
  if (input.fireOnce && next !== '—') return `${next} · then pause`
  return next
}

/**
 * Seed state for TaskForm's trigger editor when opening an existing automation
 * whose cron is already invalid. Puts the bad expression in the custom draft
 * with an error so the developer can fix or clear it, instead of rendering it
 * as a healthy ScheduleTriggerRow.
 */
export function invalidTriggerEditorSeed(cron: string | undefined | null): {
  cron: string
  addingTrigger: boolean
  triggerDraft: string
  showInvalid: boolean
} {
  const raw = cron ?? ''
  if (!hasInvalidSchedule(raw)) {
    return {
      cron: normalizeCron(raw),
      addingTrigger: false,
      triggerDraft: '',
      showInvalid: false,
    }
  }
  return {
    cron: '',
    addingTrigger: true,
    triggerDraft: normalizeCron(raw),
    showInvalid: true,
  }
}
