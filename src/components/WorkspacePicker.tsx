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
    const main = workspaces.find(
      (w) => w.projectId === projectId && w.kind === 'main' && w.status === 'ready',
    )
    if (main && workspaceId !== main.id) onChange({ projectId, workspaceId: main.id })
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
        Automations get a clean checkout for each run, based on the project's default branch.
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
