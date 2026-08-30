import { Check, ChevronDown, FolderGit2, GitBranch, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { truncateBranchLabel, truncateNavTitle } from '../../lib/truncateLabel.ts'

type NavigationMenuProps = {
  label: string
  title: string
  icon: ReactNode
  disabled?: boolean
  muted?: boolean
  trailing?: ReactNode
  children: (close: () => void) => ReactNode
}

function NavigationMenu({
  label,
  title,
  icon,
  disabled,
  muted,
  trailing,
  children,
}: NavigationMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        title={title}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-md px-1 py-0.5 transition-colors hover:bg-[var(--bg-luminous-quaternary)] disabled:opacity-40 ${
          muted ? 'text-muted-foreground' : 'font-medium text-foreground'
        }`}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1.5 min-w-56 overflow-hidden rounded-xl border border-border bg-elevated p-1 shadow-xl shadow-black/40"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}

function NavigationItem({
  label,
  hint,
  icon,
  active,
  disabled,
  unread,
  onSelect,
}: {
  label: string
  hint?: string
  icon: ReactNode
  active?: boolean
  disabled?: boolean
  unread?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={hint ?? label}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? 'bg-secondary text-foreground' : 'text-foreground/85 hover:bg-secondary/70'
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] leading-tight">{label}</span>
        {hint ? (
          <span className="block truncate text-[10px] leading-tight text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
      {unread ? (
        <span
          role="img"
          aria-label="New activity"
          className="size-1.5 shrink-0 rounded-full bg-accent"
        />
      ) : null}
      {active ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
    </button>
  )
}

export type NavigationProject = { id: string; name: string; path?: string; defaultBranch?: string }

export function NavigationProjectPicker({
  projects,
  projectId,
  disabled,
  onChange,
  onAddProject,
}: {
  projects: NavigationProject[]
  projectId: string
  disabled?: boolean
  onChange: (id: string) => void
  onAddProject?: () => void
}) {
  const selected = projects.find((project) => project.id === projectId)
  return (
    <NavigationMenu
      label={truncateNavTitle(selected?.name ?? 'Select repository', 22)}
      title={selected?.path ?? selected?.name ?? 'Select repository'}
      icon={<FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
      disabled={disabled}
    >
      {(close) => (
        <>
          {projects.map((project) => (
            <NavigationItem
              key={project.id}
              label={project.name}
              hint={project.defaultBranch ?? project.path}
              icon={<FolderGit2 className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />}
              active={project.id === projectId}
              onSelect={() => {
                onChange(project.id)
                close()
              }}
            />
          ))}
          {onAddProject ? (
            <NavigationItem
              label="Add project"
              icon={<Plus className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />}
              onSelect={() => {
                close()
                onAddProject()
              }}
            />
          ) : null}
        </>
      )}
    </NavigationMenu>
  )
}

export type NavigationWorkspace = {
  id: string
  branch: string
  kind?: string
}

const PAGE_SIZE = 5

export function NavigationWorkspacePicker({
  workspaces,
  workspaceId,
  disabled,
  muted,
  busyId,
  unreadIds,
  onChange,
  onRequestNewBranch,
}: {
  workspaces: NavigationWorkspace[]
  workspaceId: string
  disabled?: boolean
  muted?: boolean
  busyId?: string | null
  unreadIds: ReadonlySet<string>
  onChange: (id: string) => void
  onRequestNewBranch?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const selected = workspaces.find((workspace) => workspace.id === workspaceId)
  const visible = expanded ? workspaces : workspaces.slice(0, PAGE_SIZE)
  return (
    <NavigationMenu
      label={truncateBranchLabel(selected?.branch ?? 'Select branch')}
      title={selected?.branch ?? 'Select branch'}
      icon={<GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
      disabled={disabled}
      muted={muted}
      trailing={
        <>
          {selected && unreadIds.has(selected.id) ? (
            <span
              role="img"
              aria-label="New activity in this worktree"
              className="size-1.5 shrink-0 rounded-full bg-accent"
            />
          ) : null}
          {selected?.kind === 'main' ? (
            <span className="shrink-0 text-[11px] text-muted-foreground/50">(main)</span>
          ) : null}
        </>
      }
    >
      {(close) => (
        <>
          <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Workspaces
          </div>
          {visible.map((workspace) => (
            <NavigationItem
              key={workspace.id}
              label={workspace.branch}
              hint={workspace.kind === 'main' ? 'main' : undefined}
              icon={<GitBranch className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />}
              active={workspace.id === workspaceId}
              disabled={busyId === workspace.id}
              unread={unreadIds.has(workspace.id)}
              onSelect={() => {
                onChange(workspace.id)
                close()
              }}
            />
          ))}
          {workspaces.length > PAGE_SIZE ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => setExpanded((value) => !value)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
            >
              {expanded ? 'Show fewer' : 'More workspaces'}
              <ChevronDown
                className={`size-3.5 ${expanded ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          ) : null}
          {onRequestNewBranch ? (
            <NavigationItem
              label="New branch…"
              icon={<Plus className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />}
              onSelect={() => {
                close()
                onRequestNewBranch()
              }}
            />
          ) : null}
        </>
      )}
    </NavigationMenu>
  )
}
