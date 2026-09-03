/**
 * Emit every transport from the operation registry.
 *
 *   pnpm contract:generate   write and format every output
 *   pnpm contract:check      regenerate, then fail if anything changed
 *
 * Outputs, all committed and never hand-edited:
 *
 *   src/fns/index.ts                       TanStack server functions (web)
 *   src/contract/generated/client.ts       typed fetch client (web, Nuxt)
 *   src/contract/generated/openapi.json    the published contract
 *   clients/apple/OpenRunKit/…/Generated.swift   Swift operations + requests
 *
 * Drift is caught the same way a stale `routeTree.gen.ts` is: regenerate, then
 * `git diff --exit-code`. A hand-edit or a stale commit fails CI. Pure string
 * building — no network, no database, no app boot.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { API_PREFIX, operations } from '../../src/contract/index.ts'
// The heartbeat period the SSE factories already share. Emitting it into Swift
// rather than restating it there is the whole point: `liveStream.ts` owns the
// number, and a change to it reaches the Apple clients on the next generate.
import { SERVER_PING_MS, STALE_AFTER_MS } from '../../src/lib/liveStream.ts'
import type { Operation } from '../../src/contract/index.ts'

const ROOT = join(import.meta.dirname, '..', '..')

const BANNER = `/**
 * GENERATED — do not edit.
 *
 * Every operation here comes from \`src/contract/operations.ts\`. Change the
 * descriptor and run \`pnpm contract:generate\`; editing this file by hand is
 * undone by the next run and fails the \`contract drift\` check in CI.
 */`

// ---------------------------------------------------------------------------
// Server functions — the web client's typed RPC surface
// ---------------------------------------------------------------------------

/**
 * Types the emitted validators refer to.
 *
 * Kept verbatim from the hand-written file this replaced: these are the names
 * `inputType` strings mention, and the `export type` block the UI imports from
 * `fns/index.ts` today.
 */
/**
 * Where each name an `inputType` may mention comes from.
 *
 * Only the names actually referenced are imported — `tsconfig` sets
 * `noUnusedLocals`, so an import the generated file does not use fails the
 * typecheck.
 */
const TYPE_SOURCES: Record<string, string> = {
  CreateIntegrationAutomationInput: '../server/core',
  CreateIntegrationInput: '../server/core',
  NotifierInput: '../server/core',
  PreviewCommandInput: '../server/core',
  RuntimeInput: '../server/core',
  TaskInput: '../server/core',
  UpdateIntegrationInput: '../server/core',
  PlanProposal: '../lib/planProposals',
  IntegrationProviderId: '../lib/integrations/types',
  WebhookFilters: '../lib/integrations/types',
  CheckDef: '../lib/checks',
  McpServerConfig: '../lib/mcp',
}

/** Import lines for exactly the types the emitted source mentions. */
function typeImportsFor(body: string): string {
  const byModule = new Map<string, string[]>()
  for (const [name, module] of Object.entries(TYPE_SOURCES)) {
    if (!new RegExp(`\\b${name}\\b`).test(body)) continue
    if (!byModule.has(module)) byModule.set(module, [])
    byModule.get(module)!.push(name)
  }
  return [...byModule]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, names]) => `import type { ${names.sort().join(', ')} } from '${module}'`)
    .join('\n')
}

const GENERATED_IMPORTS = `import { createServerFn } from '@tanstack/react-start'
import { optionalShape, shape } from '../lib/validate.ts'`

const FNS_PREAMBLE = `
/**
 * The dispatcher is reached lazily, exactly as \`server/core\` was before it.
 * That laziness is what keeps \`better-sqlite3\`, \`node-cron\` and
 * \`child_process\` out of the client bundle — a top-level static import of
 * anything under \`server/\` here breaks the client build.
 */
const dispatcher = () => import('../server/contract/dispatch')

/**
 * Turn a dispatch result back into the throw-or-value contract React Query
 * expects. A domain refusal arrives as \`ok: false\` carrying the message the
 * gate would have shown, and becomes an \`Error\` with those exact words.
 */
