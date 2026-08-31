/**
 * One-line pull request strip, tucked above the composer.
 *
 * Answers "did this run ship anything, and is it still open?" without leaving
 * the run. It carries a live dot while the PR is open or draft and drops it the
 * moment the PR merges or closes, so a settled PR fades into plain chrome.
 */
import { ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react'
import {
  isPullRequestLive,
  pullRequestStateLabel,
  type PullRequestState,
  type RunPullRequest,
} from '../lib/pullRequest'

const STATE_TONE: Record<PullRequestState, { icon: typeof GitPullRequest; tone: string }> = {
  open: { icon: GitPullRequest, tone: 'text-emerald-400' },
  draft: { icon: GitPullRequest, tone: 'text-tier-quaternary' },
  merged: { icon: GitMerge, tone: 'text-violet-400' },
  closed: { icon: GitPullRequestClosed, tone: 'text-rose-400' },
}

export function PullRequestChip({
  pr,
  variant = 'composer',
}: {
  pr: RunPullRequest
  /** `composer` docks the strip onto the composer; `panel` stands alone. */
  variant?: 'composer' | 'panel'
}) {
  const { icon: Icon, tone } = STATE_TONE[pr.state]
  const live = isPullRequestLive(pr.state)

  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      title={`${pullRequestStateLabel(pr.state)} · ${pr.title || pr.url}`}
      className={`group flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] transition-colors hover:bg-secondary/50 ${
        variant === 'composer'
          ? 'chat-files-glass rounded-t-[16px] border border-b-0 border-border'
          : 'rounded-xl border border-border bg-elevated'
      }`}
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
      <span className="min-w-0 flex-1 truncate text-tier-secondary">
        {pr.title || 'Pull request'}
      </span>
      {pr.checks === 'failing' ? (
        <span className="shrink-0 text-[11.5px] text-rose-400">checks failing</span>
      ) : null}
      {!live ? (
        <span className="shrink-0 text-[11.5px] text-tier-quaternary">
          {pullRequestStateLabel(pr.state)}
        </span>
      ) : null}
      <ExternalLink className="size-3.5 shrink-0 text-tier-quaternary opacity-0 transition-opacity group-hover:opacity-100" />
    </a>
  )
}
