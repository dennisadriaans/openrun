/** Compatibility project selector for automation and planner callers. */
import { useEffect, useState } from 'react'
import { useProjects, useWorkspaces } from './queries.ts'
import { ManageProjectsModal } from './ProjectsManager.tsx'
import { Field, inputClass } from '../../components/ui.tsx'

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
        Scheduled and webhook runs each get a fresh worktree from the base. Only an automation that
        resumes a saved chat runs in this checkout.
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
