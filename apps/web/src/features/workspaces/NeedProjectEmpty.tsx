import { useState } from 'react'
import { needProjectBeforeAutomationDetail } from '@openrun/domain/workspaces/projectGate'
import { AddProjectModal } from './AddProjectModal.tsx'
import { Button, EmptyState } from '../../components/ui.tsx'

/** Shared empty state when Automations / New are blocked with no projects. */
export function NeedProjectEmpty() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <EmptyState title="Add a project first">
        {needProjectBeforeAutomationDetail()}
        <div className="mt-3">
          <Button variant="primary" onClick={() => setOpen(true)}>
            Add project
          </Button>
        </div>
      </EmptyState>
      {open ? <AddProjectModal onClose={() => setOpen(false)} /> : null}
    </>
  )
}
