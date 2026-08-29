/**
 * Kill a CLI process (and its process group when we spawned with detached:true).
 *
 * Agent CLIs fan out tool shells as grandchildren. Killing only the direct
 * child leaves those shells burning tokens against the worktree. Checks already
 * use this pattern; agent spawns must match.
 *
 * Never call `process.kill(-pid)` when the child is still in the parent's
 * process group — that would signal the whole Vite/server group. We only try
 * the group signal when `detached` made the child its own session leader
 * (pid === pgid). For the fallback path (orphan recovery by stored pid) we
 * try the group first; if the pid is not a group leader, the kernel returns
 * ESRCH and we fall through to the single-pid kill.
 */
import { spawnSync, type ChildProcess } from 'node:child_process'
import { RUN_KILL_GRACE_MS } from '../lib/runBudget.ts'

const g = globalThis as unknown as {
  __agentopsShuttingDown?: boolean
  __agentopsCancellingWorkspaces?: Set<string>
}

function cancellingWorkspaces(): Set<string> {
  if (!g.__agentopsCancellingWorkspaces) g.__agentopsCancellingWorkspaces = new Set()
  return g.__agentopsCancellingWorkspaces
}

/** Reserve a workspace while a cancelled child is still able to write. */
export function reserveWorkspaceCancellation(workspaceId: string): void {
  if (workspaceId.trim()) cancellingWorkspaces().add(workspaceId)
}

/** Release the cancellation reservation after the child is known to be gone. */
export function releaseWorkspaceCancellation(workspaceId: string): void {
  if (workspaceId.trim()) cancellingWorkspaces().delete(workspaceId)
}

/** True while a cancellation is still waiting for its child process to exit. */
export function isWorkspaceCancellationPending(workspaceId: string): boolean {
  return cancellingWorkspaces().has(workspaceId)
}

/** True while the process is tearing down — no new agent spawns. */
export function isShuttingDown(): boolean {
  return Boolean(g.__agentopsShuttingDown)
}

export function setShuttingDown(value: boolean): void {
  g.__agentopsShuttingDown = value
}

export function isPidAlive(pid: number | null | undefined): boolean {
  if (pid == null || !Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Send a signal to a process, preferring its process group when it is the leader. */
export function signalPid(pid: number, signal: NodeJS.Signals): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  if (process.platform === 'win32') {
    const res = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    return res.status === 0 || !isPidAlive(pid)
  }
  let sent = false
  try {
    process.kill(-pid, signal)
    sent = true
  } catch {
    // Not a group leader, or already gone — try the single pid.
  }
  try {
    process.kill(pid, signal)
    sent = true
  } catch {
    // Already gone.
  }
  return sent
}

/** SIGTERM a child (or its group), then SIGKILL after the grace period. */
export function killChildTree(
  child: ChildProcess,
  opts?: { graceMs?: number; stillLive?: () => boolean },
): void {
  const pid = child.pid
  if (pid == null) {
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone.
    }
    return
  }

  signalPid(pid, 'SIGTERM')
  const graceMs = opts?.graceMs ?? RUN_KILL_GRACE_MS
  setTimeout(() => {
    if (opts?.stillLive && !opts.stillLive()) return
    if (!isPidAlive(pid)) return
    signalPid(pid, 'SIGKILL')
  }, graceMs)
}

/** Same as killChildTree but for a bare pid recovered from the DB after restart. */
export function killPidTree(pid: number, opts?: { graceMs?: number }): boolean {
  if (!isPidAlive(pid)) return false
  signalPid(pid, 'SIGTERM')
  const graceMs = opts?.graceMs ?? RUN_KILL_GRACE_MS
  setTimeout(() => {
    if (!isPidAlive(pid)) return
    signalPid(pid, 'SIGKILL')
  }, graceMs)
  return true
}

/**
 * Env for a spawned agent. A plain `{ ...process.env, ...extra }` on Windows
 * drops `PATH`: `process.env` is case-insensitive, but the spread object only
 * keeps the enumerable `Path` key, and the child then has no PATH.
 */
export function spawnEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  if (!extraEnv || Object.keys(extraEnv).length === 0) return process.env
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv }
  if (process.platform === 'win32') {
    const pathVal = extraEnv.PATH ?? extraEnv.Path ?? process.env.PATH ?? process.env.Path
    if (pathVal !== undefined) {
      env.PATH = pathVal
      env.Path = pathVal
    }
  }
  return env
}

/** Spawn options so agent grandchildren can be torn down with the parent. */
export function agentSpawnOptions(
  cwd: string,
  extraEnv?: Record<string, string>,
): {
  cwd: string
  env: NodeJS.ProcessEnv
  stdio: ['pipe', 'pipe', 'pipe']
  detached: boolean
} {
  return {
    cwd,
    env: spawnEnv(extraEnv),
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  }
}
