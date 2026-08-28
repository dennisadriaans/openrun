/**
 * What a running turn is doing right now, for the working line.
 *
 * The transcript already renders every event; this is only the one-line
 * summary shown while the newest one is still in flight. Pure so the label the
 * chat shows and the label the mobile API sends can never disagree.
 */
import type { TurnEventPayload, TurnEventRow } from './turnEvents.ts'
import { toolCallVerb } from './toolCallView.ts'
import { resolveToolKind, toolKindFromName, type ToolCallStatus } from './acp.ts'
import { isToolCallRole, type ToolCallRole } from './toolCallRole.ts'
import { orbStateForTool, orbVerb, type ActivityOrbState } from './orbState.ts'

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

function callRoleOf(payload: TurnEventPayload): ToolCallRole | undefined {
  return isToolCallRole(payload.callRole) ? payload.callRole : undefined
}

function hasOpenApproval(events: Array<Pick<TurnEventRow, 'kind' | 'payload'>>): boolean {
  const resolved = new Set<string>()
  for (const event of events) {
    if (event.kind !== 'approval_resolved') continue
    const id = payloadOf(event).requestId
    if (id) resolved.add(id)
  }
  for (const event of events) {
    if (event.kind !== 'approval_request') continue
    const id = payloadOf(event).requestId
    if (id && !resolved.has(id)) return true
  }
  return false
}

export type TurnActivity = {
  orb: ActivityOrbState
  verb: string
  step?: string
}

export type TurnActivityStep = {
  key: string
  label: string
  status: ToolCallStatus
}

function toolStepLabel(payload: TurnEventPayload, status: ToolCallStatus): string {
  const kind =
    resolveToolKind(payload.name, payload.toolKind, payload.input, payload.title) ??
    toolKindFromName(payload.name)
  const verb = toolCallVerb(kind, payload.name, status)
  const detail = payload.title
    ? firstLine(payload.title.split(' · ').slice(1).join(' · '), 160)
    : ''
  return detail ? `${verb} ${detail}` : verb
}

/**
 * Concrete progress reported during a live turn. This can only describe
 * events the runtime emits; a long-running shell command remains one active
 * step until the CLI reports its result.
 */
export function activitySteps(
  events: Array<Pick<TurnEventRow, 'kind' | 'payload'>>,
): TurnActivityStep[] {
  const results = new Map<string, TurnEventPayload>()
  for (const event of events) {
    if (event.kind !== 'tool_result') continue
    const payload = payloadOf(event)
    if (payload.toolCallId) results.set(payload.toolCallId, payload)
  }

  const steps: TurnActivityStep[] = []
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!
    const payload = payloadOf(event)
    if (event.kind === 'thought' && payload.text?.trim()) {
      steps.push({
        key: `thought-${index}`,
        label: `Thinking · ${firstLine(payload.text, 160)}`,
        status: 'completed',
      })
      continue
    }
    if (event.kind !== 'tool_start') continue
    const result = payload.toolCallId ? results.get(payload.toolCallId) : undefined
    const status = result ? (result.status ?? 'completed') : (payload.status ?? 'in_progress')
    steps.push({
      key: payload.toolCallId ? `tool-${payload.toolCallId}` : `tool-${index}`,
      label: toolStepLabel(payload, status),
      status,
    })
  }
  return steps
}

/**
 * The newest unsettled tool call, described the way its transcript row is —
 * or the agent's last words when it is thinking rather than calling a tool.
 */
export function latestActivityLabel(
  events: Array<Pick<TurnEventRow, 'kind' | 'payload'>>,
): string | undefined {
  return latestActivity(events).step
}

/** Live working-line model: orb + verb + optional detail. */
export function latestActivity(
  events: Array<Pick<TurnEventRow, 'kind' | 'payload'>>,
): TurnActivity {
  if (hasOpenApproval(events)) {
    return { orb: 'listening', verb: orbVerb('listening'), step: 'approval' }
  }

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
    const kind =
      resolveToolKind(payload.name, payload.toolKind, payload.input, payload.title) ??
      toolKindFromName(payload.name)
    const role = callRoleOf(payload)
    const orb = orbStateForTool({ toolKind: kind, ...(role ? { callRole: role } : {}) })
    const verb = toolCallVerb(kind, payload.name, 'in_progress')
    const detail = payload.title ? firstLine(payload.title.split(' · ').slice(1).join(' · ')) : ''
    return detail
      ? { orb, verb: 'Working', step: `${verb} ${detail}` }
      : { orb, verb: 'Working', step: verb }
  }

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.kind === 'thought') {
      const text = payloadOf(event).text
      return {
        orb: 'solving',
        verb: orbVerb('solving'),
        ...(text?.trim() ? { step: firstLine(text) } : {}),
      }
    }
    if (event.kind === 'plan') {
      const running = payloadOf(event).plan?.find((entry) => entry.status === 'in_progress')
      if (running) {
        return { orb: 'solving', verb: orbVerb('solving'), step: firstLine(running.content) }
      }
    }
    if (event.kind === 'assistant') {
      const text = payloadOf(event).text
      if (text?.trim()) {
        return { orb: 'composing', verb: orbVerb('composing'), step: firstLine(text) }
      }
    }
  }

  return { orb: 'breathing', verb: orbVerb('breathing') }
}
