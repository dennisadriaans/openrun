/**
 * Project + workspace select pair, shared by TaskForm and the planner —
 * anywhere an agent run needs to be pinned to a workspace's worktree.
 */
import { useEffect, useState } from 'react'
import { isMainCheckout, pickDefaultWorkspace } from '../lib/pickWorkspace'
import { isWorkspaceReady, workspaceNotReadyMessage } from '../lib/workspaceReady'
import { useProjects, useWorkspaces } from '../lib/queries'
import { ManageProjectsModal } from './ProjectsManager'
import { Field, inputClass } from './ui'

export function WorkspacePicker({
  projectId,
  workspaceId,
  onChange,
}: {
  projectId: string
  workspaceId: string
  onChange: (v: { projectId: string; workspaceId: string }) => void
}) {
  const { data: projects, isLoading: loadingProjects } = useProjects()
  const { data: workspaces, isLoading: loadingWorkspaces } = useWorkspaces(projectId || undefined)
  const [managing, setManaging] = useState(false)

  const activeWorkspaces = (workspaces ?? []).filter((w) => w.status !== 'archived')
  // Prefer ready worktrees; keep a non-ready current selection visible so a
  // legacy automation can still show (and refuse) instead of silently clearing.
  const selectableWorkspaces = activeWorkspaces.filter(
    (w) => isWorkspaceReady(w.status) || w.id === workspaceId,
  )

  // If the current workspace no longer belongs to the selected project (e.g.
  // the project changed), or it's gone missing, clear it rather than submit
  // a stale id silently.
  useEffect(() => {
    if (!workspaceId) return
    if (workspaces && !workspaces.some((w) => w.id === workspaceId)) {
      onChange({ projectId, workspaceId: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces])

  // When the project is set but no workspace is chosen yet, auto-pick a ready
  // worktree (main only as a fallback). Also covers the creating→ready poll:
  // once a ready row appears, Create no longer stays blocked on an empty select.
  useEffect(() => {
    if (!projectId || workspaceId || loadingWorkspaces || !workspaces) return
    const picked = pickDefaultWorkspace(activeWorkspaces)
    if (picked) onChange({ projectId, workspaceId: picked.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, workspaceId, workspaces, loadingWorkspaces])

  if (!loadingProjects && (projects?.length ?? 0) === 0) {
    return (
      <>
        <button
          type="button"
          onClick={() => setManaging(true)}
          className="w-full rounded-lg border border-dashed border-border px-3 py-2.5 text-left text-ui-base text-tier-tertiary hover:border-border-strong hover:text-foreground"
        >
          No projects yet — add one →
        </button>
        {managing ? <ManageProjectsModal onClose={() => setManaging(false)} /> : null}
      </>
    )
  }

  const selectedWorkspace = activeWorkspaces.find((w) => w.id === workspaceId)
  const selectedNotReady = selectedWorkspace && !isWorkspaceReady(selectedWorkspace.status)

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Project">
        <select
          className={inputClass}
          value={projectId}
          onChange={(e) => {
            const nextProjectId = e.target.value
            if (!nextProjectId) {
              onChange({ projectId: '', workspaceId: '' })
              return
            }
            // Project change: clear first; the effect above fills in a ready
            // default once workspaces for the new project load.
            onChange({ projectId: nextProjectId, workspaceId: '' })
          }}
        >
          <option value="">Select a project…</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Workspace" hint="worktree the agent runs in">
        {projectId && !loadingWorkspaces && selectableWorkspaces.length === 0 ? (
          <button
            type="button"
            onClick={() => setManaging(true)}
            className="w-full rounded-lg border border-dashed border-border px-3 py-2 text-left text-ui-sm text-tier-tertiary hover:border-border-strong hover:text-foreground"
          >
            No ready workspaces — create one →
          </button>
        ) : (
          <select
            className={inputClass}
            value={workspaceId}
            disabled={!projectId}
            onChange={(e) => onChange({ projectId, workspaceId: e.target.value })}
          >
            <option value="">Select a workspace…</option>
            {selectableWorkspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.branch}
                {w.kind === 'main' ? ' — main checkout, shared with your editor' : ''}
                {!isWorkspaceReady(w.status) ? ` (${w.status})` : ''}
              </option>
            ))}
          </select>
        )}
      </Field>

      {selectedWorkspace ? (
        <div className="md:col-span-2 mono text-ui-sm text-tier-tertiary">
          {selectedWorkspace.path}
        </div>
      ) : null}
      {selectedNotReady ? (
        <p className="md:col-span-2 text-ui-sm text-rose-300">
          {workspaceNotReadyMessage(selectedWorkspace.status)}
        </p>
      ) : null}
      {isMainCheckout(selectedWorkspace) ? (
        <p className="md:col-span-2 text-ui-sm text-amber-300">
          This runs in your main checkout — the one your editor has open. Pick or create a worktree
          to keep the agent off those files.
        </p>
      ) : null}
      {managing ? <ManageProjectsModal onClose={() => setManaging(false)} /> : null}
    </div>
  )
}
