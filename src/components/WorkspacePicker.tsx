/** Compatibility project selector for automation and planner callers. */
import { useEffect, useState } from 'react'
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
  const { data: projects } = useProjects()
  const { data: workspaces } = useWorkspaces(projectId || undefined)
  const [managing, setManaging] = useState(false)
  useEffect(() => {
    if (!projectId || !workspaces) return
    if (workspaces.some((workspace) => workspace.id === workspaceId)) return
    const selected = workspaces.find((w) => w.projectId === projectId && w.status === 'ready')
    if (selected) onChange({ projectId, workspaceId: selected.id })
  }, [projectId, workspaceId, workspaces, onChange])
  return (
    <div>
      <Field label="Project">
        <select
          className={inputClass}
          value={projectId}
          onChange={(e) => onChange({ projectId: e.target.value, workspaceId: '' })}
        >
          <option value="">Choose a project…</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <p className="mt-2 text-ui-sm text-tier-tertiary">
        Scheduled runs use this checkout. Webhook deliveries get a fresh worktree from the base.
      </p>
      <button
        type="button"
        className="mt-2 text-ui-sm text-tier-secondary"
        onClick={() => setManaging(true)}
      >
        Manage projects
      </button>
      {managing ? <ManageProjectsModal onClose={() => setManaging(false)} /> : null}
    </div>
  )
}
