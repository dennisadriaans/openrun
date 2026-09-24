// Process IO shared by the app (`index.ts`) and CLI (`cliRelease.ts`) release
// commands. Nothing here decides anything; it runs git, gh and npm from the
// repository root and reports to GitHub Actions when it runs there.

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isReleaseCommitSubject } from './conventional.ts'

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

/** `--name=value` from argv, or undefined. */
export function flag(argv: string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
}

/** `https://github.com/owner/repo`, from the root manifest. */
export function repoUrl(): string | undefined {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    repository?: { url?: string }
  }
  return manifest.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '')
}

export type RangeCommit = { sha: string; subject: string; body: string }

/** Commits in `from..HEAD` (all of HEAD when `from` is null), optionally limited to paths. */
export function commitsSince(from: string | null, paths: readonly string[] = []): RangeCommit[] {
  const range = from ? `${from}..HEAD` : 'HEAD'
  // Record and unit separators keep multi-line bodies unambiguous.
  const pathArgs = paths.length ? ['--', ...paths] : []
  const raw = gitQuiet('log', range, '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', ...pathArgs)
  if (!raw) return []
  return raw
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [sha = '', subject = '', body = ''] = record.split('\x1f')
      return { sha: sha.trim(), subject: subject.trim(), body }
    })
}

/**
 * A `chore(release): <tag>` commit in HEAD's history whose tag does not exist:
 * the release PR merged, but nobody tagged it. The release tool resumes from
 * here instead of planning the next version on top of an unpublished one.
 */
export function untaggedRelease(tag: string): { tag: string; sha: string } | null {
  if (gitQuiet('tag', '--list', tag) === tag) return null
  const sha = gitQuiet('log', '--format=%H%x1f%s')
    .split('\n')
    .map((line) => line.split('\x1f'))
    .find(([, subject = '']) => isReleaseCommitSubject(subject, tag))?.[0]
  return sha ? { tag, sha } : null
}

/**
 * Publishing is only ever done from the tagged commit: the bytes behind a
 * release must be rebuildable from a ref nobody moves.
 */
export function requireTaggedHead(tag: string): void {
  const tagged = gitQuiet('rev-parse', `${tag}^{commit}`)
  const head = git('rev-parse', 'HEAD')
  if (!tagged) throw new ReleaseError(`${tag} does not exist. Tag the merged release commit first.`)
  if (tagged !== head) {
    throw new ReleaseError(`${tag} is ${tagged.slice(0, 9)}, but HEAD is ${head.slice(0, 9)}.`)
  }
}

export function githubReleaseExists(tag: string): boolean {
  return Boolean(run('gh', ['release', 'view', tag, '--json', 'tagName'], { allowFailure: true }))
}

/** `gh release create` for an existing tag, with the notes passed through a file. */
export function createGithubRelease(tag: string, title: string, notes: string, extra: string[]) {
  const notesFile = join(ROOT, '.release-notes.md')
  writeFileSync(notesFile, notes)
  try {
    run('gh', [
      'release',
      'create',
      tag,
      '--verify-tag',
      '--title',
      title,
      '--notes-file',
      notesFile,
      ...extra,
    ])
  } finally {
    rmSync(notesFile, { force: true })
  }
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
