/**
 * The vocabulary an operation descriptor is written in.
 *
 * Everything here is a type or a pure helper. No `node:` imports, no runtime
 * dependency — `src/contract/**` obeys the same browser-safe rule as
 * `src/lib/**`, because the generated TypeScript client ships to the browser
 * and the descriptors travel with it.
 *
 * The shape language is deliberately `lib/validate.ts`'s, not a new one. That
 * module already guards every server function at runtime and is already
 * tested; reusing it means the contract cannot describe a payload the
 * validator would not accept.
 */
import type { Shape } from '../lib/validate.ts'

/** HTTP verb. GET for reads, POST for everything that changes state. */
export type OperationMethod = 'GET' | 'POST'

/**
 * Which clients may reach an operation.
 *
 * `web` is the browser UI (TanStack today, Nuxt later); `desktop` is the macOS
 * app, which runs at full parity; `mobile` is a paired phone, deliberately
 * narrow. A client absent from the list gets a 403 naming the capability, not
 * a 404 — a caller should be able to tell "not for you" from "not a thing".
 */
export type ClientId = 'web' | 'desktop' | 'mobile'

/**
 * How the dispatcher passes the validated payload to its `core.ts` export.
 *
 * `'payload'` hands the whole object; `'none'` calls with no arguments; a field
 * list spreads named fields positionally, which is what the several
 * `core.getRun(data.id)` style handlers need.
 */
export type ArgStyle = 'payload' | 'none' | readonly string[]

/**
 * One capability, described once.
 *
 * `core` names an export of `server/core.ts`. Nothing here imports that module
 * — the contract stays browser-safe — so the link is checked by
 * `server/contract/dispatch.test.ts`, which fails if the export is missing.
 */
export type Operation = {
  /** Stable dotted id, `group.action`. The wire name; never renamed lightly. */
  readonly id: string
  /** The `fns/index.ts` export this replaced. Keeps existing UI callers working. */
  readonly fn: string
  readonly method: OperationMethod
  /** Versioned path. `/api/v1/<group>/<action>`. */
  readonly path: string
  /** The `server/core.ts` export that answers it. */
  readonly core: string
  readonly args: ArgStyle
  /** Payload shape, or `null` for an operation that takes no arguments. */
  readonly input: Shape | null
  /**
   * The payload's TypeScript type, as source text.
   *
   * `input` is what the runtime validator checks; this is what the *compiler*
   * checks, and it carries detail a shape cannot express — string unions,
   * imported interfaces, nested objects. The server-function generator emits
   * it verbatim, so a wrong type here fails `pnpm typecheck` rather than
   * passing silently.
   *
   * Names referenced here must be importable in the generated file; see
   * `GENERATED_IMPORTS` in `scripts/contract/generate.ts`.
   */
  readonly inputType?: string
  /** True when the payload may be absent entirely (several list endpoints). */
  readonly inputOptional?: boolean
  /** Handler coerces `undefined` to `null` so the wire always carries a value. */
  readonly nullable?: boolean
  /** Core returns void; the operation answers `{ ok: true }`. */
  readonly returnsOk?: boolean
  /** Permission this operation requires. Mobile ops reuse `MobileOp` strings. */
  readonly capability: string
  readonly clients: readonly ClientId[]
  readonly summary?: string
}

/** Every operation a given client may reach. */
export function operationsFor(
  operations: readonly Operation[],
  client: ClientId,
): readonly Operation[] {
  return operations.filter((op) => op.clients.includes(client))
}

/** Look one up by its dotted id. */
export function operationById(operations: readonly Operation[], id: string): Operation | undefined {
  return operations.find((op) => op.id === id)
}

/**
 * Whether `client` may perform `op`.
 *
 * The single place this question is answered. Route guards call it; the
 * generated clients read the same list to know what not to offer.
 */
export function clientAllows(op: Operation, client: ClientId): boolean {
  return op.clients.includes(client)
}