async function run(id: string, data?: unknown): Promise<unknown> {
  const { dispatch } = await dispatcher()
  const result = await dispatch(id, data, 'web')
  if (!result.ok) throw new Error(result.error ?? 'Request failed')
  return result.body
}

/**
 * Return types, recovered from the facade.
 *
 * Dispatch is one generic function, so it cannot carry per-operation return
 * types on its own. \`typeof import(...)\` is erased at compile time — no
 * runtime import, nothing added to the client bundle — so the generated
 * handlers can name \`core.ts\`'s own inferred types and every caller in
 * \`lib/queries.ts\` keeps the types it had before the contract existed.
 */
type Core = typeof import('../server/core')
type CoreResult<K extends keyof Core> = Core[K] extends (...args: never[]) => infer R
  ? Awaited<R>
  : never
/** Handlers that coerced \`undefined\` to \`null\` keep doing so. */
type Nullable<T> = Exclude<T, undefined> | null
`

/**
 * The type the generated handler asserts.
 *
 * Mirrors what the hand-written handler produced: `{ ok: true }` where it
 * returned a literal, `T | null` where it wrote `?? null`, and otherwise
 * whatever the core export is inferred to return.
 */
function returnType(op: Operation): string {
  if (op.returnsOk) return 'Promise<{ ok: true }>'
  const base = `CoreResult<'${op.core}'>`
  return op.nullable ? `Promise<Nullable<${base}>>` : `Promise<${base}>`
}

function shapeLiteral(input: Record<string, string>): string {
  // Bare keys where the field name allows it — quoting every key would be
  // valid but reads as machine output, and `fns/validators.test.ts` greps this
  // file for `field: 'string'`.
  const entries = Object.entries(input).map(([k, v]) => {
    const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k)
    return `${key}: '${v}'`
  })
  const oneLine = `{ ${entries.join(', ')} }`
  return oneLine.length <= 84 ? oneLine : `{\n      ${entries.join(',\n      ')},\n    }`
}

function emitServerFn(op: Operation): string {
  const lines: string[] = []
  if (op.summary) lines.push(`/** ${op.summary} */`)
  lines.push(`export const ${op.fn} = createServerFn({ method: '${op.method}' })`)

  if (op.input) {
    const checker = op.inputOptional ? 'optionalShape' : 'shape'
    const type = op.inputType ?? 'Record<string, unknown>'
    const spec = shapeLiteral(op.input as Record<string, string>)
    const validator = `  .validator((d: ${type}) => ${checker}(d, ${spec}))`
    lines.push(
      validator.length <= 100
        ? validator
        : `  .validator((d: ${type}) =>\n    ${checker}(d, ${spec}),\n  )`,
    )
    lines.push(`  .handler(async ({ data }) => run('${op.id}', data) as ${returnType(op)})`)
  } else {
    lines.push(`  .handler(async () => run('${op.id}') as ${returnType(op)})`)
  }
  return lines.join('\n')
}

function buildFns(): string {
  const groups = new Map<string, Operation[]>()
  for (const op of operations) {
    const group = op.id.split('.')[0]
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(op)
  }

  let body = ''
  for (const [group, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    body += `\n// --- ${group} ${'-'.repeat(Math.max(1, 72 - group.length))}\n\n`
    body += list.map(emitServerFn).join('\n\n')
    body += '\n'
  }

  return `${BANNER}
${GENERATED_IMPORTS}
${typeImportsFor(body)}

export type { PlanProposal } from '../lib/planProposals'

export type {
  LocalDirEntry,
  LocalPlace,
  ProjectRow,
  WorkspaceRow,
  ProjectWithMeta,
  WorkspaceWithMeta,
  IntegrationPublic,
  TaskWithMeta,
} from '../server/core'
${FNS_PREAMBLE}${body}`
}

// ---------------------------------------------------------------------------
// Typed fetch client — what a Nuxt app or any non-TanStack TS caller uses
// ---------------------------------------------------------------------------

