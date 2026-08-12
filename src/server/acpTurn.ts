/**
 * Agent Client Protocol transport.
 *
 * The CLI path in `executor.ts` spawns a binary and parses whatever JSON it
 * prints. This path spawns an agent that speaks ACP and drives it over JSON-RPC
 * instead: `initialize` → `session/new` (or `session/load` to resume) →
 * `session/prompt`, reading `session/update` notifications until the prompt
 * turn stops.
 *
 * What that buys, versus parsing stdout:
 *  - tool calls arrive with a title, kind, status and file locations already
 *    set, instead of being inferred from a tool name;
 *  - `session/request_permission` is a real request/response, so Supervised
 *    mode works for *any* ACP agent rather than only Claude's stdio control
 *    protocol;
 *  - a session id comes back from the protocol, so resume needs no scraping.
 *
 * The executor still owns the DB, the message rows, cancellation and the run
 * budget; this module is handed a small set of callbacks and never touches
 * SQLite. Mapping updates to turn events lives in `lib/agentEvents/acp.ts` so
 * it stays unit-testable without a subprocess.
 */
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import type { PermissionOption } from '../lib/acp'
import { cancelledOutcome, permissionOutcome } from '../lib/approvals'
import { parseAcpSessionUpdate } from '../lib/agentEvents/acp.ts'
import type { ParsedTurnEvent } from '../lib/agentEvents/types.ts'
import { agentSpawnOptions } from './processControl'

export type AcpTurnHandle = {
  /** The live child process, so the executor can kill it like any other. */
  child: ReturnType<typeof spawn>
  /**
   * Answer an outstanding permission request. Returns false when the id is
   * unknown (already answered, timed out, or the turn ended).
   */
  answer: (requestId: string, optionId: string) => boolean
  /** True while at least one permission request is waiting on a human. */
  hasPending: () => boolean
  /** Cancel every outstanding permission request (run ending). */
  cancelPending: () => void
}

export type AcpTurnCallbacks = {
  /** Canonical turn events, in order. */
  onEvents: (events: ParsedTurnEvent[]) => void
  /** Raw protocol traffic for the process log (stderr of the agent). */
  onLog: (stream: 'stdout' | 'stderr', chunk: string) => void
  /** The protocol's session id, once known, so follow-ups can resume it. */
  onSessionId: (sessionId: string) => void
  /**
   * The turn finished. `code` mirrors a process exit code so the executor's
   * existing success/error handling applies unchanged: 0 for a normal stop,
   * 1 for a protocol or agent error.
   */
  onDone: (result: { code: number; error?: string }) => void
}

export type AcpTurnInput = {
  bin: string
  args: string[]
  cwd: string
  prompt: string
  /** Existing ACP session to resume; empty for a first turn. */
  sessionId: string
}

/** A permission request waiting on a human decision. */
type PendingPermission = {
  resolve: (
    outcome: ReturnType<typeof permissionOutcome> | ReturnType<typeof cancelledOutcome>,
  ) => void
  options: PermissionOption[]
}

/** ACP ids are opaque strings; ours just need to be unique within a turn. */
function requestId(seq: number): string {
  return `acp-perm-${seq}`
}

/**
 * Normalize the options an agent offered into our `PermissionOption` shape.
 * Agents may send extra fields (`_meta`) and any option ids they like — the UI
 * renders whatever comes back, so an agent that offers "always allow" gets that
 * button without us knowing about it in advance.
 */
function normalizeOptions(raw: unknown): PermissionOption[] {
  if (!Array.isArray(raw)) return []
  const out: PermissionOption[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    if (typeof o.optionId !== 'string' || typeof o.name !== 'string') continue
    const kind = o.kind
    if (
      kind !== 'allow_once' &&
      kind !== 'allow_always' &&
      kind !== 'reject_once' &&
      kind !== 'reject_always'
    ) {
      continue
    }
    out.push({ optionId: o.optionId, name: o.name, kind })
  }
  return out
}

/**
 * Run one prompt turn against an ACP agent.
 *
 * Returns as soon as the child is spawned; everything else arrives through the
 * callbacks. Errors are reported via `onDone` rather than thrown, so the caller
 * has exactly one completion path to handle.
 */
