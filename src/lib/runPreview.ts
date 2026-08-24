/**
 * Runs-list identity: a chat title plus a one-line activity summary.
 *
 * Cursor's agent history is a name on top and "Edited foo.ts, bar.ts" (or the
 * in-flight tool) underneath. Same two lines here, so the overview and the
 * working line cannot drift — both go through toolCallView / latestActivity.
 */
import type { ToolCallStatus } from './acp.ts'
import { truncateSessionTitle } from './nativeSessions.ts'
import { latestActivity } from './turnActivity.ts'
import { toolCallView, type ToolCallTarget, type ToolCallView } from './toolCallView.ts'
import type { TurnEventPayload, TurnEventRow } from './turnEvents.ts'

const TITLE_MAX = 72
const SUMMARY_MAX = 80

function payloadOf(event: Pick<TurnEventRow, 'payload'>): TurnEventPayload {
  try {
    return JSON.parse(event.payload) as TurnEventPayload
  } catch {
    return {}
  }
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= max) return line
  return `${line.slice(0, max - 1).trimEnd()}…`
}

function viewOf(payload: TurnEventPayload, status?: ToolCallStatus): ToolCallView {
  return toolCallView({
    name: payload.name,
    title: payload.title,
    toolKind: payload.toolKind,
    status,
    toolInput: payload.input,
    locations: payload.locations,
  })
}

function targetLabel(target: ToolCallTarget): string {
  if (target.type === 'path') return target.path.name
  if (target.type === 'command') return firstLine(target.command)
  if (target.type === 'pattern') return target.pattern
  if (target.type === 'url') return target.url.replace(/^https?:\/\//i, '')
  return target.text
}

function toolCallLine(payload: TurnEventPayload, status?: ToolCallStatus): string {
  const view = viewOf(payload, status)
  const target = clip(targetLabel(view.target), 48)
  return target ? `${view.verb} ${target}` : view.verb
}

function isFileChange(view: ToolCallView): boolean {
  return view.kind === 'edit' || view.kind === 'delete' || view.kind === 'move'
}

function editedFileNames(events: Array<Pick<TurnEventRow, 'kind' | 'payload'>>): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const event of events) {
    if (event.kind !== 'tool_start') continue
    const payload = payloadOf(event)
    const view = viewOf(payload, 'completed')
    if (!isFileChange(view) || view.target.type !== 'path') continue
    const name = view.target.path.name
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function lastSettledToolLine(
  events: Array<Pick<TurnEventRow, 'kind' | 'payload'>>,
): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.kind !== 'tool_start') continue
    return toolCallLine(payloadOf(event), 'completed')
  }
  return undefined
}

/** First-prompt title for a chat run; automations keep the name the user gave. */
export function runListTitle(input: { trigger: string; taskName: string; prompt: string }): string {
  const fallback = input.taskName.trim() || 'Chat'
  if (input.trigger === 'chat' || input.trigger === 'planner') {
    const fromPrompt = truncateSessionTitle(firstLine(input.prompt), TITLE_MAX)
    return fromPrompt || fallback
  }
  return fallback
}

/**
 * One-line "what happened". Live runs use the in-flight tool; finished runs
 * list edited files the way Cursor's history does, then fall back to the last
 * tool call.
 */
export function runActivitySummary(
  events: Array<Pick<TurnEventRow, 'kind' | 'payload'>>,
  opts: { running: boolean },
): string | undefined {
  if (opts.running) {
    const live = latestActivity(events)
    if (live.step?.trim()) return clip(live.step, SUMMARY_MAX)
    if (live.verb) return live.verb
    return undefined
  }

  const edited = editedFileNames(events)
  if (edited.length > 0) return clip(`Edited ${edited.join(', ')}`, SUMMARY_MAX)

  const last = lastSettledToolLine(events)
  return last ? clip(last, SUMMARY_MAX) : undefined
}
