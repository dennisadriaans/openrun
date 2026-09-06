import { randomUUID } from 'node:crypto'
import { spawn, type IPty } from 'zigpty'
import { resolveWorkspacePath } from './workspaces.ts'

const MAX_BUFFER_CHARS = 64_000
const ORPHAN_GRACE_MS = 30_000

type TerminalEvent =
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number; signal: number }

type Session = {
  id: string
  workspaceId: string
  pty: IPty
  buffer: string
  listeners: Set<(event: TerminalEvent) => void>
  orphanTimer: ReturnType<typeof setTimeout> | null
  closed: boolean
}

const sessions = new Map<string, Session>()

function boundedDimension(value: unknown, fallback: number, max: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(1, Math.floor(number))) : fallback
}

function scheduleOrphanClose(session: Session): void {
  if (session.closed || session.listeners.size > 0) return
  if (session.orphanTimer) clearTimeout(session.orphanTimer)
  session.orphanTimer = setTimeout(() => closeTerminalSession(session.id), ORPHAN_GRACE_MS)
  session.orphanTimer.unref?.()
}

function requiredSession(id: string): Session {
  const session = sessions.get(id)
  if (!session || session.closed) throw new Error('Terminal session not found')
  return session
}

export function createTerminalSession(input: {
  workspaceId: string
  cols?: number
  rows?: number
}): { id: string } {
  const workspaceId = input.workspaceId.trim()
  if (!workspaceId) throw new Error('A workspace is required')

  const id = randomUUID()
  const cwd = resolveWorkspacePath(workspaceId)
  const pty = spawn(undefined, [], {
    cwd,
    cols: boundedDimension(input.cols, 80, 500),
    rows: boundedDimension(input.rows, 24, 200),
    name: 'xterm-256color',
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    shell: true,
  })
  const session: Session = {
    id,
    workspaceId,
    pty,
    buffer: '',
    listeners: new Set(),
    orphanTimer: null,
    closed: false,
  }
  sessions.set(id, session)

  pty.onData((chunk) => {
    const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    session.buffer = `${session.buffer}${data}`.slice(-MAX_BUFFER_CHARS)
    for (const listener of session.listeners) listener({ type: 'data', data })
  })
  pty.onExit(({ exitCode, signal }) => {
    session.closed = true
    for (const listener of session.listeners) listener({ type: 'exit', exitCode, signal })
    session.listeners.clear()
    sessions.delete(id)
  })
  scheduleOrphanClose(session)
  return { id }
}

export function writeTerminalSession(id: string, data: string): void {
  if (data.length > 64_000) throw new Error('Terminal input is too large')
  requiredSession(id).pty.write(data)
}

export function resizeTerminalSession(id: string, cols: unknown, rows: unknown): void {
  requiredSession(id).pty.resize(boundedDimension(cols, 80, 500), boundedDimension(rows, 24, 200))
}

export function closeTerminalSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  session.closed = true
  if (session.orphanTimer) clearTimeout(session.orphanTimer)
  session.listeners.clear()
  sessions.delete(id)
  session.pty.close()
}

export function subscribeTerminalSession(
  id: string,
  listener: (event: TerminalEvent) => void,
): { buffer: string; unsubscribe: () => void } {
  const session = requiredSession(id)
  if (session.orphanTimer) clearTimeout(session.orphanTimer)
  session.orphanTimer = null
  session.listeners.add(listener)
  return {
    buffer: session.buffer,
    unsubscribe: () => {
      session.listeners.delete(listener)
      scheduleOrphanClose(session)
    },
  }
}
