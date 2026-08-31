import { useState, type FormEvent } from 'react'
import { Button, Field, inputClass, Modal } from './ui'

export function NewWorkspaceModal({
  projectName,
  defaultBaseBranch,
  pending,
  onClose,
  onCreate,
}: {
  projectName: string
  defaultBaseBranch: string
  pending: boolean
  onClose: () => void
  onCreate: (input: { branch: string; fromBranch?: string }) => Promise<void>
}) {
  const [branch, setBranch] = useState('')
  const [baseBranch, setBaseBranch] = useState(defaultBaseBranch)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const nextBranch = branch.trim()
    if (!nextBranch || pending) return
    setError(null)
    try {
      await onCreate({
        branch: nextBranch,
        ...(baseBranch.trim() ? { fromBranch: baseBranch.trim() } : {}),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal title={`New workspace — ${projectName}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <p className="text-ui-base text-tier-secondary">
          Create a new branch in a separate Git worktree for this automation.
        </p>
        <Field label="New branch">
          <input
            className={`${inputClass} mono text-[13px]`}
            name="new-workspace-branch"
            autoComplete="off"
            spellCheck={false}
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="e.g. automation/update-dependencies…"
          />
        </Field>
        <Field label="Base branch" hint="only committed Git state is copied">
          <input
            className={`${inputClass} mono text-[13px]`}
            name="new-workspace-base-branch"
            autoComplete="off"
            spellCheck={false}
            value={baseBranch}
            onChange={(event) => setBaseBranch(event.target.value)}
          />
        </Field>
        {error ? (
          <p aria-live="polite" className="text-ui-base text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!branch.trim() || pending}>
            {pending ? 'Creating…' : 'Create Workspace'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
