// Process IO shared by the app (`index.ts`) and CLI (`cliRelease.ts`) release
// commands. Nothing here decides anything; it runs git, gh and npm from the
// repository root and reports to GitHub Actions when it runs there.

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export class ReleaseError extends Error {}

export function run(
  command: string,
  args: string[],
  options: { allowFailure?: boolean; input?: string } = {},
): string {
  try {
    return execFileSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      input: options.input,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      // A release changelog can exceed execFileSync's default 1 MiB capture.
      maxBuffer: 32 * 1024 * 1024,
    }).trim()
  } catch (error) {
    if (options.allowFailure) return ''
    const detail = error instanceof Error ? error.message : String(error)
    throw new ReleaseError(`\`${command} ${args.join(' ')}\` failed:\n${detail}`)
  }
}

export const git = (...args: string[]) => run('git', args)
export const gitQuiet = (...args: string[]) => run('git', args, { allowFailure: true })

/** Streams a command's output rather than capturing it, for the verify gates. */
export function runLive(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' })
}

export function remoteTagTarget(tag: string): string | null {
  const peeled = gitQuiet('ls-remote', '--tags', 'origin', `refs/tags/${tag}^{}`)
  const direct = peeled || gitQuiet('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)
  return direct.split(/\s+/)[0] || null
}

/** Sets a GitHub Actions step output when running in CI; a no-op locally. */
export function setOutput(key: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return
  // A multi-line value needs a heredoc with a delimiter the value cannot contain.
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`
  appendFileSync(file, `${key}<<${delimiter}\n${value}\n${delimiter}\n`)
}

export function addSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (file) appendFileSync(file, `${markdown}\n`)
}
