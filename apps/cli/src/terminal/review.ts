import { homedir } from 'node:os'
import { stripVTControlCharacters } from 'node:util'
import { parseUnifiedDiff } from '@openrun/domain/workspaces/diff'
import {
  commitBlockedReason,
  discardBlockedReason,
  pushBlockedReason,
  shipBlockedReason,
} from '@openrun/domain/workspaces/gitActionGate'
import { runStatusLabel } from '../session/session.ts'
import { changeSummary } from './layout.ts'
import { scheduleTime } from './schedule.ts'

/** `runs.getWorkspace` as it arrives over IPC or HTTP. */
export type ReviewFile = {
  path: string
  oldPath: string | null
  status: string
  additions: number
  deletions: number
  binary: boolean
}
export type RunWorkspaceView = {
  files: ReviewFile[]
  repo: { isRepo: boolean; branch: string; head: string; remote: string; ahead: number }
  totals: { additions: number; deletions: number }
  gh: { installed: boolean; authenticated: boolean }
  baseBranch?: string
}
export type ReviewRun = {
  id: string
  taskName?: string
  status?: string
  cwd?: string
  model?: string
  effort?: string
  startedAt?: number
}
export type ReviewPullRequest = { number: number; url: string; state: string }

export type ReviewAction = 'back' | 'refresh' | 'commit' | 'push' | 'ship' | 'discard'
export type ReviewWrite = Exclude<ReviewAction, 'back' | 'refresh'>
export type ReviewNotice = { text: string; tone: 'ok' | 'error' | 'info' }

export type ReviewView = {
  runId: string
  title: string
  status: string
  /** "claude-sonnet-5 · low effort · started 10:24", what the run was asked to use. */
  details: string
  directory: string
  branch: string
  summary: string
  files: ReviewFile[]
  pullRequest?: ReviewPullRequest
  notice?: ReviewNotice
  /** Why each write is unavailable, from the same gates the web panel uses. */
  blocked: Record<ReviewWrite, string | null>
}

export function notRepositoryMessage(): string {
  return 'This run’s directory is not a git repository, so changes can’t be tracked.'
}

/** Paths under the home directory read as ~/…, the way users type them. */
export function displayPath(path: string, home = homedir()): string {
  if (!path) return '—'
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`
  return path
}

/** Keep a path's file name visible when it is too long: `…/terminal/review.ts`. */
export function fitPath(path: string, width: number): string {
  const limit = Math.max(1, Math.floor(width))
  const chars = Array.from(path)
  if (chars.length <= limit) return path
  return `…${chars.slice(chars.length - limit + 1).join('')}`
}

/** A new file reads as added whether or not git tracks it yet. */
export function statusMark(status: string): string {
  return { added: 'A', untracked: 'A', modified: 'M', deleted: 'D', renamed: 'R' }[status] ?? '?'
}

export function reviewView(input: {
  run: ReviewRun
  workspace: RunWorkspaceView | null
  pullRequest?: ReviewPullRequest | null
  notice?: ReviewNotice
}): ReviewView {
  const { run, workspace } = input
  const files = workspace?.files ?? []
  const base = {
    runId: run.id,
    title: run.taskName?.trim() || run.id,
    status: run.status ? runStatusLabel(run.status) : 'Unknown',
    details: [
      run.model || 'default model',
      `${run.effort || 'default'} effort`,
      ...(run.startedAt ? [`started ${scheduleTime(run.startedAt)}`] : []),
    ].join(' · '),
    directory: displayPath(run.cwd ?? ''),
    files,
    ...(input.pullRequest ? { pullRequest: input.pullRequest } : {}),
    ...(input.notice ? { notice: input.notice } : {}),
  }
  if (!workspace?.repo.isRepo) {
    const reason = workspace ? notRepositoryMessage() : 'Run not found.'
    return {
      ...base,
      branch: '—',
      summary: reason,
      blocked: { commit: reason, push: reason, ship: reason, discard: reason },
    }
  }
  const { repo } = workspace
  const hasChanges = files.length > 0
  const ahead = repo.ahead || 0
  const branch = [
    `${repo.branch || 'detached'}${repo.head ? ` @ ${repo.head}` : ''}`,
    ...(workspace.baseBranch && workspace.baseBranch !== repo.branch
      ? [`started on ${workspace.baseBranch}`]
      : []),
    ...(ahead ? [`${ahead} unpushed commit${ahead === 1 ? '' : 's'}`] : []),
  ].join(' · ')
  return {
    ...base,
    branch,
    summary: changeSummary({ files: files.length, ...workspace.totals }),
    blocked: {
      commit: commitBlockedReason({ hasChanges }),
      discard: discardBlockedReason({ hasChanges }),
      push: pushBlockedReason({ hasRemote: Boolean(repo.remote) }),
      ship: shipBlockedReason({
        hasRemote: Boolean(repo.remote),
        ghInstalled: workspace.gh.installed,
        ghAuthenticated: workspace.gh.authenticated,
        hasChanges,
        ahead,
      }),
    },
  }
}

export type DiffRow = {
  kind: 'hunk' | 'add' | 'delete' | 'context' | 'note'
  /** Right-aligned line number, blank for hunk headers and notes. */
  number: string
  text: string
}

/** Agent-written content is data: no terminal escapes, tabs at a fixed width. */
function cleanLine(text: string): string {
  return Array.from(stripVTControlCharacters(text).replace(/\t/g, '  '))
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
}

/** Rows for a terminal diff: one per line, capped so a huge file cannot stall the renderer. */
export function diffRows(raw: string, maxLines = 2000): DiffRow[] {
  const parsed = parseUnifiedDiff(raw)
  if (parsed.binary) return [{ kind: 'note', number: '', text: 'Binary file — no text preview.' }]
  if (!parsed.hunks.length) return [{ kind: 'note', number: '', text: 'No text changes.' }]
  const widest = Math.max(
    ...parsed.hunks.flatMap((hunk) =>
      hunk.lines.map((line) => line.newNumber ?? line.oldNumber ?? 0),
    ),
  )
  const width = String(widest).length
  const rows: DiffRow[] = []
  let total = 0
  for (const hunk of parsed.hunks) {
    rows.push({
      kind: 'hunk',
      number: '',
      text: cleanLine(`@@ −${hunk.oldStart} +${hunk.newStart} @@ ${hunk.header}`.trimEnd()),
    })
    for (const line of hunk.lines) {
      if (total++ >= maxLines) {
        const remaining = parsed.hunks.reduce((n, next) => n + next.lines.length, 0) - maxLines
        rows.push({ kind: 'note', number: '', text: `… ${remaining} more lines not shown.` })
        return rows
      }
      rows.push({
        kind: line.type,
        number: String(line.newNumber ?? line.oldNumber ?? '').padStart(width),
        text: cleanLine(line.content),
      })
    }
  }
  return rows
}
