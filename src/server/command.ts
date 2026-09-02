/**
 * Running a child process without blocking the server.
 *
 * `spawnSync` in a request handler stops the whole event loop for as long as
 * the child runs. For a `git clone` or a `pnpm install` that is minutes, during
 * which no other request is answered and — worse — the SSE heartbeats stop, so
 * every connected browser decides its live stream is dead. And with no timeout,
 * a command that waits on stdin froze Open Run until somebody killed it.
 *
 * This is the async equivalent, with a budget. The child gets its own process
 * group so a timeout takes down the whole tree — a `pnpm install` that spawns
 * a package manager that spawns a compiler leaves grandchildren behind
 * otherwise. Same shape as the check runner in `checks.ts`, which had this
 * right all along.
 */
import { spawn } from 'node:child_process'
import { killChildTree } from './processControl.ts'

/** Output kept per stream. Past this the command is stopped, not truncated. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024

export type CommandResult = {
  /** Exit code, or null when the child was signalled. */
  status: number | null
  stdout: string
  stderr: string
  /** True when the budget elapsed and we killed it. */
  timedOut: boolean
  /** True when the child was stopped for exceeding the output ceiling. */
  outputTooLarge: boolean
}

export type RunCommandInput = {
  /** Binary, or the whole command line when `shell` is set. */
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  /** Run through the platform shell. Only for user-authored command strings. */
  shell?: boolean
}

/**
 * Run a command to completion, or kill it when its budget elapses.
 *
 * Never rejects: a spawn failure comes back as a non-zero status with the error
 * on stderr, so every caller has one shape to handle.
 */
export function runCommand(input: RunCommandInput): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let outputTooLarge = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (status: number | null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ status, stdout, stderr, timedOut, outputTooLarge })
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(input.command, input.args ?? [], {
        cwd: input.cwd,
        env: input.env ?? process.env,
        shell: input.shell ?? false,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Own process group so a timeout can take down grandchildren too.
        detached: process.platform !== 'win32',
      })
    } catch (err) {
      resolve({
        status: -1,
        stdout: '',
        stderr: String(err),
        timedOut: false,
        outputTooLarge: false,
      })
      return
    }

    const stop = () => killChildTree(child, { stillLive: () => !settled })

    timer = setTimeout(() => {
      timedOut = true
      stop()
    }, input.timeoutMs)

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > MAX_OUTPUT_BYTES) {
        outputTooLarge = true
        stop()
      }
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > MAX_OUTPUT_BYTES) {
        outputTooLarge = true
        stop()
      }
    })

    child.on('error', (err) => {
      stderr += String(err)
      finish(-1)
    })
    child.on('close', (code) => finish(code))
  })
}