export function startAcpTurn(input: AcpTurnInput, cb: AcpTurnCallbacks): AcpTurnHandle {
  const child = spawn(input.bin, input.args, agentSpawnOptions(input.cwd))

  const pending = new Map<string, PendingPermission>()
  let permissionSeq = 0
  let finished = false

  const finish = (result: { code: number; error?: string }) => {
    if (finished) return
    finished = true
    cancelPending()
    cb.onDone(result)
  }

  function cancelPending() {
    for (const [, entry] of pending) entry.resolve(cancelledOutcome())
    pending.clear()
  }

  const answer = (id: string, optionId: string): boolean => {
    const entry = pending.get(id)
    if (!entry) return false
    pending.delete(id)
    entry.resolve(permissionOutcome(optionId))
    return true
  }

  child.stderr?.on('data', (d: Buffer) => cb.onLog('stderr', d.toString()))
  child.on('error', (err) => {
    finish({ code: 1, error: `Failed to start ACP agent "${input.bin}": ${err.message}` })
  })
  child.on('close', (code) => {
    // A clean protocol turn calls finish() first; reaching here before that
    // means the agent died mid-turn.
    finish({
      code: code === 0 ? 0 : 1,
      error: finished ? undefined : `ACP agent exited before the turn completed (code ${code})`,
    })
  })

  if (!child.stdin || !child.stdout) {
    // Deferred so the caller has its handle (and its live-process bookkeeping)
    // in place before the completion callback runs.
    queueMicrotask(() => finish({ code: 1, error: 'ACP agent has no stdio pipes' }))
    return { child, answer, hasPending: () => false, cancelPending }
  }

  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  )

  void acp
    .client({ name: 'agentops' })
    .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
      const params = ctx.params as unknown as Record<string, unknown>
      const toolCall = (params.toolCall ?? {}) as Record<string, unknown>
      const options = normalizeOptions(params.options)
      permissionSeq += 1
      const id = requestId(permissionSeq)

      const outcome = await new Promise<ReturnType<typeof permissionOutcome>>((resolve) => {
        pending.set(id, { resolve, options })
        cb.onEvents([
          {
            kind: 'approval_request',
            payload: {
              requestId: id,
              name: typeof toolCall.toolName === 'string' ? toolCall.toolName : undefined,
              title: typeof toolCall.title === 'string' ? toolCall.title : 'Tool call',
              toolCallId: typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : undefined,
              input: toolCall.rawInput,
              options,
            },
          },
        ])
        // The turn dying while a prompt is open must not leave the agent
        // waiting forever for a JSON-RPC response.
        ctx.signal.addEventListener('abort', () => {
          if (!pending.delete(id)) return
          resolve(cancelledOutcome())
        })
      })

      return { outcome } as never
    })
    // The agent is running against the same working tree we are, so it can read
    // and write files itself; declining these keeps one writer.
    .onNotification(acp.methods.client.session.update, (ctx) => {
      const params = ctx.params as unknown as { update?: unknown }
      const events = parseAcpSessionUpdate(
        (params.update ?? {}) as Record<string, unknown> & { sessionUpdate?: string },
      )
      if (events.length > 0) cb.onEvents(events)
    })
    .connectWith(stream, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      })

      // Sessions are driven with plain requests rather than the SDK's
      // `ActiveSession` helper: that helper only routes updates for sessions it
      // created with `session/new`, and a resumed turn needs `session/load`.
      // The notification handler above already sees every update, so the only
      // thing left to await is the prompt response.
      let sessionId = ''
      if (input.sessionId) {
        // Resuming is best-effort: an agent that cannot load the old session
        // still answers the prompt, it just starts a fresh one. Losing the
        // thread beats failing the turn outright.
        try {
          await ctx.request(acp.methods.agent.session.load, {
            sessionId: input.sessionId,
            cwd: input.cwd,
            mcpServers: [],
          })
          sessionId = input.sessionId
        } catch (err) {
          cb.onLog('stderr', `\n[acp] could not resume session: ${String(err)}\n`)
        }
      }
      if (!sessionId) {
        const created = await ctx.request(acp.methods.agent.session.new, {
          cwd: input.cwd,
          mcpServers: [],
        })
        sessionId = created.sessionId
      }

      cb.onSessionId(sessionId)

      const response = await ctx.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: 'text', text: input.prompt }],
      })

      cb.onEvents([{ kind: 'turn_done', payload: { stopReason: response.stopReason } }])
      // `refusal` is the agent declining the work — a failed turn as far as the
      // run's verdict is concerned. Everything else stopped normally.
      return response.stopReason === 'refusal' ? 1 : 0
    })
    .then((code) => finish({ code }))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      cb.onEvents([{ kind: 'error', payload: { message } }])
      finish({ code: 1, error: message })
    })

  return {
    child,
    answer,
    hasPending: () => pending.size > 0,
    cancelPending,
  }
}
