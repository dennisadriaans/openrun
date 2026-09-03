/**
 * The contract: one description of every capability, read by every transport.
 *
 * Import this, never `operations.ts` directly — the helpers here are what the
 * route guards, the generated clients and the dispatcher agree on.
 *
 * Browser-safe and dependency-free, same rule as `src/lib/**`. Enforced by
 * `contract.test.ts`.
 */
export type { ClientId, Operation, OperationMethod, ArgStyle } from './types.ts'
export { clientAllows, operationById, operationsFor } from './types.ts'

import type { ClientId, Operation } from './types.ts'
import { OPERATIONS } from './operations.ts'

export { OPERATIONS }

/** Current wire version. Bumped only for a breaking change to an existing op. */
export const API_VERSION = 'v1'

/** Path prefix every generated route sits under. */
export const API_PREFIX = `/api/${API_VERSION}`

/** Every operation, widened from the `as const` literal for ordinary use. */
export const operations: readonly Operation[] = OPERATIONS

/** Dotted ids, sorted — handy for tests and for the OpenAPI emitter. */
export const operationIds: readonly string[] = operations.map((op) => op.id).sort()

const BY_ID = new Map(operations.map((op) => [op.id, op]))
const BY_PATH = new Map(operations.map((op) => [`${op.method} ${op.path}`, op]))
const BY_FN = new Map(operations.map((op) => [op.fn, op]))

/** Look up by dotted id. */
export function findOperation(id: string): Operation | undefined {
  return BY_ID.get(id)
}

/** Look up by the method and path a request arrived on. */
export function findOperationByRoute(method: string, path: string): Operation | undefined {
  return BY_PATH.get(`${method.toUpperCase()} ${path}`)
}

/** Look up by the legacy `fns/index.ts` export name. */
export function findOperationByFn(fn: string): Operation | undefined {
  return BY_FN.get(fn)
}

/** Every operation a client may reach, in registry order. */
export function operationsForClient(client: ClientId): readonly Operation[] {
  return operations.filter((op) => op.clients.includes(client))
}

/** Every distinct capability string, sorted. */
export function capabilities(): readonly string[] {
  return [...new Set(operations.map((op) => op.capability))].sort()
}