/**
 * A structural TypeScript type for a payload, built from the declared shape.
 *
 * The client is the one artifact that must stay importable from anywhere — a
 * Nuxt app in another package, a script, a test — so it names no type it would
 * have to reach into `server/` or `lib/` for. Precision is traded for
 * portability on purpose: `object` where the server says `McpServerConfig`.
 */
function tsTypeFromShape(input: Record<string, string> | null): string {
  if (!input) return 'void'
  const TS: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    'string[]': 'string[]',
    object: 'Record<string, unknown>',
    array: 'unknown[]',
    any: 'unknown',
  }
  const fields = Object.entries(input).map(([field, type]) => {
    const optional = type.endsWith('?')
    const base = optional ? type.slice(0, -1) : type
    return `${field}${optional ? '?' : ''}: ${TS[base] ?? 'unknown'}`
  })
  return `{ ${fields.join('; ')} }`
}

function buildTsClient(): string {
  const methods = operations
    .map((op) => {
      const doc = op.summary ? `  /** ${op.summary} */\n` : ''
      const type = tsTypeFromShape(op.input as Record<string, string> | null)
      if (!op.input) {
        return `${doc}  ${op.fn}(): Promise<unknown> {\n    return this.call('${op.id}')\n  }`
      }
      const arg = op.inputOptional ? `input?: ${type}` : `input: ${type}`
      return `${doc}  ${op.fn}(${arg}): Promise<unknown> {\n    return this.call('${op.id}', input)\n  }`
    })
    .join('\n\n')

  const table = operations
    .map((op) => `  '${op.id}': { method: '${op.method}', path: '${op.path}' },`)
    .join('\n')

  return `${BANNER}
/**
 * Transport-only client. It knows how to reach an operation and how to turn a
 * refusal into an \`Error\`; it knows nothing about React, Vue, or caching —
 * bind it to whichever reactivity layer a client uses.
 *
 * Browser-safe: \`fetch\` and nothing else.
 */

export type RouteInfo = { method: 'GET' | 'POST'; path: string }

export const ROUTES: Record<string, RouteInfo> = {
${table}
}

export type ClientOptions = {
  /** Origin the server is on. Same-origin by default. */
  baseUrl?: string
  /** Bearer token for a non-browser client. Browsers send the access cookie. */
  token?: string
  fetch?: typeof globalThis.fetch
}

/** Thrown for any non-2xx answer, carrying the server's own words. */
export class OpenRunError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'OpenRunError'
    this.status = status
  }
}

export class OpenRunClient {
  private readonly baseUrl: string
  private readonly token?: string
  private readonly doFetch: typeof globalThis.fetch

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\\/$/, '')
    this.token = options.token
    this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  /** Reach one operation by id. Every method below is a thin wrapper over this. */
  async call(id: string, input?: unknown): Promise<unknown> {
    const route = ROUTES[id]
    if (!route) throw new OpenRunError(\`Unknown operation "\${id}"\`, 404)

    const headers: Record<string, string> = { accept: 'application/json' }
    if (this.token) headers.authorization = \`Bearer \${this.token}\`

    let url = \`\${this.baseUrl}\${route.path}\`
    let body: string | undefined

    if (route.method === 'GET') {
      if (input !== undefined) {
        url += \`?input=\${encodeURIComponent(JSON.stringify(input))}\`
      }
    } else if (input !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(input)
    }

    const response = await this.doFetch(url, { method: route.method, headers, body })
    const text = await response.text()
    const payload = text ? JSON.parse(text) : null

    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && typeof payload.error === 'string'
          ? payload.error
          : \`Request failed with \${response.status}\`
      throw new OpenRunError(message, response.status)
    }
    return payload
  }

${methods}
}
`
}

// ---------------------------------------------------------------------------
// OpenAPI — the published contract
// ---------------------------------------------------------------------------

