/**
 * Production entrypoint — binds the interface the security model assumes.
 *
 * Two jobs, and the first is why this file exists at all:
 *
 * 1. **Decide the bind address before the port opens.** The in-process guard
 *    (`src/start.ts`) can only refuse requests; it cannot un-publish a socket.
 *    If the listener came up on every interface while the guard believed it was
 *    on loopback, the check would be confidently wrong. So the address is
 *    resolved here, from the same rules the guard uses
 *    (`src/lib/serverAccess.ts`), and a configuration that would expose command
 *    execution to the network exits non-zero instead of listening.
 *
 * 2. **Serve the build.** `vite build` emits a fetch handler
 *    (`dist/server/server.js` exports `{ fetch }`), not a listening server —
 *    there is no Nitro preset configured. This bridges it onto `node:http`.
 *    Response bodies are piped as streams rather than buffered, because the
 *    live run log and the activity feed are SSE: buffering them would hang the
 *    UI on an open connection that never ends.
 *
 * `pnpm dev` needs none of this — Vite serves it and binds loopback already.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_HOST, insecureHostWarning, serverBindRefusal } from '../src/lib/serverAccess.ts'
import { openrunEnv } from '../src/lib/openrunEnv.ts'

// ---------------------------------------------------------------------------
// 1. Refuse an unsafe bind
// ---------------------------------------------------------------------------

function storedTokenExists(): boolean {
  const fromEnv = openrunEnv('HOME')
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.'
  const home = fromEnv || resolve(homeDir, '.openrun')
  const legacy = fromEnv || resolve(homeDir, '.agentops')
  return existsSync(resolve(home, 'access-token')) || existsSync(resolve(legacy, 'access-token'))
}

const host = openrunEnv('HOST') || DEFAULT_HOST
const allowInsecureRaw = openrunEnv('ALLOW_INSECURE_HOST').toLowerCase()
const config = {
  host,
  hasToken: Boolean(openrunEnv('ACCESS_TOKEN') || storedTokenExists()),
  allowInsecureHost:
    allowInsecureRaw === '1' || allowInsecureRaw === 'true' || allowInsecureRaw === 'yes',
}

const refusal = serverBindRefusal(config)
if (refusal) {
  console.error(`\n[security] ${refusal}\n`)
  process.exit(1)
}

const warning = insecureHostWarning(config)
if (warning) console.warn(`\n[security] ${warning}\n`)

const port = Number(process.env.PORT || 3000)

// Mirrored for any code inside the bundle that reads them.
process.env.HOST = host
process.env.PORT = String(port)

// ---------------------------------------------------------------------------
// 2. Load the build
// ---------------------------------------------------------------------------

// `dist/server/server.js` is what the current Vite build emits; `.output/` is
// the Nitro layout other presets use. Accept either so this survives a change
// of build target rather than silently pointing at nothing.
const candidates = [
  resolve(import.meta.dirname, '..', 'dist', 'server', 'server.js'),
  resolve(import.meta.dirname, '..', '.output', 'server', 'index.mjs'),
]

const entryPath = candidates.find((candidate) => existsSync(candidate))
if (!entryPath) {
  console.error('No production build found. Run `pnpm build` first.')
  console.error(`Looked in:\n  ${candidates.join('\n  ')}`)
  process.exit(1)
}

// Computed specifier: the build output does not exist at typecheck time.
const entry = (await import(pathToFileURL(entryPath).href)) as {
  default?: { fetch?: (request: Request) => Promise<Response> }
  fetch?: (request: Request) => Promise<Response>
}

const handler = entry.default?.fetch ?? entry.fetch
if (typeof handler !== 'function') {
  console.error(`${entryPath} does not export a fetch handler.`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 3. Bridge node:http ⇄ fetch
// ---------------------------------------------------------------------------

/** Methods that never carry a body, per the HTTP spec and undici's checks. */
const BODYLESS = new Set(['GET', 'HEAD'])

function toRequest(req: IncomingMessage, controller: AbortController): Request {
  const method = req.method || 'GET'
  // The authority only has to be syntactically valid; the app routes on path.
  const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const v of value) headers.append(key, v)
    else headers.set(key, value)
  }

  return new Request(url, {
    method,
    headers,
    body: BODYLESS.has(method) ? undefined : (Readable.toWeb(req) as ReadableStream),
    // Required by undici when a body is a stream.
    duplex: 'half',
    signal: controller.signal,
  } as RequestInit & { duplex: 'half' })
}

async function send(response: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string | Array<string>> = {}
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return
    headers[key] = value
  })

  // getSetCookie keeps multiple cookies separate; joining them corrupts them.
  const cookies = response.headers.getSetCookie?.() ?? []
  if (cookies.length) headers['set-cookie'] = cookies

  res.writeHead(response.status, headers)

  if (!response.body) {
    res.end()
    return
  }

  // Piped, not buffered — SSE responses never finish, and the UI's live log
  // depends on chunks arriving as the child process writes them.
  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  body.pipe(res)

  await new Promise<void>((done) => {
    res.on('close', done)
    body.on('error', () => {
      res.destroy()
      done()
    })
  })
}

const server = createServer((req, res) => {
  // Lets an aborted SSE connection unwind the stream inside the app, which
  // reads `request.signal` to stop publishing.
  const controller = new AbortController()
  res.on('close', () => controller.abort())

  void (async () => {
    try {
      const response = await handler(toRequest(req, controller))
      await send(response, res)
    } catch (err) {
      if (controller.signal.aborted) return
      console.error('[server] request failed:', err)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('Internal Server Error')
    }
  })()
})

server.listen(port, host, () => {
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host
  console.log(`Open Run listening on http://${shown}:${port}  (bound ${host})`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
