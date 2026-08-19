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
import type { ChildProcess } from 'node:child_process'
import { RUN_KILL_GRACE_MS } from '../lib/runBudget.ts'

const g = globalThis as unknown as {
  __agentopsShuttingDown?: boolean
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
  let sent = false
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal)
      sent = true
    } catch {
      // Not a group leader, or already gone — try the single pid.
    }
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
    env:
      extraEnv && Object.keys(extraEnv).length > 0 ? { ...process.env, ...extraEnv } : process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  }
}
