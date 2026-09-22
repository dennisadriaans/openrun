/** One executor/scheduler owner per database, reachable over owner-only IPC. */
import { chmodSync, mkdirSync, unlinkSync, writeFileSync, renameSync } from 'node:fs'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { getDb } from './db.ts'
import { openrunHome } from './paths.ts'
import { dispatch } from './contract/dispatch.ts'
import { isShuttingDown } from './processControl.ts'

const KEY = 'local_runtime_owner'
const g = globalThis as unknown as { __openrunLocalRuntime?: boolean }

export function bootLocalRuntime(): void {
  if (g.__openrunLocalRuntime) return
  const db = getDb()
  // SQLite serializes competing launches, including stale-owner recovery.
  db.transaction(() => {
    const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(KEY) as
      | { value: string }
      | undefined
    const owner = row ? Number(row.value) : 0
    if (owner && owner !== process.pid) {
      let alive = true
      try {
        process.kill(owner, 0)
      } catch (error) {
        alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'
      }
      if (alive)
        throw new Error(
          `Open Run already owns this database (PID ${owner}). Use the CLI to connect. To switch from the worker to the web app, run "openrun worker stop" first.`,
        )
    }
    db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(
      KEY,
      String(process.pid),
    )
  }).immediate()
  g.__openrunLocalRuntime = true

  const dir = join(openrunHome(), 'ipc')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const endpointPath = join(dir, 'runtime.json')
  const token = randomBytes(32).toString('hex')
  // Only the elected owner may replace the previous owner's endpoint.
  try {
    unlinkSync(endpointPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const server = createServer((socket) => {
    socket.setEncoding('utf8')
    socket.setTimeout(120_000, () => socket.destroy())
    socket.on('error', () => socket.destroy())
    let buffer = ''
    let handled = false
    socket.on('data', (chunk) => {
      if (handled) return
      buffer += chunk
      if (Buffer.byteLength(buffer) > 1024 * 1024) {
        socket.destroy()
        return
      }
      const end = buffer.indexOf('\n')
      if (end < 0) return
      handled = true
      void (async () => {
        try {
          const { operation, input, token: supplied } = JSON.parse(buffer.slice(0, end))
          if (
            typeof supplied !== 'string' ||
            Buffer.byteLength(supplied) !== token.length ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
          )
            throw new Error('Unauthorized local client.')
          if (typeof operation !== 'string') throw new Error('Expected an operation.')
          let result: unknown
          if (operation === '$status') {
            result = {
              ok: true,
              body: {
                pid: process.pid,
                kind: process.env.OPENRUN_PROCESS_KIND === 'worker' ? 'worker' : 'web',
                home: openrunHome(),
                stopping: isShuttingDown(),
              },
            }
          } else if (operation === '$stop') {
            if (process.env.OPENRUN_PROCESS_KIND !== 'worker')
              throw new Error('The web app owns this runtime. Stop the web app from its terminal.')
            result = { ok: true, body: { stopping: true } }
            socket.once('finish', () => process.kill(process.pid, 'SIGTERM'))
          } else {
            if (isShuttingDown()) throw new Error('Open Run is stopping. Retry after it exits.')
            result = await dispatch(operation, input, 'desktop')
          }
          socket.end(`${JSON.stringify(result)}\n`)
        } catch (error) {
          socket.end(
            `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Request failed' })}\n`,
          )
        }
      })()
    })
  })
  server.on('error', (error) => {
    console.error('[local runtime]', error.message)
    process.exit(1)
  })
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing local runtime address.')
    const temporary = `${endpointPath}.${process.pid}`
    writeFileSync(temporary, JSON.stringify({ port: address.port, token }), { mode: 0o600 })
    renameSync(temporary, endpointPath)
  })
  // Web mode already has its own listener; don't keep tests/dev shutdown alive.
  if (process.env.OPENRUN_PROCESS_KIND !== 'worker') server.unref()
  process.once('exit', () => {
    try {
      unlinkSync(endpointPath)
      db.prepare('DELETE FROM app_meta WHERE key = ? AND value = ?').run(KEY, String(process.pid))
    } catch {
      /* Crash recovery uses the persisted owner PID. */
    }
  })
}
