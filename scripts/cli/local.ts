import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openrunHome } from '../../src/server/paths.ts'

export type CliClient = { call(operation: string, input?: unknown): Promise<unknown> }

export function localCall(operation: string, input?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const endpoint = JSON.parse(
      readFileSync(join(openrunHome(), 'ipc', 'runtime.json'), 'utf8'),
    ) as { port: number; token: string }
    const socket = connect({ host: '127.0.0.1', port: endpoint.port })
    let settled = false
    const fail = (error: Error) => {
      settled = true
      socket.destroy()
      reject(error)
    }
    socket.setEncoding('utf8')
    socket.setTimeout(120_000, () =>
      fail(new Error('Local runtime timed out. Check openrun worker logs.')),
    )
    socket.on('error', fail)
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ operation, input, token: endpoint.token })}\n`),
    )
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end < 0) return
      try {
        const result = JSON.parse(buffer.slice(0, end))
        settled = true
        socket.destroy()
        if (result.ok) resolve(result.body)
        else reject(new Error(result.error || 'Local operation failed.'))
      } catch (error) {
        fail(error as Error)
      }
    })
    socket.on('close', () => {
      if (!settled)
        reject(
          new Error(
            'Local runtime disconnected. The operation may have completed; check its state before retrying.',
          ),
        )
    })
  })
}

export function unavailable(error: unknown): boolean {
  return ['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')
}

export async function localStatus(): Promise<unknown> {
  // A status read is safe to retry across shutdown. Never retry a mutation:
  // a dropped response does not tell us whether that operation committed.
  for (let attempt = 0; ; attempt++) {
    try {
      return await localCall('$status')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET' || attempt === 4) throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

export async function stopLocalRuntime(): Promise<unknown> {
  const result = await localCall('$stop')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    try {
      await localStatus()
    } catch (error) {
      if (unavailable(error)) return result
      throw error
    }
  }
  throw new Error(
    'Worker has not stopped yet. Check openrun worker status before starting the web app.',
  )
}

export async function ensureLocalRuntime(): Promise<CliClient> {
  try {
    const status = (await localStatus()) as { stopping: boolean }
    if (status.stopping) throw new Error('Open Run is stopping. Retry after it exits.')
    return { call: localCall }
  } catch (error) {
    if (!unavailable(error)) throw error
  }
  const home = openrunHome()
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const logPath = join(home, 'worker.log')
  const log = openSync(logPath, 'a', 0o600)
  let spawnError: Error | undefined
  try {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', fileURLToPath(new URL('../worker.ts', import.meta.url))],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: { ...process.env, OPENRUN_HOME: home },
        detached: true,
        stdio: ['ignore', log, log],
      },
    )
    child.on('error', (error) => {
      spawnError = error
    })
    child.unref()
  } finally {
    closeSync(log)
  }
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError
    await new Promise((resolve) => setTimeout(resolve, 100))
    try {
      await localStatus()
      return { call: localCall }
    } catch (error) {
      if (!unavailable(error)) throw error
    }
  }
  throw new Error(`Could not start the local worker. See ${logPath}.`)
}
