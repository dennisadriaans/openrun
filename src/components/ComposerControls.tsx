/**
 * Composer footer model, effort, access-mode, and runtime pickers.
 *
 * Layout adapted from the t3code chat composer footer (MIT, T3 Tools Inc.).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useClickOutside } from '../hooks/useClickOutside'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FolderGit2,
  GitBranch,
  Lock,
  LockOpen,
  PenLine,
  Plus,
} from 'lucide-react'
import {
  defaultEffort,
  effortLabel,
  findModel,
  hiddenModelsIn,
  modelKindForBin,
  toggleHiddenModel,
  visibleModels,
  type ModelOption,
} from '../lib/models'
import { usePickerPrefs } from '../lib/pickerPrefs'
import { truncateBranchLabel, truncateNavTitle } from '../lib/truncateLabel'
import {
  hiddenRuntimesIn,
  installedRuntimes,
  toggleHiddenRuntime,
  visibleRuntimes,
} from '../lib/pickRuntime'
import {
  DEFAULT_RUNTIME_MODE,
  RUNTIME_MODES,
  runtimeModeLabel,
  type RuntimeMode,
} from '../lib/runtimeMode'
import { ProviderIcon } from './ProviderIcons'
import { Tooltip } from './ui'

export type RuntimeOption = {
  id: string
  label: string
  bin: string
  description?: string
  /** False / missing means the binary is not on PATH. */
  installed?: boolean
  /** 'cli' or 'acp' — decides whether Supervised is offered. */
  transport?: string
  /** Discovered catalog, when the caller has one; falls back to the seed. */
  models?: ModelOption[]
}

