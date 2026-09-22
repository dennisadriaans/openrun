/**
 * Hold the machine awake for the length of an agent turn.
 *
 * A scheduled run fires during macOS's ~45-second dark wake and the laptop is
 * back in deep sleep long before the CLI has answered — but the wall-clock
 * budget keeps counting through the sleep, so a 30-minute budget buys a couple
 * of minutes of real work and then SIGTERMs a perfectly healthy agent.
 *
 * The assertion is scoped to the agent's own pid on macOS and bounded by the
 * turn's budget on Linux, so a crashed server cannot leave a machine pinned
 * awake.
 */
import { spawn } from 'node:child_process'

export type WakeLock = { release: () => void }

const RELEASED: WakeLock = { release: () => {} }

/** Extra slack past the budget before a Linux inhibitor gives up on its own. */
const INHIBIT_SLACK_MS = 60_000

/** The command that holds the assertion, or null on a platform without one. */
export function wakeInhibitorArgv(
  platform: NodeJS.Platform,
  pid: number,
  maxMs: number,
): [string, string[]] | null {
  // -i holds on battery too; -s is the AC-power system-sleep assertion. The
  // display is left alone, so the laptop still dims and locks.
  if (platform === 'darwin') return ['caffeinate', ['-i', '-s', '-w', String(pid)]]
  if (platform === 'linux') {
    const seconds = Math.ceil((maxMs + INHIBIT_SLACK_MS) / 1000)
    return [
      'systemd-inhibit',
      [
        '--what=sleep:idle',
        '--who=Open Run',
        '--why=Agent run in progress',
        '--mode=block',
        'sleep',
        String(seconds),
      ],
    ]
  }
  return null
}

export function holdWakeLock(pid: number | null | undefined, maxMs: number): WakeLock {
  if (pid == null || !Number.isFinite(pid) || pid <= 0) return RELEASED
  const argv = wakeInhibitorArgv(process.platform, pid, maxMs)
  if (!argv) return RELEASED
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(argv[0], argv[1], { stdio: 'ignore' })
  } catch {
    return RELEASED
  }
  // A machine without the binary simply sleeps; never fail the run over it.
  child.on('error', () => {})
  child.unref()
  let released = false
  return {
    release: () => {
      if (released) return
      released = true
      try {
        child.kill('SIGTERM')
      } catch {
        // Already gone.
      }
    },
  }
}
