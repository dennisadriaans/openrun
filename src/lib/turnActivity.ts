/**
 * What a running turn is doing right now, for the "Working for 12s · …" line.
 *
 * The transcript already renders every event; this is only the one-line
 * summary shown while the newest one is still in flight. Pure so the label the
 * chat shows and the label the mobile API sends can never disagree.
 */
import type { TurnEventPayload, TurnEventRow } from './turnEvents.ts'
import { toolCallVerb } from './toolCallView.ts'
import { toolKindFromName } from './acp.ts'

function payloadOf(event: Pick<TurnEventRow, 'payload'>): TurnEventPayload {
  try {
    return JSON.parse(event.payload) as TurnEventPayload
  } catch {
    return {}
  }
}

function firstLine(text: string, max = 80): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/**
 * The newest unsettled tool call, described the way its transcript row is —
 * or the agent's last words when it is thinking rather than calling a tool.
 */
export function latestActivityLabel(
  events: Array<Pick<TurnEventRow, 'kind' | 'payload'>>,
): string | undefined {
  const settled = new Set<string>()
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.kind === 'tool_result') {
      const id = payloadOf(event).toolCallId
      if (id) settled.add(id)
      continue
    }
    if (event.kind !== 'tool_start') continue
    const payload = payloadOf(event)
    if (payload.toolCallId && settled.has(payload.toolCallId)) continue
    const kind = payload.toolKind ?? toolKindFromName(payload.name)
    const verb = toolCallVerb(kind, payload.name, 'in_progress')
    const detail = payload.title ? firstLine(payload.title.split(' · ').slice(1).join(' · ')) : ''
    return detail ? `${verb} ${detail}` : verb
  }

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.kind !== 'thought' && event.kind !== 'assistant') continue
    const text = payloadOf(event).text
    if (text?.trim()) return firstLine(text)
  }
  return undefined
}