const JSON_TYPES: Record<string, unknown> = {
  string: { type: 'string' },
  number: { type: 'number' },
  boolean: { type: 'boolean' },
  'string[]': { type: 'array', items: { type: 'string' } },
  object: { type: 'object' },
  array: { type: 'array' },
  any: {},
}

function jsonSchemaFor(op: Operation): Record<string, unknown> | null {
  if (!op.input) return null
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [field, type] of Object.entries(op.input as Record<string, string>)) {
    const optional = type.endsWith('?')
    const base = optional ? type.slice(0, -1) : type
    properties[field] = JSON_TYPES[base] ?? {}
    if (!optional) required.push(field)
  }
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: true,
  }
}

function buildOpenApi(): string {
  const paths: Record<string, unknown> = {}

  for (const op of operations) {
    const schema = jsonSchemaFor(op)
    const spec: Record<string, unknown> = {
      operationId: op.id,
      summary: op.summary ?? op.id,
      tags: [op.id.split('.')[0]],
      responses: {
        '200': { description: 'Success', content: { 'application/json': { schema: {} } } },
        '400': { $ref: '#/components/responses/Refused' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
      },
    }
    // Documented so a client author can see, from the contract alone, which
    // surfaces an operation is offered on.
    spec['x-openrun-clients'] = op.clients
    spec['x-openrun-capability'] = op.capability

    if (schema) {
      if (op.method === 'GET') {
        spec.parameters = [
          {
            name: 'input',
            in: 'query',
            required: !op.inputOptional,
            description: 'JSON-encoded payload.',
            schema: { type: 'string' },
          },
        ]
      } else {
        spec.requestBody = {
          required: !op.inputOptional,
          content: { 'application/json': { schema } },
        }
      }
    }
    paths[op.path] = { ...(paths[op.path] as object), [op.method.toLowerCase()]: spec }
  }

  const doc = {
    openapi: '3.1.0',
    info: {
      title: 'Open Run',
      version: '1.0.0',
      description:
        'Every capability Open Run exposes. Generated from src/contract/operations.ts — ' +
        'the same list that generates the server functions, the typed client and OpenRunKit.',
    },
    servers: [{ url: 'http://127.0.0.1:3000', description: 'The local Open Run server' }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'Device or access token.' },
      },
      responses: {
        Refused: { description: 'The operation refused; the body carries the reason.' },
        Unauthorized: { description: 'Missing or unrecognised token.' },
        Forbidden: { description: 'This client may not reach this operation.' },
      },
    },
    security: [{ bearer: [] }],
    paths,
  }
  return `${JSON.stringify(doc, null, 2)}\n`
}

// ---------------------------------------------------------------------------
// Swift — OpenRunKit, shared by the iOS and macOS apps
// ---------------------------------------------------------------------------

const SWIFT_TYPES: Record<string, string> = {
  string: 'String',
  number: 'Double',
  boolean: 'Bool',
  'string[]': '[String]',
  object: 'JSONValue',
  array: '[JSONValue]',
  any: 'JSONValue',
}

function swiftName(id: string): string {
  const parts = id.split(/[.\-_]/)
  return parts
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
}

