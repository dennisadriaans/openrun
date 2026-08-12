import { useState } from 'react'
import { needProjectBeforeAutomationDetail } from '../lib/projectGate'
import { AddProjectModal } from './AddProjectModal'
import { Button, EmptyState } from './ui'

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
