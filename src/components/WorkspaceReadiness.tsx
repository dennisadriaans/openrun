/**
 * "Is this automation actually safe to leave running overnight?"
 *
 * Everything here is state the automation form cannot show, because it is not
 * what the automation was *configured* with — it is what is on disk right now.
 * The configured branch and the live branch are deliberately shown side by
 * side: a scheduled run that silently switched the shared checkout onto
 * another branch is invisible in any view that only prints one of them.
 */
import { AlertTriangle, CheckCircle2, GitBranch, Loader2, RotateCcw, Split } from 'lucide-react'
import type { TaskWithMeta } from '../fns'
import { hasUnattendedTrigger } from '../lib/taskReadiness'
import { taskWorkspaceChangeBlockedReason } from '../lib/taskIsolationGate'
import { runNowBlockedReason } from '../lib/runNowGate'
import { missingWorkspaceMessage } from '../lib/workspaceRef'
import { isFatalHealth, workspaceHealthMessage } from '../lib/workspaceHealth'
import { workspaceNotReadyMessage } from '../lib/workspaceReady'
import { Button, Card } from './ui'
import {
  useClearWorkspaceQuarantine,
  useIsolateTaskWorkspace,
  useRestoreTaskWorkspace,
  useRunWorkspaceBaseline,
} from '../lib/queries'

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 text-ui-sm">
      <span className="w-28 shrink-0 text-tier-quaternary">{label}</span>
      <span
        className={`min-w-0 break-all font-mono ${muted ? 'text-tier-quaternary' : 'text-tier-secondary'}`}
      >
        {value || '—'}
      </span>
    </div>
  )
}

export function WorkspaceReadiness({ task }: { task: TaskWithMeta }) {
  const isolate = useIsolateTaskWorkspace()
  const restore = useRestoreTaskWorkspace()
  const baseline = useRunWorkspaceBaseline(task.id)
  const clearQuarantine = useClearWorkspaceQuarantine()

  const health = task.workspaceHealth
  const blockers = task.readinessBlockers ?? []
  const blocked = blockers.length > 0
  const cannotRun = runNowBlockedReason(task) !== null
  const sharedCheckout = task.workspaceKind === 'main' && task.requireIsolation === 1
  const workspaceUnavailable =
    !task.workspaceValid || !task.workspaceReady || Boolean(health && isFatalHealth(health.code))
  const canRestore = task.workspaceKind === 'worktree' && (!health || !isFatalHealth(health.code))
  const quarantined = health?.code === 'blocked'
  const activityBlocked = taskWorkspaceChangeBlockedReason(task)
  const baselineBlocked = !task.workspaceValid
    ? missingWorkspaceMessage()
    : !task.workspaceReady
      ? workspaceNotReadyMessage(task.workspaceStatus)
      : health && health.code !== 'ok'
        ? workspaceHealthMessage(health)
        : null
  const pending =
    isolate.isPending || restore.isPending || baseline.isPending || clearQuarantine.isPending

  const onError = (err: unknown) => window.alert(err instanceof Error ? err.message : String(err))

  return (
    <Card className="mt-6 p-4">
      <div className="mb-3 flex items-center gap-2">
        {blocked ? (
          <AlertTriangle className="h-4 w-4 text-danger" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-success" />
        )}
        <h2 className="text-ui-sm font-medium text-tier-secondary">
          {blocked
            ? cannotRun
              ? 'Cannot Run This Automation'
              : 'Not Ready for Unattended Runs'
            : hasUnattendedTrigger(task)
              ? 'Ready for Unattended Runs'
              : 'Ready to Run'}
        </h2>
      </div>

      {blocked ? (
        <ul className="mb-3 space-y-1 text-ui-sm leading-relaxed text-tier-secondary">
          {blockers.map((blocker, index) => (
            <li key={`${blocker.id}-${index}`} className="flex gap-2">
              <span aria-hidden className="text-danger">
                •
              </span>
              <span>{blocker.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {workspaceUnavailable ? (
        <p className="mb-3 text-ui-sm leading-relaxed text-tier-tertiary">
          Choose another workspace above, open an existing branch in a new workspace, or create a
          new branch and workspace from the same menu.
        </p>
      ) : null}

      <div className="space-y-1">
        <Row label="Workspace" value={health?.path ?? task.cwd} />
        <Row
          label="Kind"
          value={task.workspaceKind === 'main' ? 'main checkout (shared)' : 'app-managed worktree'}
          muted={task.workspaceKind !== 'main'}
        />
        <Row label="Configured branch" value={health?.configuredBranch ?? ''} />
        <Row
          label="Actual branch"
          value={health?.actualBranch ?? ''}
          muted={!health || health.actualBranch === health.configuredBranch}
        />
        <Row
          label="Working tree"
          value={health?.dirty ? 'has uncommitted changes' : 'clean'}
          muted={!health?.dirty}
        />
        {task.requiresGh ? (
          <Row
            label="GitHub CLI"
            value={
              !task.ghInstalled
                ? 'not installed'
                : task.ghAuthenticated
                  ? 'authenticated'
                  : 'not authenticated'
            }
            muted={task.ghInstalled && task.ghAuthenticated}
          />
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {sharedCheckout ? (
          <Button
            variant="primary"
            disabled={pending || activityBlocked !== null}
            onClick={() => isolate.mutate(task.id, { onError })}
            title={activityBlocked ?? 'Create a worktree and branch for this automation alone'}
          >
            {isolate.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Split className="h-3.5 w-3.5" />
            )}
            Give it its own worktree
          </Button>
        ) : null}

        {canRestore ? (
          <Button
            variant="ghost"
            disabled={pending || activityBlocked !== null}
            onClick={() => {
              if (
                !confirm(
                  'Put this worktree back on its branch, discarding uncommitted changes and any commits it has not pushed?',
                )
              ) {
                return
              }
              restore.mutate(task.id, { onError })
            }}
            title={activityBlocked ?? 'Reset the worktree and lift any quarantine'}
          >
            {restore.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Restore workspace
          </Button>
        ) : null}

        {quarantined ? (
          <Button
            variant="ghost"
            disabled={pending || activityBlocked !== null}
            onClick={() => clearQuarantine.mutate(task.id, { onError })}
            title={activityBlocked ?? 'Keep the files, but stop refusing unattended runs here'}
          >
            {clearQuarantine.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Clear quarantine
          </Button>
        ) : null}

        <Button
          variant="ghost"
          disabled={pending || activityBlocked !== null || baselineBlocked !== null}
          onClick={() =>
            baseline.mutate(task.workspaceId, {
              onError,
              onSuccess: (result) => {
                window.alert(
                  result.ok ? 'Baseline is green — this workspace is safe to arm.' : result.detail,
                )
              },
            })
          }
          title={
            activityBlocked ??
            baselineBlocked ??
            "Run the project's checks here before arming anything against it"
          }
        >
          {baseline.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <GitBranch className="h-3.5 w-3.5" />
          )}
          Run baseline checks
        </Button>
      </div>
    </Card>
  )
}