function buildSwift(): string {
  const cases = operations
    .map((op) => {
      const doc = op.summary ? `    /// ${op.summary}\n` : ''
      return `${doc}    case ${swiftName(op.id)} = "${op.id}"`
    })
    .join('\n')

  const routes = operations
    .map(
      (op) =>
        `        case .${swiftName(op.id)}: return Route(method: "${op.method}", path: "${op.path}", capability: "${op.capability}", clients: [${op.clients.map((c) => `"${c}"`).join(', ')}])`,
    )
    .join('\n')

  const requests = operations
    .filter((op) => op.input)
    .map((op) => {
      const fields = Object.entries(op.input as Record<string, string>)
        .map(([field, type]) => {
          const optional = type.endsWith('?')
          const base = optional ? type.slice(0, -1) : type
          const swift = SWIFT_TYPES[base] ?? 'JSONValue'
          return `    public var ${field}: ${swift}${optional ? '?' : ''}`
        })
        .join('\n')

      const initArgs = Object.entries(op.input as Record<string, string>)
        .map(([field, type]) => {
          const optional = type.endsWith('?')
          const base = optional ? type.slice(0, -1) : type
          const swift = SWIFT_TYPES[base] ?? 'JSONValue'
          return `${field}: ${swift}${optional ? '? = nil' : ''}`
        })
        .join(', ')

      const assigns = Object.keys(op.input as Record<string, string>)
        .map((f) => `        self.${f} = ${f}`)
        .join('\n')

      const name = `${swiftName(op.id).charAt(0).toUpperCase()}${swiftName(op.id).slice(1)}Request`
      const doc = op.summary ? `/// ${op.summary}\n` : ''
      return `${doc}public struct ${name}: Encodable, Sendable {
${fields}

    public init(${initArgs}) {
${assigns}
    }
}`
    })
    .join('\n\n')

  return `${BANNER.replace(/^\/\*\*/, '//')
    .replace(/\n \*\//, '')
    .replace(/\n \*/g, '\n//')
    .replace(/`/g, '`')}

import Foundation

/// Every operation the server offers, as one enum.
///
/// The raw value is the wire id, so a new server build can add operations
/// without this app changing — an id it has never heard of simply is not a
/// case here.
public enum Operation: String, CaseIterable, Sendable {
${cases}

    /// Where and how to reach this operation.
    public var route: Route {
        switch self {
${routes}
        }
    }
}

/// Method, path and the permission an operation needs.
public struct Route: Sendable {
    public let method: String
    public let path: String
    public let capability: String
    public let clients: [String]
}

/// The versioned prefix every route sits under.
public let apiPrefix = "${API_PREFIX}"

/// How often the server heartbeats an SSE stream, in seconds.
///
/// Generated from \`SERVER_PING_MS\` in \`src/lib/liveStream.ts\`. Do not restate
/// it here — the web client learned the hard way that a second copy of this
/// number drifts, and \`SSEClient\` derives its watchdog from these two values.
public let serverPingInterval: TimeInterval = ${SERVER_PING_MS / 1000}

/// Silence past this means the socket is dead even if the OS disagrees.
public let staleAfter: TimeInterval = ${STALE_AFTER_MS / 1000}

// MARK: - Request payloads

${requests}
`
}

// ---------------------------------------------------------------------------

type Output = { path: string; contents: string }

const outputs: Output[] = [
  { path: 'src/fns/index.ts', contents: buildFns() },
  { path: 'src/contract/generated/client.ts', contents: buildTsClient() },
  { path: 'src/contract/generated/openapi.json', contents: buildOpenApi() },
  {
    path: 'clients/apple/OpenRunKit/Sources/OpenRunKit/Generated.swift',
    contents: buildSwift(),
  },
]

for (const out of outputs) {
  const full = join(ROOT, out.path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, out.contents)
  console.log(`wrote ${out.path}`)
}

/**
 * Hand the emitted TypeScript and JSON to the repo's own formatter.
 *
 * Without this the generator and Biome disagree about line breaks, and every
 * `pnpm lint:fix` would make the committed files differ from what the
 * generator produces — which is exactly the drift this whole layer exists to
 * prevent. Biome is the authority on layout; the generator only decides
 * content. Swift is not Biome's to format, so it is left alone.
 */
const formattable = outputs
  .map((out) => out.path)
  .filter((path) => path.endsWith('.ts') || path.endsWith('.json'))

const formatted = spawnSync('pnpm', ['exec', 'biome', 'check', '--write', ...formattable], {
  cwd: ROOT,
  encoding: 'utf8',
})

if (formatted.status !== 0) {
  console.error(formatted.stdout ?? '')
  console.error(formatted.stderr ?? '')
  console.error(
    '\nFormatting the generated files failed. The files above are written but unformatted.',
  )
  process.exit(1)
}

console.log(`formatted ${formattable.length} files`)
