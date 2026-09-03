/**
 * Workspace sidebar: repo state and the git write actions for a run.
 *
 * Commit / push / open-PR / discard all operate on the run's cwd. Destructive
 * and outward-facing actions (discard, push, PR) confirm before running.
 *
 * "Create pull request" is one click: the run's own runtime and model group the
 * uncommitted work into conventional commits, the branch is pushed, and the PR
 * is opened — see `lib/shipPlan.ts` and `core.shipRun`. The old title/body
 * dialog is still reachable as "Write the pull request myself" for anyone who
 * would rather not spend a turn on it.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react'
import {
  AlertTriangle,
  Check,
  GitBranch,
  GitCommit,
  GitCompare,
  GitPullRequest,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react'
import type { RepoInfo } from '../server/git'
import {
  canCommit,
  canCreatePullRequest,
  canDiscard,
  canPush,
  canShip,
  commitBlockedReason,
  discardBlockedReason,
  prBlockedReason,
  pushBlockedReason,
  shipBlockedReason,
  shipGateFrom,
} from '../lib/gitActionGate'
import {
  useCommit,
  useCreateBranch,
  useDiscard,
  useOpenPullRequest,
  usePush,
  useShipRun,
} from '../lib/queries'
import { Button, Field, Modal, inputClass } from './ui'
import { DiffStat } from './FilesChanged'
import { WorkspaceToolbarChip } from './workspace/PanelLayoutControls'

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1 text-[12.5px] text-tier-secondary">
      <span className="shrink-0 text-tier-quaternary">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  )
}

/** Inline result/error strip shown under the action buttons. */
function Result({ error, success }: { error?: string | null; success?: string | null }) {
  if (error) {
    return (
      <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-500/25 bg-rose-950/25 px-2.5 py-2 text-[11.5px] leading-relaxed text-rose-300">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 break-words">{error}</span>
      </div>
    )
  }
  if (success) {
    return (
      <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-950/20 px-2.5 py-2 text-[11.5px] leading-relaxed text-emerald-300">
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 break-words">{success}</span>
      </div>
    )
  }
  return null
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err ?? 'Something went wrong')
}

/** Hover copy for the one-click ship control, on both surfaces. */
const SHIP_HINT =
  'Commit the changes as conventional commits, push the branch, and open the pull request'

type ShipResult = {
  commits: { message: string; sha: string; paths: string[] }[]
  branch: string
  prTitle: string
  planFallbackReason?: string
}

/** What the ship strip says once the PR exists. */
function shipSuccessText(r: ShipResult): string {
  const n = r.commits.length
  const head =
    n > 0 ? `${n} commit${n === 1 ? '' : 's'} pushed to ${r.branch}` : `Pushed ${r.branch}`
  const tail = r.planFallbackReason ? ` — grouped as one commit: ${r.planFallbackReason}` : ''
  return `${head}, pull request opened${tail}`
}

export type GitActionsProps = {
  runId: string
  repo: RepoInfo
  fileCount: number
  totals: { additions: number; deletions: number }
  taskName: string
  gh: { installed: boolean; authenticated: boolean }
  baseBranch: string
}

