/**
 * Workspace top-bar breadcrumb: project / branch [/ run title].
 *
 * Rendered as a single horizontal row (t3code style) rather than a stacked
 * title+subtitle block. Segments truncate individually so the branch stays
 * readable when the project name is long. The branch segment is a workspace
 * switcher when workspaces are provided.
 */
import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronDown, ChevronRight, GitBranch, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkspaceWithMeta } from '../../fns'
import { fetchLatestRunForWorkspace } from '../../lib/queries'

function Separator() {
  return <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
}

function Segment({
  children,
  className = '',
  title,
}: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span className={`min-w-0 truncate ${className}`} title={title}>
      {children}
    </span>
  )
}

function BranchSwitcher({
  current,
  workspaces,
  disabled,
  muted,
  onRequestNewBranch,
}: {
  current: WorkspaceWithMeta
  workspaces: WorkspaceWithMeta[]
  disabled?: boolean
  muted?: boolean
  onRequestNewBranch?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const ready = workspaces.filter((w) => w.status === 'ready' || w.id === current.id)

  const switchTo = async (ws: WorkspaceWithMeta) => {
    if (ws.id === current.id) {
      setOpen(false)
      return
    }
    setBusyId(ws.id)
    try {
      const latest = await fetchLatestRunForWorkspace(ws.id)
      if (latest?.id) {
        navigate({ to: '/runs/$runId', params: { runId: latest.id } })
      } else {
        navigate({ to: '/runs' })
      }
      setOpen(false)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div ref={ref} className="relative min-w-0 max-w-[36%] shrink">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={current.path}
        className={`flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-[var(--bg-luminous-quaternary)] disabled:opacity-40 ${
          muted ? 'text-muted-foreground' : 'font-medium text-foreground'
        }`}
      >
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <span className="mono min-w-0 truncate">{current.branch}</span>
        {current.kind === 'main' ? (
          <span className="shrink-0 text-[11px] text-muted-foreground/50">(main)</span>
        ) : null}
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-40 mt-1.5 min-w-56 overflow-hidden rounded-xl border border-border bg-elevated p-1 shadow-xl shadow-black/40">
          <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Workspaces
          </div>
          {ready.map((ws) => (
            <button
              key={ws.id}
              type="button"
              disabled={busyId === ws.id}
              onClick={() => void switchTo(ws)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                ws.id === current.id
                  ? 'bg-secondary text-foreground'
                  : 'text-foreground/85 hover:bg-secondary/70'
              }`}
            >
              <GitBranch className="size-3.5 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate mono text-[12.5px]">{ws.branch}</span>
              {ws.kind === 'main' ? (
                <span className="text-[10px] text-muted-foreground">main</span>
              ) : null}
              {ws.id === current.id ? <Check className="size-3.5 shrink-0" /> : null}
            </button>
          ))}
          {onRequestNewBranch ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onRequestNewBranch()
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-lg border-t border-border px-2.5 py-2 text-left text-sm text-foreground/85 hover:bg-secondary/70"
            >
              <Plus className="size-3.5 shrink-0 opacity-70" />
              New branch…
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function WorkspaceBreadcrumb({
  projectName,
  branch,
  isMainCheckout,
  runTitle,
  trailing,
  workspace,
  workspaces,
  branchDisabled,
  onRequestNewBranch,
}: {
  projectName?: string
  branch?: string
  isMainCheckout?: boolean
  runTitle?: string
  trailing?: ReactNode
  workspace?: WorkspaceWithMeta | null
  workspaces?: WorkspaceWithMeta[]
  branchDisabled?: boolean
  onRequestNewBranch?: () => void
}) {
  const showSwitcher = Boolean(workspace && workspaces)
  const branchLabel = workspace?.branch ?? branch

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]"
    >
      {projectName ? (
        <>
          <span
            className="min-w-0 max-w-[30%] shrink truncate text-muted-foreground"
            title={projectName}
          >
            {projectName}
          </span>
          {branchLabel || runTitle ? <Separator /> : null}
        </>
      ) : null}

      {showSwitcher && workspace && workspaces ? (
        <>
          <BranchSwitcher
            current={workspace}
            workspaces={workspaces}
            disabled={branchDisabled}
            muted={Boolean(runTitle)}
            onRequestNewBranch={onRequestNewBranch}
          />
          {runTitle ? <Separator /> : null}
        </>
      ) : branchLabel ? (
        <>
          <Segment
            className={`flex max-w-[36%] shrink items-center gap-1.5 ${
              runTitle ? 'text-muted-foreground' : 'font-medium text-foreground'
            }`}
            title={branchLabel}
          >
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <span className="mono min-w-0 truncate">{branchLabel}</span>
            {isMainCheckout ? (
              <span className="shrink-0 text-[11px] text-muted-foreground/50">(main)</span>
            ) : null}
          </Segment>
          {runTitle ? <Separator /> : null}
        </>
      ) : null}

      {runTitle ? (
        <Segment className="font-medium text-foreground" title={runTitle}>
          {runTitle}
        </Segment>
      ) : null}

      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </nav>
  )
}