export function FooterMenu({
  label,
  title,
  tooltip,
  disabled,
  leading,
  trailing,
  align = 'start',
  size = 'default',
  muted,
  invalid,
  'aria-describedby': ariaDescribedBy,
  onOpen,
  children,
}: {
  label: string
  title?: string
  tooltip?: string
  disabled?: boolean
  leading?: ReactNode
  trailing?: ReactNode
  align?: 'start' | 'end'
  size?: 'default' | 'compact'
  muted?: boolean
  invalid?: boolean
  'aria-describedby'?: string
  onOpen?: () => void
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [coords, setCoords] = useState<{
    top: number
    left: number
    openUp: boolean
    maxHeight: number
  } | null>(null)

  useClickOutside(open, () => setOpen(false), [triggerRef, menuRef])

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setCoords(null)
      return
    }
    const update = () => {
      const button = buttonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      const menuWidth = menuRef.current?.offsetWidth ?? 224
      const menuHeight = menuRef.current?.scrollHeight ?? 260
      const spaceBelow = window.innerHeight - rect.bottom
      const openUp = spaceBelow < menuHeight + 12 && rect.top > spaceBelow
      const maxHeight = Math.max(120, (openUp ? rect.top : spaceBelow) - 14)
      const left =
        align === 'end'
          ? Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8))
          : Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8))
      setCoords({
        top: openUp ? rect.top - 6 : rect.bottom + 6,
        left,
        openUp,
        maxHeight,
      })
    }
    update()
    const raf = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, align])

  const compact = size === 'compact'
  const trigger = (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      title={tooltip ? undefined : title}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-invalid={invalid || undefined}
      aria-describedby={ariaDescribedBy}
      onClick={() => {
        if (!open) onOpen?.()
        setOpen((v) => !v)
      }}
      className={
        compact
          ? `flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-md px-1 py-0.5 transition-colors hover:bg-[var(--bg-luminous-quaternary)] disabled:opacity-40 ${
              invalid
                ? 'text-rose-300'
                : muted
                  ? 'text-muted-foreground'
                  : 'font-medium text-foreground'
            }`
          : `inline-flex h-8 max-w-52 min-w-0 items-center gap-2 truncate rounded-lg px-2.5 text-ui-base transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40 sm:max-w-60 ${
              invalid
                ? 'text-rose-300 hover:text-rose-200'
                : 'text-tier-tertiary hover:text-tier-secondary'
            }`
      }
    >
      {leading}
      <span className={compact ? 'mono min-w-0 flex-1 truncate' : 'truncate'}>{label}</span>
      {trailing}
      <ChevronDown
        className={
          compact
            ? 'h-3 w-3 shrink-0 text-muted-foreground/60'
            : 'h-3.5 w-3.5 shrink-0 text-tier-quaternary'
        }
        aria-hidden="true"
      />
    </button>
  )

  return (
    <div ref={triggerRef} className="relative min-w-0">
      {tooltip ? (
        <Tooltip content={tooltip} disabled={open} placement="bottom">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{
                position: 'fixed',
                left: coords?.left ?? 0,
                ...(coords?.openUp
                  ? { bottom: window.innerHeight - (coords?.top ?? 0) }
                  : { top: coords?.top ?? 0 }),
                zIndex: 400,
                maxHeight: coords?.maxHeight,
                visibility: coords ? 'visible' : 'hidden',
              }}
              className="min-w-52 overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-border bg-elevated p-1 shadow-xl shadow-black/40"
            >
              {children(() => setOpen(false))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export function MenuItem({
  active,
  disabled,
  label,
  hint,
  leading,
  onSelect,
}: {
  active?: boolean
  disabled?: boolean
  label: string
  hint?: string
  leading?: ReactNode
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={disabled ? hint : undefined}
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ui-base transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'bg-hover text-foreground'
          : 'text-foreground/85 hover:bg-hover hover:text-foreground'
      }`}
    >
      {leading ? <span className="shrink-0 text-tier-secondary">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint ? (
          <span className="block truncate text-ui-sm text-tier-quaternary">{hint}</span>
        ) : null}
      </span>
      {active ? <Check className="h-3.5 w-3.5 shrink-0 text-tier-secondary" /> : null}
    </button>
  )
}

const MENU_LIST_EXPAND_TOGGLE_CLASS =
  'flex w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-ui-sm text-tier-tertiary transition-colors hover:bg-hover hover:text-foreground'

/** Expand a truncated menu list to show all rows, or collapse back to the first page. */
export function MenuListExpandToggle({
  totalCount,
  visibleCount,
  pageSize,
  expandLabel,
  onVisibleCountChange,
  className = MENU_LIST_EXPAND_TOGGLE_CLASS,
}: {
  totalCount: number
  visibleCount: number
  pageSize: number
  expandLabel: string
  onVisibleCountChange: (count: number) => void
  className?: string
}) {
  const hasHidden = visibleCount < totalCount
  const isExpanded = visibleCount > pageSize
  if (totalCount <= pageSize || (!hasHidden && !isExpanded)) return null

  return (
    <button
      type="button"
      role="menuitem"
      aria-label={hasHidden ? expandLabel : 'Show fewer'}
      onClick={() => onVisibleCountChange(hasHidden ? totalCount : pageSize)}
      className={className}
    >
      {hasHidden ? (
        <>
          {expandLabel}
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </>
      ) : (
        <>
          Show fewer
          <ChevronDown className="h-3.5 w-3.5 shrink-0 rotate-180" aria-hidden="true" />
        </>
      )}
    </button>
  )
}

/**
 * A picker row with its own hide / unhide control.
 *
 * Separate from {@link MenuItem} because the toggle has to be a real button
 * beside the row rather than inside it — nesting buttons is invalid, and the
 * two need different click targets so hiding an item never selects it.
 */
function HideableMenuItem({
  label,
  hint,
  leading,
  active,
  hidden,
  hideTitle,
  showTitle,
  onSelect,
  onToggleHidden,
}: {
  label: string
  hint?: string
  leading?: ReactNode
  active: boolean
  hidden: boolean
  hideTitle: string
  showTitle: string
  onSelect: () => void
  onToggleHidden: () => void
}) {
  return (
    <div className="group/model relative flex items-center">
      <button
        type="button"
        role="menuitem"
        onClick={onSelect}
        className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 pr-9 pl-2.5 text-left text-ui-base transition-colors ${
          active
            ? 'bg-hover text-foreground'
            : 'text-foreground/85 hover:bg-hover hover:text-foreground'
        } ${hidden ? 'opacity-50' : ''}`}
      >
        {leading ? <span className="shrink-0 text-tier-secondary">{leading}</span> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{label}</span>
          {hint ? (
            <span className="block truncate text-ui-sm text-tier-quaternary">{hint}</span>
          ) : null}
        </span>
        {active ? <Check className="h-3.5 w-3.5 shrink-0 text-tier-secondary" /> : null}
      </button>
      <button
        type="button"
        title={hidden ? showTitle : hideTitle}
        aria-label={hidden ? showTitle : hideTitle}
        onClick={onToggleHidden}
        className="absolute right-1 rounded-md p-1.5 text-tier-quaternary opacity-0 transition-colors group-hover/model:opacity-100 hover:bg-hover hover:text-foreground focus-visible:opacity-100"
      >
        {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

function ModelMenuItem({
  model,
  active,
  hidden,
  onSelect,
  onToggleHidden,
}: {
  model: ModelOption
  active: boolean
  hidden: boolean
  onSelect: () => void
  onToggleHidden: () => void
}) {
  return (
    <HideableMenuItem
      label={model.name}
      hint={model.slug}
      leading={<ProviderIcon kind={model.provider} className="h-3.5 w-3.5 shrink-0" />}
      active={active}
      hidden={hidden}
      hideTitle={`Hide ${model.name} from this list`}
      showTitle={`Show ${model.name} again`}
      onSelect={onSelect}
      onToggleHidden={onToggleHidden}
    />
  )
}

function modeIcon(mode: RuntimeMode) {
  if (mode === 'approval-required') return <Lock className="h-3.5 w-3.5 shrink-0" />
  if (mode === 'auto-accept-edits') return <PenLine className="h-3.5 w-3.5 shrink-0" />
  return <LockOpen className="h-3.5 w-3.5 shrink-0" />
}

export function ModelPicker({
  models,
  model,
  disabled,
  onChange,
}: {
  models: ModelOption[]
  model: string
  disabled?: boolean
  onChange: (slug: string) => void
}) {
  const { prefs, remember } = usePickerPrefs()
  const [showHidden, setShowHidden] = useState(false)

  if (models.length === 0) return null
  const selected = findModel(models, model) ?? models[0]!
  const shown = visibleModels(models, prefs.hiddenModels, selected.slug)
  const hidden = hiddenModelsIn(models, prefs.hiddenModels, selected.slug)
  const toggleHidden = (slug: string) =>
    remember({ hiddenModels: toggleHiddenModel(prefs.hiddenModels, slug) })

  return (
    <FooterMenu
      label={selected.shortName}
      title={selected.name}
      disabled={disabled}
      leading={<ProviderIcon kind={selected.provider} className="h-3.5 w-3.5 shrink-0" />}
    >
      {(close) => (
        <>
          {(showHidden ? models : shown).map((m) => (
            <ModelMenuItem
              key={m.slug}
              model={m}
              active={m.slug === selected.slug}
              hidden={hidden.some((h) => h.slug === m.slug)}
              onSelect={() => {
                onChange(m.slug)
                close()
              }}
              onToggleHidden={() => toggleHidden(m.slug)}
            />
          ))}
          {hidden.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="mt-1 flex w-full items-center gap-2 border-t border-border px-2.5 pt-2 pb-1 text-left text-ui-sm text-tier-quaternary transition-colors hover:text-tier-secondary"
            >
              {showHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {showHidden ? 'Hide hidden models' : `${hidden.length} hidden`}
            </button>
          ) : null}
        </>
      )}
    </FooterMenu>
  )
}

export function EffortPicker({
  models,
  model,
  effort,
  disabled,
  onChange,
}: {
  models: ModelOption[]
  model: string
  effort: string
  disabled?: boolean
  onChange: (effort: string) => void
}) {
  const selected = findModel(models, model) ?? models[0]
  if (!selected) return null
  if (selected.efforts.length === 0) return null

  const current = effort || defaultEffort(selected)
  const label = effortLabel(selected, current) || 'Reasoning'

  return (
    <FooterMenu label={label} title="Reasoning" disabled={disabled}>
      {(close) =>
        selected.efforts.map((opt) => (
          <MenuItem
            key={opt.value}
            active={opt.value === current}
            label={opt.label}
            hint={opt.promptInjected ? 'Injected into prompt' : undefined}
            onSelect={() => {
              onChange(opt.value)
              close()
            }}
          />
        ))
      }
    </FooterMenu>
  )
}

export type ProjectOption = {
  id: string
  name: string
  path?: string
  defaultBranch?: string
}

export function ProjectPicker({
  projects,
  projectId,
  disabled,
  invalid,
  appearance = 'composer',
  'aria-describedby': ariaDescribedBy,
  placeholder = 'Select repository',
  onChange,
  onAddProject,
}: {
  projects: ProjectOption[]
  projectId: string
  disabled?: boolean
  invalid?: boolean
  appearance?: 'composer' | 'nav'
  'aria-describedby'?: string
  placeholder?: string
  onChange: (id: string) => void
  /** Opens add-project flow. Shown when the list is empty, and as a trailing action when not. */
  onAddProject?: () => void
}) {
  const selected = projects.find((p) => p.id === projectId)
  const nav = appearance === 'nav'

  return (
    <FooterMenu
      label={truncateNavTitle(selected?.name ?? placeholder, 22)}
      title={selected?.path || selected?.name || placeholder}
      tooltip={nav ? undefined : 'Git repo to work in'}
      disabled={disabled}
      invalid={invalid}
      size={nav ? 'compact' : 'default'}
      aria-describedby={ariaDescribedBy}
      leading={<FolderGit2 className="h-3.5 w-3.5 shrink-0" />}
    >
      {(close) => (
        <>
          {projects.length === 0 ? (
            onAddProject ? (
              <MenuItem
                label="Add project"
                hint="Pick a local git repo folder"
                leading={<Plus className="h-3.5 w-3.5 shrink-0" />}
                onSelect={() => {
                  close()
                  onAddProject()
                }}
              />
            ) : (
              <div className="px-2.5 py-2 text-ui-base text-tier-quaternary">
                No repositories yet
              </div>
            )
          ) : (
            projects.map((p) => (
              <MenuItem
                key={p.id}
                active={p.id === projectId}
                label={p.name}
                hint={p.defaultBranch || p.path}
                leading={<FolderGit2 className="h-3.5 w-3.5 shrink-0" />}
                onSelect={() => {
                  onChange(p.id)
                  close()
                }}
              />
            ))
          )}
          {projects.length > 0 && onAddProject ? (
            <MenuItem
              label="Add project"
              leading={<Plus className="h-3.5 w-3.5 shrink-0" />}
              onSelect={() => {
                close()
                onAddProject()
              }}
            />
          ) : null}
        </>
      )}
    </FooterMenu>
  )
}

export type BranchOption = {
  id: string
  branch: string
  action?: 'select-workspace' | 'create-workspace'
  kind?: string
  status?: string
  /** Disables the entry and shows as the hint — e.g. a workspace still cloning. */
  blockedReason?: string | null
  hint?: string
}

const BRANCH_PAGE_SIZE = 5

function UnreadDot({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="size-1.5 shrink-0 rounded-full bg-accent"
    />
  )
}

function CompactBranchItem({
  option,
  active,
  disabled,
  unread,
  onSelect,
}: {
  option: BranchOption
  active: boolean
  disabled?: boolean
  unread?: boolean
  onSelect: () => void
}) {
  const sublabel = option.blockedReason ?? (option.kind === 'main' ? 'main' : undefined)
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={option.blockedReason ?? option.branch}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? 'bg-secondary text-foreground' : 'text-foreground/85 hover:bg-secondary/70'
      }`}
    >
      {option.action === 'create-workspace' ? (
        <Plus className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
      ) : (
        <GitBranch className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate mono text-[12.5px] leading-tight">{option.branch}</span>
        {sublabel ? (
          <span className="block truncate text-[10px] leading-tight text-muted-foreground">
            {sublabel}
          </span>
        ) : null}
      </span>
      {unread ? <UnreadDot label="New activity" /> : null}
      {active ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
    </button>
  )
}

export function BranchPicker({
  workspaces,
  workspaceId,
  disabled,
  disabledReason,
  busyLabel,
  busyId,
  invalid,
  muted,
  appearance = 'composer',
  unreadIds,
  'aria-describedby': ariaDescribedBy,
  placeholder = 'Select branch',
  newBranchLabel = 'New branch…',
  onChange,
  onRequestNewBranch,
}: {
  workspaces: BranchOption[]
  workspaceId: string
  disabled?: boolean
  disabledReason?: string
  busyLabel?: string
  busyId?: string | null
  invalid?: boolean
  muted?: boolean
  appearance?: 'composer' | 'nav'
  unreadIds?: ReadonlySet<string>
  'aria-describedby'?: string
  placeholder?: string
  newBranchLabel?: string
  onChange: (id: string) => void
  onRequestNewBranch?: () => void
}) {
  const selected = workspaces.find((w) => w.id === workspaceId)
  const [visibleWorkspaceCount, setVisibleWorkspaceCount] = useState(BRANCH_PAGE_SIZE)
  const [visibleBranchCount, setVisibleBranchCount] = useState(BRANCH_PAGE_SIZE)
  const compact = appearance === 'nav'
  const existing = workspaces.filter((w) => w.action !== 'create-workspace')
  const unopened = compact ? [] : workspaces.filter((w) => w.action === 'create-workspace')
  const visibleWorkspaces = existing.slice(0, visibleWorkspaceCount)
  const visibleBranches = unopened.slice(0, visibleBranchCount)
  const headingClass = compact
    ? 'px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground'
    : 'px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-tier-quaternary'
  const expandClass = compact
    ? 'flex w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground'
    : undefined

  return (
    <FooterMenu
      label={truncateBranchLabel(busyLabel ?? selected?.branch ?? placeholder)}
      title={selected?.blockedReason ?? disabledReason ?? selected?.branch ?? placeholder}
      tooltip={
        compact ? undefined : (selected?.blockedReason ?? disabledReason ?? 'Workspace and branch')
      }
      disabled={disabled}
      invalid={invalid || Boolean(selected?.blockedReason)}
      muted={muted}
      size={compact ? 'compact' : 'default'}
      aria-describedby={ariaDescribedBy}
      leading={
        <GitBranch
          aria-hidden="true"
          className={
            compact ? 'h-3.5 w-3.5 shrink-0 text-muted-foreground/60' : 'h-3.5 w-3.5 shrink-0'
          }
        />
      }
      trailing={
        compact ? (
          <>
            {selected && unreadIds?.has(selected.id) ? (
              <UnreadDot label="New activity in this worktree" />
            ) : null}
            {selected?.kind === 'main' ? (
              <span className="shrink-0 text-[11px] text-muted-foreground/50">(main)</span>
            ) : null}
          </>
        ) : undefined
      }
      onOpen={() => {
        setVisibleWorkspaceCount(BRANCH_PAGE_SIZE)
        setVisibleBranchCount(BRANCH_PAGE_SIZE)
      }}
    >
      {(close) => (
        <>
          {existing.length === 0 && unopened.length === 0 ? (
            <div className="px-2.5 py-2 text-ui-base text-tier-quaternary">No branches yet</div>
          ) : null}
          {existing.length > 0 ? <div className={headingClass}>Workspaces</div> : null}
          {visibleWorkspaces.map((w) =>
            compact ? (
              <CompactBranchItem
                key={w.id}
                option={w}
                active={w.id === workspaceId}
                disabled={Boolean(w.blockedReason) || busyId === w.id}
                unread={unreadIds?.has(w.id)}
                onSelect={() => {
                  onChange(w.id)
                  close()
                }}
              />
            ) : (
              <MenuItem
                key={w.id}
                active={w.id === workspaceId}
                disabled={Boolean(w.blockedReason)}
                label={w.branch}
                hint={w.blockedReason ?? w.hint}
                leading={<GitBranch aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                onSelect={() => {
                  onChange(w.id)
                  close()
                }}
              />
            ),
          )}
          <MenuListExpandToggle
            totalCount={existing.length}
            visibleCount={visibleWorkspaceCount}
            pageSize={BRANCH_PAGE_SIZE}
            expandLabel="More workspaces"
            onVisibleCountChange={setVisibleWorkspaceCount}
            {...(expandClass ? { className: expandClass } : {})}
          />
          {unopened.length > 0 ? (
            <div className="mt-1 border-t border-border px-2.5 pt-2 pb-1.5 text-[10px] uppercase tracking-wide text-tier-quaternary">
              Open Branch in New Workspace
            </div>
          ) : null}
          {visibleBranches.map((w) => (
            <MenuItem
              key={w.id}
              label={w.branch}
              hint={w.hint}
              leading={<Plus aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
              onSelect={() => {
                onChange(w.id)
                close()
              }}
            />
          ))}
          <MenuListExpandToggle
            totalCount={unopened.length}
            visibleCount={visibleBranchCount}
            pageSize={BRANCH_PAGE_SIZE}
            expandLabel="More branches"
            onVisibleCountChange={setVisibleBranchCount}
          />
          {onRequestNewBranch ? (
            compact ? (
              <button
                type="button"
                onClick={() => {
                  close()
                  onRequestNewBranch()
                }}
                className="mt-0.5 flex w-full items-center gap-2 rounded-lg border-t border-border px-2.5 py-2 text-left text-sm text-foreground/85 hover:bg-secondary/70"
              >
                <Plus className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
                {newBranchLabel}
              </button>
            ) : (
              <MenuItem
                label={newBranchLabel}
                hint="Create a new branch in its own isolated workspace"
                leading={<Plus aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                onSelect={() => {
                  close()
                  onRequestNewBranch()
                }}
              />
            )
          ) : null}
        </>
      )}
    </FooterMenu>
  )
}

export function RuntimePicker({
  runtimes,
  runtimeId,
  disabled,
  align = 'end',
  onChange,
}: {
  runtimes: RuntimeOption[]
  runtimeId: string
  disabled?: boolean
  align?: 'start' | 'end'
  onChange: (id: string) => void
}) {
  const { prefs, remember } = usePickerPrefs()
  const [showHidden, setShowHidden] = useState(false)

  if (runtimes.length === 0) return null
  const selected = runtimes.find((r) => r.id === runtimeId) ?? runtimes[0]!
  const present = installedRuntimes(runtimes, selected.id)
  const shown = visibleRuntimes(present, prefs.hiddenRuntimes, selected.id)
  const hidden = hiddenRuntimesIn(present, prefs.hiddenRuntimes, selected.id)
  const toggleHidden = (id: string) =>
    remember({ hiddenRuntimes: toggleHiddenRuntime(prefs.hiddenRuntimes, id) })

  return (
    <FooterMenu
      label={selected.label}
      title={selected.description || selected.label}
      disabled={disabled}
      align={align}
      leading={
        <ProviderIcon kind={modelKindForBin(selected.bin)} className="h-3.5 w-3.5 shrink-0" />
      }
    >
      {(close) => (
        <>
          {(showHidden ? present : shown).map((r) => (
            <HideableMenuItem
              key={r.id}
              label={r.label}
              hint={r.bin}
              leading={
                <ProviderIcon kind={modelKindForBin(r.bin)} className="h-3.5 w-3.5 shrink-0" />
              }
              active={r.id === selected.id}
              hidden={hidden.some((h) => h.id === r.id)}
              hideTitle={`Hide ${r.label} from this list`}
              showTitle={`Show ${r.label} again`}
              onSelect={() => {
                onChange(r.id)
                close()
              }}
              onToggleHidden={() => toggleHidden(r.id)}
            />
          ))}
          {hidden.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="mt-1 flex w-full items-center gap-2 border-t border-border px-2.5 pt-2 pb-1 text-left text-ui-sm text-tier-quaternary transition-colors hover:text-tier-secondary"
            >
              {showHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {showHidden ? 'Hide hidden runtimes' : `${hidden.length} hidden`}
            </button>
          ) : null}
        </>
      )}
    </FooterMenu>
  )
}

export function RuntimeModePicker({
  mode,
  disabled,
  onChange,
  supportsSupervised = false,
}: {
  mode: RuntimeMode
  disabled?: boolean
  onChange: (mode: RuntimeMode) => void
  /** Supervised approvals only work for Claude today. */
  supportsSupervised?: boolean
}) {
  const modes = supportsSupervised
    ? RUNTIME_MODES
    : RUNTIME_MODES.filter((m) => m.value !== 'approval-required')

  // If a stale supervised mode is loaded for a non-Claude runtime, show full-access.
  const effectiveMode =
    !supportsSupervised && mode === 'approval-required' ? DEFAULT_RUNTIME_MODE : mode

  return (
    <FooterMenu
      label={runtimeModeLabel(effectiveMode)}
      title="Access"
      disabled={disabled}
      leading={modeIcon(effectiveMode)}
    >
      {(close) =>
        modes.map((opt) => (
          <MenuItem
            key={opt.value}
            active={opt.value === effectiveMode}
            label={opt.label}
            hint={opt.description}
            leading={modeIcon(opt.value)}
            onSelect={() => {
              onChange(opt.value)
              close()
            }}
          />
        ))
      }
    </FooterMenu>
  )
}

export function ComposerModelControls({
  models,
  model,
  effort,
  runtimeMode,
  disabled,
  supportsSupervised = false,
  onModelChange,
  onEffortChange,
  onRuntimeModeChange,
}: {
  models: ModelOption[]
  model: string
  effort: string
  runtimeMode: RuntimeMode
  disabled?: boolean
  supportsSupervised?: boolean
  onModelChange: (slug: string) => void
  onEffortChange: (effort: string) => void
  onRuntimeModeChange: (mode: RuntimeMode) => void
}) {
  return (
    <div className="-m-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {models.length > 0 ? (
        <>
          <ModelPicker models={models} model={model} disabled={disabled} onChange={onModelChange} />
          <EffortPicker
            models={models}
            model={model}
            effort={effort}
            disabled={disabled}
            onChange={onEffortChange}
          />
        </>
      ) : null}
      <RuntimeModePicker
        mode={runtimeMode}
        disabled={disabled}
        supportsSupervised={supportsSupervised}
        onChange={onRuntimeModeChange}
      />
    </div>
  )
}