export function GitActions({
  runId,
  repo,
  fileCount,
  totals,
  taskName,
  gh,
  baseBranch,
}: GitActionsProps) {
  const [dialog, setDialog] = useState<null | 'commit' | 'branch' | 'pr' | 'discard'>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [branchName, setBranchName] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const [pushed, setPushed] = useState<string | null>(null)
  const [shipped, setShipped] = useState<string | null>(null)

  const commit = useCommit(runId)
  const push = usePush(runId)
  const discard = useDiscard(runId)
  const createBranch = useCreateBranch(runId)
  const openPr = useOpenPullRequest(runId)
  const ship = useShipRun(runId)

  if (!repo.isRepo) {
    return (
      <div className="rounded-xl border border-[var(--border-quaternary)] bg-transparent p-3">
        <div className="text-[11px] uppercase tracking-wide text-tier-tertiary">Workspace</div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-tier-tertiary">
          This run's working directory is not a git repository, so file changes can't be tracked.
        </p>
      </div>
    )
  }

  const hasChanges = fileCount > 0
  const dirtyGate = { hasChanges }
  const shipGate = shipGateFrom({
    hasRemote: Boolean(repo.remote),
    ghInstalled: gh.installed,
    ghAuthenticated: gh.authenticated,
  })
  const commitBlocked = commitBlockedReason(dirtyGate)
  const discardBlocked = discardBlockedReason(dirtyGate)
  const pushBlocked = pushBlockedReason(shipGate)
  const prBlocked = prBlockedReason(shipGate)
  const shipState = { ...shipGate, hasChanges, ahead: repo.ahead }
  const shipBlocked = shipBlockedReason(shipState)
  const openCommit = () => {
    setCommitMessage(taskName ? `${taskName}\n\nAutomated by Open Run.` : '')
    setDialog('commit')
  }
  const openPrDialog = () => {
    setPrTitle(taskName || 'Agent changes')
    setPrBody('Automated changes produced by an Open Run run.')
    setDialog('pr')
  }
  const shipNow = () => {
    setShipped(null)
    setPrUrl(null)
    ship.mutate(undefined, {
      onSuccess: (r) => {
        setPrUrl(r.url)
        setShipped(shipSuccessText(r))
      },
    })
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--border-quaternary)] bg-transparent p-3">
        <div className="mb-1.5 text-[11px] uppercase tracking-wide text-tier-tertiary">
          Workspace
        </div>
        <Row icon={<GitBranch className="h-3.5 w-3.5" />}>
          <span className="text-tier-secondary">{repo.branch || 'detached'}</span>
          {repo.head ? (
            <span className="ml-1.5 mono text-ui-sm text-tier-quaternary">{repo.head}</span>
          ) : null}
        </Row>
        <Row icon={<GitCommit className="h-3.5 w-3.5" />}>
          {hasChanges ? (
            <span className="flex items-center gap-2">
              {fileCount} changed
              <DiffStat additions={totals.additions} deletions={totals.deletions} />
            </span>
          ) : (
            <span className="text-tier-quaternary">Working tree clean</span>
          )}
        </Row>
        {repo.hasUpstream && repo.ahead > 0 ? (
          <Row icon={<Upload className="h-3.5 w-3.5" />}>
            {repo.ahead} commit{repo.ahead === 1 ? '' : 's'} ahead of upstream
          </Row>
        ) : null}
        {baseBranch && baseBranch !== repo.branch ? (
          <Row icon={<GitBranch className="h-3.5 w-3.5" />}>
            <span className="text-tier-quaternary">started on {baseBranch}</span>
          </Row>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Button
          className="w-full justify-start"
          title={commitBlocked ?? 'Commit changes'}
          disabled={!canCommit(dirtyGate)}
          onClick={openCommit}
        >
          <GitCommit className="h-4 w-4" /> Commit changes
        </Button>
        <Button className="w-full justify-start" onClick={() => setDialog('branch')}>
          <GitBranch className="h-4 w-4" /> New branch
        </Button>
        <Button
          className="w-full justify-start"
          title={pushBlocked ?? 'Push branch'}
          disabled={push.isPending || !canPush(shipGate)}
          onClick={() => {
            setPushed(null)
            push.mutate(undefined, { onSuccess: (r) => setPushed(`Pushed ${r.branch} to origin`) })
          }}
        >
          {push.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Push branch
        </Button>
        <Button
          variant="primary"
          className="w-full justify-start"
          title={shipBlocked ?? SHIP_HINT}
          disabled={ship.isPending || !canShip(shipState)}
          onClick={shipNow}
        >
          {ship.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GitPullRequest className="h-4 w-4" />
          )}
          {ship.isPending ? 'Creating pull request…' : 'Create pull request'}
        </Button>
        <Button
          className="w-full justify-start"
          title={prBlocked ?? 'Write the title and description yourself'}
          disabled={ship.isPending || !canCreatePullRequest(shipGate)}
          onClick={openPrDialog}
        >
          <GitPullRequest className="h-4 w-4" /> Write the pull request myself
        </Button>
        <Button
          variant="danger"
          className="w-full justify-start"
          title={discardBlocked ?? 'Discard all changes'}
          disabled={!canDiscard(dirtyGate)}
          onClick={() => setDialog('discard')}
        >
          <Trash2 className="h-4 w-4" /> Discard all changes
        </Button>
      </div>

      {prBlocked || pushBlocked ? (
        <p className="px-1 text-[11px] leading-relaxed text-tier-quaternary">
          {prBlocked ?? pushBlocked}
        </p>
      ) : null}

      {ship.isPending ? (
        <p className="px-1 text-[11px] leading-relaxed text-tier-quaternary">
          Grouping the changes into commits with {taskName ? 'this run' : 'the run'}'s runtime…
        </p>
      ) : null}
      <Result error={ship.isError ? errorText(ship.error) : null} success={shipped} />
      <Result error={push.isError ? errorText(push.error) : null} success={pushed} />
      {prUrl ? (
        <a
          href={prUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-indigo-500/25 bg-indigo-500/10 px-2.5 py-2 text-[11.5px] text-indigo-300 hover:bg-indigo-500/15"
        >
          <GitPullRequest className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{prUrl}</span>
        </a>
      ) : null}

      <GitActionDialogs
        dialog={dialog}
        setDialog={setDialog}
        repo={repo}
        fileCount={fileCount}
        totals={totals}
        commitMessage={commitMessage}
        setCommitMessage={setCommitMessage}
        branchName={branchName}
        setBranchName={setBranchName}
        prTitle={prTitle}
        setPrTitle={setPrTitle}
        prBody={prBody}
        setPrBody={setPrBody}
        setPrUrl={setPrUrl}
        commit={commit}
        createBranch={createBranch}
        openPr={openPr}
        discard={discard}
      />
    </div>
  )
}

type GitDialog = null | 'commit' | 'branch' | 'pr' | 'discard'

/**
 * The commit / branch / PR / discard modals.
 *
 * Shared by the sidebar `GitActions` panel and the compact top-bar
 * `GitActionsMenu` so both surfaces drive identical flows.
 */
function GitActionDialogs({
  dialog,
  setDialog,
  repo,
  fileCount,
  totals,
  commitMessage,
  setCommitMessage,
  branchName,
  setBranchName,
  prTitle,
  setPrTitle,
  prBody,
  setPrBody,
  setPrUrl,
  commit,
  createBranch,
  openPr,
  discard,
}: {
  dialog: GitDialog
  setDialog: (d: GitDialog) => void
  repo: RepoInfo
  fileCount: number
  totals: { additions: number; deletions: number }
  commitMessage: string
  setCommitMessage: (v: string) => void
  branchName: string
  setBranchName: (v: string) => void
  prTitle: string
  setPrTitle: (v: string) => void
  prBody: string
  setPrBody: (v: string) => void
  setPrUrl: (v: string | null) => void
  commit: ReturnType<typeof useCommit>
  createBranch: ReturnType<typeof useCreateBranch>
  openPr: ReturnType<typeof useOpenPullRequest>
  discard: ReturnType<typeof useDiscard>
}) {
  return (
    <>
      {dialog === 'commit' ? (
        <Modal title="Commit changes" onClose={() => setDialog(null)}>
          <Field label="Commit message">
            <textarea
              rows={4}
              autoFocus
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              className={`${inputClass} resize-y`}
            />
          </Field>
          <p className="mt-2 text-[12px] text-tier-tertiary">
            Stages all {fileCount} changed file{fileCount === 1 ? '' : 's'} on{' '}
            <span className="mono text-tier-secondary">{repo.branch}</span>.
          </p>
          <Result error={commit.isError ? errorText(commit.error) : null} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={commit.isPending || !commitMessage.trim()}
              onClick={() =>
                commit.mutate({ message: commitMessage }, { onSuccess: () => setDialog(null) })
              }
            >
              {commit.isPending ? 'Committing…' : 'Commit'}
            </Button>
          </div>
        </Modal>
      ) : null}

      {dialog === 'branch' ? (
        <Modal title="Create branch" onClose={() => setDialog(null)}>
          <Field label="Branch name" hint="Switches the workspace to the new branch">
            <input
              autoFocus
              value={branchName}
              placeholder="agentops/my-change"
              onChange={(e) => setBranchName(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Result error={createBranch.isError ? errorText(createBranch.error) : null} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={createBranch.isPending || !branchName.trim()}
              onClick={() =>
                createBranch.mutate(
                  { name: branchName.trim() },
                  {
                    onSuccess: () => {
                      setDialog(null)
                      setBranchName('')
                    },
                  },
                )
              }
            >
              {createBranch.isPending ? 'Creating…' : 'Create branch'}
            </Button>
          </div>
        </Modal>
      ) : null}

      {dialog === 'pr' ? (
        <Modal title="Create pull request" onClose={() => setDialog(null)}>
          <div className="space-y-3">
            <Field label="Title">
              <input
                autoFocus
                value={prTitle}
                onChange={(e) => setPrTitle(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Description">
              <textarea
                rows={5}
                value={prBody}
                onChange={(e) => setPrBody(e.target.value)}
                className={`${inputClass} resize-y`}
              />
            </Field>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-tier-tertiary">
            Opens a PR from <span className="mono text-tier-secondary">{repo.branch}</span> on
            GitHub via the <span className="mono">gh</span> CLI. Commit and push your changes first.
          </p>
          <Result error={openPr.isError ? errorText(openPr.error) : null} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={openPr.isPending || !prTitle.trim()}
              onClick={() =>
                openPr.mutate(
                  { title: prTitle.trim(), body: prBody },
                  {
                    onSuccess: (r) => {
                      setPrUrl(r.url)
                      setDialog(null)
                    },
                  },
                )
              }
            >
              {openPr.isPending ? 'Creating…' : 'Create pull request'}
            </Button>
          </div>
        </Modal>
      ) : null}

      {dialog === 'discard' ? (
        <Modal title="Discard all changes" onClose={() => setDialog(null)}>
          <p className="text-[13.5px] leading-relaxed text-tier-secondary">
            This resets the working tree to <span className="mono text-tier-secondary">HEAD</span>{' '}
            and deletes untracked files in{' '}
            <span className="mono text-tier-secondary">{repo.branch}</span>. All{' '}
            {totals.additions + totals.deletions} changed lines across {fileCount} file
            {fileCount === 1 ? '' : 's'} will be lost.
          </p>
          <p className="mt-2 text-[12.5px] text-amber-300/80">This cannot be undone.</p>
          <Result error={discard.isError ? errorText(discard.error) : null} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={discard.isPending}
              onClick={() => discard.mutate({}, { onSuccess: () => setDialog(null) })}
            >
              {discard.isPending ? 'Discarding…' : 'Discard everything'}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}

/**
 * Compact git control for the workspace top bar (t3code-style).
 *
 * Shows branch + dirty state inline; the dropdown holds the write actions.
 * Reuses `GitActionDialogs` so flows match the sidebar panel exactly.
 */
export function GitActionsMenu({
  runId,
  repo,
  fileCount,
  totals,
  taskName,
  gh,
  baseBranch,
  trigger,
  menuAlign = 'right',
  onViewChanges,
}: GitActionsProps & {
  /** Override the default branch-name trigger (e.g. panel "Changed" chip). */
  trigger?: {
    label: string
    icon?: ComponentType<{ className?: string }>
    active?: boolean
    onActivate?: () => void
  }
  menuAlign?: 'left' | 'right'
  onViewChanges?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<GitDialog>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [branchName, setBranchName] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const [shipError, setShipError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const commit = useCommit(runId)
  const push = usePush(runId)
  const discard = useDiscard(runId)
  const createBranch = useCreateBranch(runId)
  const openPr = useOpenPullRequest(runId)
  const ship = useShipRun(runId)

  // Close on outside click / Escape — but not while a ship is in flight: it
  // runs the agent, so the spinner and the error it may produce are the only
  // feedback the user has, and they live inside this menu.
  useEffect(() => {
    if (!open || ship.isPending) return
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, ship.isPending])

  if (!repo.isRepo) return null

  const hasChanges = fileCount > 0
  const dirtyGate = { hasChanges }
  const shipGate = shipGateFrom({
    hasRemote: Boolean(repo.remote),
    ghInstalled: gh.installed,
    ghAuthenticated: gh.authenticated,
  })
  const commitBlocked = commitBlockedReason(dirtyGate)
  const discardBlocked = discardBlockedReason(dirtyGate)
  const pushBlocked = pushBlockedReason(shipGate)
  const prBlocked = prBlockedReason(shipGate)
  const shipState = { ...shipGate, hasChanges, ahead: repo.ahead }
  const shipBlocked = shipBlockedReason(shipState)
  const TriggerIcon = trigger?.icon ?? GitBranch
  const triggerLabel = trigger?.label ?? (repo.branch || 'detached')
  const openDialog = (next: GitDialog) => {
    if (next === 'commit') {
      setCommitMessage(taskName ? `${taskName}\n\nAutomated by Open Run.` : '')
    }
    if (next === 'pr') {
      setPrTitle(taskName || 'Agent changes')
      setPrBody('Automated changes produced by an Open Run run.')
    }
    setDialog(next)
    setOpen(false)
  }

  const item =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-foreground transition-colors hover:bg-[var(--bg-luminous-tertiary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div className="relative" ref={menuRef}>
      <WorkspaceToolbarChip
        icon={TriggerIcon}
        label={triggerLabel}
        count={hasChanges ? fileCount : undefined}
        showChevron
        active={trigger?.active ?? open}
        mono={!trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        title={
          trigger
            ? hasChanges
              ? `${fileCount} changed file${fileCount === 1 ? '' : 's'}`
              : 'No changed files'
            : `${repo.branch || 'detached'}${hasChanges ? ` — ${fileCount} changed` : ' — clean'}`
        }
        onClick={() => {
          trigger?.onActivate?.()
          setOpen((v) => !v)
        }}
      />

      {open ? (
        <div
          role="menu"
          className={`absolute z-50 mt-1.5 w-60 rounded-xl border border-border bg-elevated p-1.5 shadow-2xl shadow-[var(--shadow-primary)] ${
            menuAlign === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <div className="px-2 pb-1.5 pt-1 text-[11px] text-muted-foreground">
            <div className="truncate mono text-foreground">{repo.branch || 'detached'}</div>
            {hasChanges ? (
              <span className="mt-0.5 flex items-center gap-2">
                {fileCount} changed
                <DiffStat additions={totals.additions} deletions={totals.deletions} />
              </span>
            ) : (
              <div className="mt-0.5">Working tree clean</div>
            )}
            {repo.hasUpstream && repo.ahead > 0 ? (
              <div className="mt-0.5">{repo.ahead} ahead of upstream</div>
            ) : null}
            {baseBranch && baseBranch !== repo.branch ? (
              <div className="mt-0.5 truncate">started on {baseBranch}</div>
            ) : null}
          </div>
          <div className="my-1 h-px bg-border" />

          {onViewChanges ? (
            <button
              type="button"
              className={item}
              onClick={() => {
                onViewChanges()
                setOpen(false)
              }}
            >
              <GitCompare className="h-3.5 w-3.5" /> View changes
            </button>
          ) : null}
          <button
            type="button"
            className={item}
            title={commitBlocked ?? 'Commit changes'}
            disabled={!canCommit(dirtyGate)}
            onClick={() => openDialog('commit')}
          >
            <GitCommit className="h-3.5 w-3.5" /> Commit changes
          </button>
          <button type="button" className={item} onClick={() => openDialog('branch')}>
            <GitBranch className="h-3.5 w-3.5" /> New branch
          </button>
          <button
            type="button"
            className={item}
            title={pushBlocked ?? 'Push branch'}
            disabled={push.isPending || !canPush(shipGate)}
            onClick={() => {
              push.mutate(undefined)
              setOpen(false)
            }}
          >
            {push.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Push branch
          </button>
          <button
            type="button"
            className={item}
            title={shipBlocked ?? SHIP_HINT}
            disabled={ship.isPending || !canShip(shipState)}
            onClick={() => {
              setShipError(null)
              setPrUrl(null)
              ship.mutate(undefined, {
                onSuccess: (r) => setPrUrl(r.url),
                onError: (err) => setShipError(errorText(err)),
              })
            }}
          >
            {ship.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitPullRequest className="h-3.5 w-3.5" />
            )}
            {ship.isPending ? 'Creating pull request…' : 'Create pull request'}
          </button>
          <button
            type="button"
            className={item}
            title={prBlocked ?? 'Write the title and description yourself'}
            disabled={ship.isPending || !canCreatePullRequest(shipGate)}
            onClick={() => openDialog('pr')}
          >
            <GitPullRequest className="h-3.5 w-3.5" /> Write the pull request myself
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            className={`${item} text-[var(--danger)] hover:bg-[var(--danger)]/10`}
            title={discardBlocked ?? 'Discard all changes'}
            disabled={!canDiscard(dirtyGate)}
            onClick={() => openDialog('discard')}
          >
            <Trash2 className="h-3.5 w-3.5" /> Discard all changes
          </button>

          {shipError ? (
            <div className="mt-1 flex items-start gap-1.5 px-2 py-1.5 text-[11.5px] leading-relaxed text-rose-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{shipError}</span>
            </div>
          ) : null}
          {prUrl ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] text-indigo-300 hover:bg-indigo-500/10"
            >
              <GitPullRequest className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">View pull request</span>
            </a>
          ) : null}
        </div>
      ) : null}

      <GitActionDialogs
        dialog={dialog}
        setDialog={setDialog}
        repo={repo}
        fileCount={fileCount}
        totals={totals}
        commitMessage={commitMessage}
        setCommitMessage={setCommitMessage}
        branchName={branchName}
        setBranchName={setBranchName}
        prTitle={prTitle}
        setPrTitle={setPrTitle}
        prBody={prBody}
        setPrBody={setPrBody}
        setPrUrl={setPrUrl}
        commit={commit}
        createBranch={createBranch}
        openPr={openPr}
        discard={discard}
      />
    </div>
  )
}
