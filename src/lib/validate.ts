/**
 * Runtime shape checks for server function payloads.
 *
 * `createServerFn().validator((d: { id: string }) => d)` reads like validation
 * and is not: the annotation is erased at build time, so the arrow function is
 * an identity and *any* JSON reaches the handler. Every server function was
 * written that way, which means a caller could hand `runId: { toString }` — or
 * `__proto__` — to a handler that goes on to resolve a working directory,
 * write a workspace file, or spawn a CLI.
 *
 * Nothing here replaces the domain rules that already exist (`assertChecks`,
 * `assertArgsTemplate`, `assertWebhookUrl`, `resolveInsideWorkspace`). This is
 * the layer below those: it guarantees a handler receives the *types* its
 * signature claims, so those rules are reasoning about a string rather than
 * about whatever arrived.
 *
 * Deliberately permissive about unknown keys. A payload from a newer client
 * carrying a field this build has not heard of is forward compatibility, not
 * an attack, and the same tolerance is what `turn_events` rows already rely on.
 *
 * Pure and browser-safe.
 */

/** What a declared field may be. A trailing `?` marks it optional. */
export type FieldType =
  | 'string'
  | 'string?'
  | 'number'
  | 'number?'
  | 'boolean'
  | 'boolean?'
  | 'string[]'
  | 'string[]?'
  | 'object'
  | 'object?'
  | 'array'
  | 'array?'
  /** Present and non-null, but the domain layer owns its shape. */
  | 'any'
  | 'any?'

export type Shape = Record<string, FieldType>

/**
 * Keys that must never be carried into an object we then spread, index, or
 * hand to better-sqlite3 as named parameters.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function invalidPayloadMessage(detail: string): string {
  return `Invalid request: ${detail}.`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function typeError(field: string, expected: string): Error {
  return new Error(invalidPayloadMessage(`"${field}" must be ${expected}`))
}

function checkField(field: string, type: FieldType, value: unknown): void {
  const optional = type.endsWith('?')
  if (value === undefined || value === null) {
    if (optional) return
    throw new Error(invalidPayloadMessage(`"${field}" is required`))
  }

  const base = optional ? type.slice(0, -1) : type
  switch (base) {
    case 'string':
      if (typeof value !== 'string') throw typeError(field, 'a string')
      return
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw typeError(field, 'a finite number')
      }
      return
    case 'boolean':
      if (typeof value !== 'boolean') throw typeError(field, 'true or false')
      return
    case 'string[]':
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        throw typeError(field, 'an array of strings')
      }
      return
    case 'array':
      if (!Array.isArray(value)) throw typeError(field, 'an array')
      return
    case 'object':
      if (!isPlainObject(value)) throw typeError(field, 'an object')
      return
    case 'any':
      return
  }
}

/**
 * Assert `value` is an object matching `shape`, and hand it back unchanged.
 *
 * Returns its input so it drops straight into a validator without disturbing
 * the type annotation that types the handler:
 *
 * ```ts
 * .validator((d: { runId: string }) => shape(d, { runId: 'string' }))
 * ```
 */
export function shape<T>(value: T, spec: Shape): T {
  if (!isPlainObject(value)) {
    throw new Error(invalidPayloadMessage('expected an object'))
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(invalidPayloadMessage(`"${key}" is not an allowed field`))
    }
  }
  for (const [field, type] of Object.entries(spec)) {
    checkField(field, type, value[field])
  }
  return value
}

/**
 * The same check for a payload that may legitimately be absent entirely —
 * several list endpoints are called with no argument at all.
 */
export function optionalShape<T>(value: T, spec: Shape): T {
  if (value === undefined || value === null) return value
  return shape(value, spec)
}
