import { Check, ChevronDown, Copy, FolderGit2, GitBranch, Plus, Search } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { truncateBranchLabel, truncateNavTitle } from '../../lib/truncateLabel.ts'

export type NavigationMenuProps = {
  label: string
  title: string
  icon: ReactNode
  disabled?: boolean
  muted?: boolean
  trailing?: ReactNode
  /** Widen the trigger past its content and cap it, for long free-text labels. */
  triggerClassName?: string
  /** Extra width for panels holding more than a short list. */
  panelClassName?: string
  /** Pinned above the scrolling list — a search field, typically. */
  header?: ReactNode
  /** Controlled open state, for menus with their own keyboard shortcut. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: (close: () => void) => ReactNode
}

/**
 * The one dropdown shell every breadcrumb picker renders through: same trigger
 * chrome, same panel chrome, same dismissal rules. Content differs; the frame
 * does not.
 */
export function NavigationMenu({
  label,
  title,
  icon,
  disabled,
  muted,
  trailing,
  triggerClassName = '',
  panelClassName = 'min-w-56',
  header,
  open: openProp,
  onOpenChange,
  children,
}: NavigationMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = openProp ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
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
        onClick={() => setOpen(!open)}
        className={`flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-md px-1 py-0.5 transition-colors hover:bg-[var(--bg-luminous-quaternary)] disabled:opacity-40 ${
          muted ? 'text-muted-foreground' : 'font-medium text-foreground'
        } ${triggerClassName}`}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute left-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-border bg-elevated p-1 shadow-xl shadow-black/40 ${panelClassName}`}
        >
          {header}
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}

/** Section label inside a navigation panel. */
export function NavigationSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
}

export function NavigationItem({
  label,
  hint,
  icon,
  active,
  disabled,
  unread,
  reserveTrailing,
  meta,
  onSelect,
  onClick,
}: {
  label: string
  hint?: string
  icon: ReactNode
  active?: boolean
  disabled?: boolean
  unread?: boolean
  /**
   * Hand the trailing slot to the parent: it reserves the space and renders the
   * check itself, so the tick and a hover action can share one fixed position.
   */
  reserveTrailing?: boolean
  /** Right-aligned secondary text, before the unread dot and the check. */
  meta?: ReactNode
  onSelect: () => void
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={hint ?? label}
      onClick={onClick ?? onSelect}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${reserveTrailing ? 'pr-8' : ''} ${
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
      {meta}
      {unread ? (
        <span
          role="img"
          aria-label="New activity"
          className="size-1.5 shrink-0 rounded-full bg-accent"
        />
      ) : null}
      {active && !reserveTrailing ? (
        <Check className="size-3.5 shrink-0" aria-hidden="true" />
      ) : null}
    </button>
  )
}

/** Search field styled to sit at the top of a navigation panel. */
export function NavigationSearch({
  value,
  onChange,
  placeholder,
  ariaLabel,
  shortcut,
  inputRef,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
  shortcut?: string
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  return (
    <div className="relative px-1 pb-1 pt-0.5">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`h-7 w-full rounded-lg bg-secondary/60 pl-8 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:bg-secondary ${
          shortcut ? 'pr-9' : 'pr-2.5'
        }`}
      />
      {shortcut ? (
        <kbd className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/60">
          {shortcut}
        </kbd>
      ) : null}
    </div>
  )
}

export type NavigationProject = { id: string; name: string; path?: string; defaultBranch?: string }

export function NavigationProjectPicker({
  projects,
  projectId,
  disabled,
  muted,
  onChange,
  onAddProject,
}: {
  projects: NavigationProject[]
  projectId: string
  disabled?: boolean
  muted?: boolean
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
      muted={muted}
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
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selected = workspaces.find((workspace) => workspace.id === workspaceId)
  const visible = expanded ? workspaces : workspaces.slice(0, PAGE_SIZE)

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    [],
  )

  const copyBranch = async (workspace: NavigationWorkspace) => {
    try {
      await navigator.clipboard.writeText(workspace.branch)
      setCopiedId(workspace.id)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopiedId(null), 1000)
    } catch {
      // Clipboard access may be unavailable in an insecure browser context.
    }
  }
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
          <NavigationSectionLabel>Workspaces</NavigationSectionLabel>
          {visible.map((workspace) => (
            <div key={workspace.id} className="relative">
              <NavigationItem
                label={workspace.branch}
                hint={workspace.kind === 'main' ? 'main' : undefined}
                icon={<GitBranch className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />}
                active={workspace.id === workspaceId}
                disabled={busyId === workspace.id}
                unread={unreadIds.has(workspace.id)}
                reserveTrailing
                onSelect={() => {
                  onChange(workspace.id)
                  close()
                }}
              />
              <span className="group/trailing absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center">
                {workspace.id === workspaceId ? (
                  <Check
                    aria-hidden="true"
                    className="pointer-events-none col-start-1 row-start-1 size-3.5 transition-opacity group-hover/trailing:opacity-0"
                  />
                ) : null}
                <button
                  type="button"
                  aria-label={
                    copiedId === workspace.id
                      ? `Copied branch ${workspace.branch}`
                      : `Copy branch ${workspace.branch}`
                  }
                  title={copiedId === workspace.id ? 'Copied' : 'Copy branch name'}
                  onClick={() => void copyBranch(workspace)}
                  className={`col-start-1 row-start-1 flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-hover/trailing:opacity-100 focus-visible:opacity-100 ${
                    copiedId === workspace.id
                      ? 'text-success hover:text-success'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {copiedId === workspace.id ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                </button>
              </span>
            </div>
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
