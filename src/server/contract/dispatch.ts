/**
 * One dispatcher for every transport.
 *
 * A request arrives — as a server function call, a REST route, or a mobile
 * endpoint — and lands here with an operation id and a raw payload. This
 * module validates the payload against the contract's declared shape, checks
 * the calling client may reach the operation, and calls the named
 * `server/core.ts` export.
 *
 * Errors are values, never thrown, matching `server/mobile/handlers.ts` and
 * `server/integrations/dispatcher.ts` — so a route handler stays a thin shell
 * that turns a result into a `Response`.
 *
 * Two rules this module exists to keep:
 *
 *  - **Everything reaches the app through `core.ts`.** A descriptor names a
 *    core export and nothing else; there is no way to describe an operation
 *    that reaches past the facade.
 *  - **`core.ts` is imported lazily.** It boots the scheduler and pulls in
 *    `better-sqlite3`, so it is reached the same way `fns/index.ts` reaches it:
 *    `await import('../core')`, once per call. A static import here would pin
 *    it into the graph and defeat the code splitting every entry point relies
 *    on.
 */
import type { ClientId, Operation } from '../../contract/index.ts'
import { findOperation } from '../../contract/index.ts'
import { optionalShape, shape } from '../../lib/validate.ts'

export type DispatchResult = {
  ok: boolean
  status: number
  /** Present on success. `undefined` is normalised to `null` before it leaves. */
  body?: unknown
  /** Present on failure. */
  error?: string
}

/** See the note on lazy loading in this module's header. */
async function core(): Promise<Record<string, unknown>> {
  return (await import('../core')) as unknown as Record<string, unknown>
}

function fail(status: number, error: string): DispatchResult {
  return { ok: false, status, error }
}

/**
 * Validate a raw payload against an operation's declared shape.
 *
 * Returns the payload on success, or a `DispatchResult` describing the refusal.
 * `lib/validate.ts` throws with a message already written for a human, so the
 * message is passed straight through rather than rewritten here.
 */
export function validatePayload(
  op: Operation,
  raw: unknown,
): { ok: true; data: unknown } | DispatchResult {
  if (!op.input) return { ok: true, data: undefined }
  try {
    const data = op.inputOptional
      ? optionalShape(raw as Record<string, unknown>, op.input)
      : shape(raw as Record<string, unknown>, op.input)
    return { ok: true, data }
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : 'Invalid request')
  }
}

/** Build the argument list a core export expects, per the descriptor's `args`. */
export function buildArgs(op: Operation, data: unknown): unknown[] {
  if (op.args === 'none') return []
  if (op.args === 'payload') return [data]
  const payload = (data ?? {}) as Record<string, unknown>
  return op.args.map((field) => payload[field])
}

/**
 * Run one operation.
 *
 * `client` decides visibility only — it is not authentication. The caller has
 * already been authenticated by the global middleware in `src/start.ts` (or,
 * for a phone, by `server/mobile/auth.ts`); this is the narrower question of
 * whether the surface offers the operation at all.
 */
export async function dispatch(
  operationId: string,
  raw: unknown,
  client: ClientId,
): Promise<DispatchResult> {
  const op = findOperation(operationId)
  if (!op) return fail(404, 'Not found')

  if (!op.clients.includes(client)) {
    return fail(403, `"${op.id}" is not available to the ${client} client.`)
  }

  const validated = validatePayload(op, raw)
  if ('ok' in validated && validated.ok !== true) return validated as DispatchResult
  const { data } = validated as { ok: true; data: unknown }

  const mod = await core()
  const impl = mod[op.core]
  if (typeof impl !== 'function') {
    // A descriptor naming a missing export is a build-time mistake, and
    // `dispatch.test.ts` catches it. Answering 500 rather than crashing keeps
    // one bad row from taking the server down.
    return fail(500, `Operation "${op.id}" is not implemented.`)
  }

  try {
    const result = await (impl as (...args: unknown[]) => unknown)(...buildArgs(op, data))
    if (op.returnsOk) return { ok: true, status: 200, body: { ok: true } }
    // `turn_events` rows are forward-compatible and so is the wire: a value the
    // core omits travels as null rather than vanishing from the JSON.
    return { ok: true, status: 200, body: result === undefined ? null : result }
  } catch (err) {
    // Core throws for domain refusals — a missing workspace, an unready
    // runtime, a path outside the tree. Those are the caller's fault, not the
    // server's, so they are 400s carrying the message the gate would show.
    return fail(400, err instanceof Error ? err.message : 'Request failed')
  }
}
