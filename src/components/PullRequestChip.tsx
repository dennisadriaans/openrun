/**
 * One-line pull request strip, tucked above the composer.
 *
 * Answers "did this run ship anything, and is it still open?" without leaving
 * the run. It carries a live dot while the PR is open or draft and drops it the
 * moment the PR merges or closes, so a settled PR fades into plain chrome.
 *
 * When CI on that PR is red it also offers the way back into the loop: the same
 * repair turn the local checks panel offers, sourced from the pull request
 * instead of the worktree.
 */
import { ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, Wrench } from 'lucide-react'
import { buildCiRepairPrompt, ciRepairLabel, ciRepairRefusal } from '../lib/ciRepair'
import {
  isPullRequestLive,
  pullRequestStateLabel,
  type PullRequestState,
  type RunPullRequest,
} from '../lib/pullRequest'
import { useSendMessage } from '../lib/queries'
import { Button } from './ui'

const STATE_TONE: Record<PullRequestState, { icon: typeof GitPullRequest; tone: string }> = {
  open: { icon: GitPullRequest, tone: 'text-emerald-400' },
  draft: { icon: GitPullRequest, tone: 'text-tier-quaternary' },
  merged: { icon: GitMerge, tone: 'text-violet-400' },
  closed: { icon: GitPullRequestClosed, tone: 'text-rose-400' },
}

export function PullRequestChip({
  pr,
  runId,
  busy = false,
  variant = 'composer',
  stackTop = true,
}: {
  pr: RunPullRequest
  /** Enables the "Fix CI" action; omit for a read-only chip. */
  runId?: string
  /** True while the agent is mid-turn — a repair turn is not offered then. */
  busy?: boolean
  /** `composer` docks the strip onto the composer; `panel` stands alone. */
  variant?: 'composer' | 'panel'
  /** Rounded top when this strip is the top of a composer stack. */
  stackTop?: boolean
}) {
  const { icon: Icon, tone } = STATE_TONE[pr.state]
  const live = isPullRequestLive(pr.state)
  const stripClass =
    variant === 'composer'
      ? `chat-composer-strip${stackTop ? ' chat-composer-strip-top' : ' chat-composer-strip-continued'}`
      : 'rounded-xl border border-border bg-elevated'

  return (
    // A row, not a single anchor: the repair button cannot be nested inside a
    // link, so the link covers the title and the button sits beside it.
    <div className={`group flex items-center gap-2 px-2 py-1.5 ${stripClass}`}>
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        title={`${pullRequestStateLabel(pr.state)} · ${pr.title || pr.url}`}
        className="inline-flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-[12.5px] transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <span className={`relative flex size-4 shrink-0 items-center justify-center ${tone}`}>
          <Icon className="size-4" />
          {live ? (
            <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-emerald-400" />
          ) : null}
        </span>
        <span className="shrink-0 mono text-[12px] tabular-nums text-tier-secondary">
          #{pr.number}
        </span>
        <span className="min-w-0 truncate text-tier-secondary">{pr.title || 'Pull request'}</span>
        <ExternalLink className="size-3.5 shrink-0 text-tier-quaternary opacity-0 transition-opacity group-hover:opacity-100" />
      </a>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {pr.checks === 'failing' ? (
          <span className="text-[11.5px] text-rose-400">checks failing</span>
        ) : null}
        {!live ? (
          <span className="text-[11.5px] text-tier-quaternary">
            {pullRequestStateLabel(pr.state)}
          </span>
        ) : null}
        {runId ? <FixCiButton pr={pr} runId={runId} busy={busy} /> : null}
      </span>
    </div>
  )
}

/**
 * The other half of the repair loop.
 *
 * Local checks already feed their failures back to the agent; this does the
 * same for the pull request's own CI, which until now was only ever painted red
 * and left there.
 */
function FixCiButton({ pr, runId, busy }: { pr: RunPullRequest; runId: string; busy: boolean }) {
  const sendMessage = useSendMessage(runId)
  const refusal = ciRepairRefusal({
    state: pr.state,
    checks: pr.checks,
    failingChecks: pr.failingChecks,
    busy: busy || sendMessage.isPending,
  })
  // Nothing red: no button at all, rather than a permanently disabled one.
  if (pr.checks !== 'failing' || pr.failingChecks.length === 0) return null

  return (
    <Button
      variant="primary"
      disabled={refusal !== null}
      title={refusal ?? `Ask the agent to fix CI on #${pr.number}`}
      onClick={() =>
        sendMessage.mutate({
          prompt: buildCiRepairPrompt({
            prNumber: pr.number,
            prUrl: pr.url,
            failingChecks: pr.failingChecks,
          }),
        })
      }
    >
      <Wrench className="size-3.5" />
      {ciRepairLabel(pr.failingChecks)}
    </Button>
  )
}
