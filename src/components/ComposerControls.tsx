/**
 * Composer footer model, effort, and runtime pickers.
 *
 * Layout adapted from the t3code chat composer footer (MIT, T3 Tools Inc.).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useClickOutside } from '../hooks/useClickOutside'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FolderGit2,
  GitBranch,
  Plus,
} from 'lucide-react'
import {
  defaultEffort,
  effortLabel,
  findModel,
  hiddenModelsIn,
  materializeHiddenModels,
  modelKindForBin,
  toggleHiddenModel,
  visibleModels,
  type ModelOption,
} from '../lib/models'
import { usePickerPrefs } from '../lib/pickerPrefs'
import { relativeTime } from '../lib/format'
import type { NativeSession, NativeSessionGroup } from '../lib/nativeSessions'
import { useNativeSessionPaging } from '../hooks/useNativeSessionPaging'
import { truncateBranchLabel, truncateNavTitle } from '../lib/truncateLabel'
import { groupThreadLensRuns, type ThreadLensRun } from '../lib/threadLens'
import { NavigationItem, NavigationSearch } from './workspace/NavigationPicker'
import {
  hiddenRuntimesIn,
  isAlwaysVisibleRuntime,
  toggleHiddenRuntime,
  visibleRuntimes,
} from '../lib/pickRuntime'
import { ProviderIcon } from './ProviderIcons'
import { Tooltip } from './ui'

export type RuntimeOption = {
  id: string
  label: string
  bin: string
  description?: string
  /** False / missing means the binary is not on PATH. */
  installed?: boolean
  transport?: string
  /** Discovered catalog, when the caller has one; falls back to the seed. */
  models?: ModelOption[]
}

/** Prefer the configured binary, then the stable built-in id for wrappers. */
function runtimeIconKind(runtime: RuntimeOption) {
  const fromBin = modelKindForBin(runtime.bin)
  return fromBin === 'generic' ? modelKindForBin(runtime.id) : fromBin
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
  initiallyOpen = false,
  keepOpen = false,
  outsideRefs,
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
  /** Open after hydration, used by static previews that showcase a picker. */
  initiallyOpen?: boolean
  /** Keep a preview menu visible while interacting with the rest of the page. */
  keepOpen?: boolean
  /** Portalled children (a submenu) that must not count as an outside click. */
  outsideRefs?: Array<RefObject<HTMLElement | null>>
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

  useEffect(() => {
    if (initiallyOpen) setOpen(true)
  }, [initiallyOpen])

  const close = () => {
    if (!keepOpen) setOpen(false)
  }

  useClickOutside(open, close, [triggerRef, menuRef, ...(outsideRefs ?? [])])

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
        if (!keepOpen) setOpen((v) => !v)
      }}
      className={
        compact
          ? `flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-md px-1 py-0.5 transition-colors hover:bg-[var(--bg-luminous-quaternary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-40 ${
              invalid
                ? 'text-rose-300'
                : muted
                  ? 'text-muted-foreground'
                  : 'font-medium text-foreground'
            }`
          : `inline-flex h-7 max-w-52 min-w-0 items-center gap-1.5 truncate rounded-md px-2 text-ui-sm transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40 sm:max-w-60 ${
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
              className="min-w-60 overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-border bg-elevated p-1.5 shadow-xl shadow-black/40"
            >
              {children(close)}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export function MenuItem({
  active,
  showActiveIndicator = true,
  disabled,
  label,
  hint,
  leading,
  onSelect,
}: {
  active?: boolean
  showActiveIndicator?: boolean
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
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ui-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50 ${
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
      {active && showActiveIndicator ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-tier-secondary" />
      ) : null}
    </button>
  )
}

const MENU_LIST_EXPAND_TOGGLE_CLASS =
  'flex w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-ui-sm text-tier-tertiary transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60'

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
 * two need different click targets so hiding an item never selects it. The
 * The main action and visibility action are separate buttons. Keeping the eye
 * visible makes model curation discoverable on touch and keyboard as well as
 * with a pointer; submenu and selected indicators no longer overlap it.
 */
function HideableMenuItem({
  label,
  hint,
  leading,
  active,
  disabled = false,
  hidden,
  hideTitle,
  showTitle,
  rowRef,
  submenuOpen,
  hasSubmenu,
  onPointerEnter,
  onPointerLeave,
  onSelect,
  onToggleHidden,
}: {
  label: string
  hint?: string
  leading?: ReactNode
  active: boolean
  disabled?: boolean
  hidden: boolean
  hideTitle: string
  showTitle: string
  rowRef?: (el: HTMLDivElement | null) => void
  submenuOpen?: boolean
  hasSubmenu?: boolean
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onSelect: () => void
  onToggleHidden: () => void
}) {
  return (
    <div
      ref={rowRef}
      className={`group/item flex items-center gap-0.5 rounded-lg ${
        active || submenuOpen ? 'bg-hover' : ''
      }`}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      <button
        type="button"
        role="menuitem"
        {...(hasSubmenu ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': submenuOpen } : {})}
        onFocus={onPointerEnter}
        onClick={onSelect}
        disabled={disabled}
        className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ui-base transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 ${
          active || submenuOpen ? 'text-foreground' : 'text-foreground/85 hover:text-foreground'
        } ${hidden ? 'opacity-55' : ''}`}
      >
        {leading ? (
          <span className="grid size-5 shrink-0 place-items-center">{leading}</span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{label}</span>
          {hint ? (
            <span className="block truncate text-ui-sm text-tier-quaternary">{hint}</span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        title={hidden ? showTitle : hideTitle}
        aria-label={hidden ? showTitle : hideTitle}
        onClick={onToggleHidden}
        className="group/action mr-0.5 flex size-8 shrink-0 items-center justify-center rounded-md text-tier-quaternary opacity-60 transition-[color,background-color,opacity] hover:bg-hover hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <ChevronRight
          aria-hidden="true"
          className="h-3.5 w-3.5 group-hover/action:hidden group-focus-visible/action:hidden"
        />
        {hidden ? (
          <Eye
            aria-hidden="true"
            className="hidden h-3.5 w-3.5 group-hover/action:block group-focus-visible/action:block"
          />
        ) : (
          <EyeOff
            aria-hidden="true"
            className="hidden h-3.5 w-3.5 group-hover/action:block group-focus-visible/action:block"
          />
        )}
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
  const explicitlyHidden = new Set(
    materializeHiddenModels(models, prefs.hiddenModels, selected.slug),
  )
  const toggleHidden = (slug: string) =>
    remember({
      hiddenModels: toggleHiddenModel(
        materializeHiddenModels(models, prefs.hiddenModels, selected.slug),
        slug,
      ),
    })

  return (
    <FooterMenu
      label={selected.shortName}
      title={selected.name}
      disabled={disabled}
      leading={<ProviderIcon kind={selected.provider} className="size-4 shrink-0" />}
    >
      {(close) => (
        <>
          {(showHidden ? models : shown).map((m) => (
            <ModelMenuItem
              key={m.slug}
              model={m}
              active={m.slug === selected.slug}
              hidden={explicitlyHidden.has(m.slug)}
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
              role="menuitem"
              onClick={() => setShowHidden((v) => !v)}
              className="mt-1 flex w-full items-center gap-2 border-t border-border px-2.5 pt-2.5 pb-1.5 text-left text-ui-sm text-tier-quaternary transition-colors hover:text-tier-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
            >
              {showHidden ? (
                <EyeOff aria-hidden="true" className="h-3 w-3" />
              ) : (
                <Eye aria-hidden="true" className="h-3 w-3" />
              )}
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

/**
 * A branch row whose trailing slot holds the selected tick and the copy action
 * in one fixed position — the tick shows while the row is idle, and hovering
 * that slot swaps in copy rather than pushing the tick aside. Same stacked-grid
 * arrangement the runtime and model rows use for their hide toggle.
 */
function CompactBranchItem({
  option,
  active,
  disabled,
  unread,
  copied,
  onSelect,
  onCopyBranch,
}: {
  option: BranchOption
  active: boolean
  disabled?: boolean
  unread?: boolean
  copied?: boolean
  onSelect: () => void
  onCopyBranch?: () => void
}) {
  const sublabel = option.blockedReason ?? (option.kind === 'main' ? 'main' : undefined)
  const showTrailing = Boolean(onCopyBranch) && option.action !== 'create-workspace'
  return (
    <div className="relative flex items-center">
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        title={option.blockedReason ?? option.branch}
        onClick={onSelect}
        className={`flex w-full min-w-0 items-center gap-2 rounded-lg py-1.5 pl-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          showTrailing ? 'pr-8' : 'pr-2.5'
        } ${active ? 'bg-secondary text-foreground' : 'text-foreground/85 hover:bg-secondary/70'}`}
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
        {active && !showTrailing ? (
          <Check className="size-3.5 shrink-0" aria-hidden="true" />
        ) : null}
      </button>
      {showTrailing ? (
        <span className="group/trailing absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center">
          {active ? (
            <Check
              aria-hidden="true"
              className="pointer-events-none col-start-1 row-start-1 size-3.5 transition-opacity group-hover/trailing:opacity-0"
            />
          ) : null}
          <button
            type="button"
            aria-label={copied ? `Copied branch ${option.branch}` : `Copy branch ${option.branch}`}
            title={copied ? 'Copied' : 'Copy branch name'}
            onClick={onCopyBranch}
            className={`col-start-1 row-start-1 flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-hover/trailing:opacity-100 focus-visible:opacity-100 ${
              copied
                ? 'text-success hover:text-success'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {copied ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
          </button>
        </span>
      ) : null}
    </div>
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
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    [],
  )

  const copyBranch = async (option: BranchOption) => {
    try {
      await navigator.clipboard.writeText(option.branch)
      setCopiedId(option.id)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopiedId(null), 1000)
    } catch {
      // Clipboard access may be unavailable in an insecure browser context.
    }
  }
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
                copied={copiedId === w.id}
                onSelect={() => {
                  onChange(w.id)
                  close()
                }}
                onCopyBranch={() => void copyBranch(w)}
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

/** Saved CLI chats for one runtime, opened from its row in the runtime picker. */
function RuntimeSessionSubmenu({
  group,
  anchor,
  submenuRef,
  resumeSessionId,
  loading,
  onHover,
  onLeave,
  onSelect,
  onLoadMore,
  conversations,
}: {
  group?: NativeSessionGroup
  conversations?: {
    runs: ThreadLensRun[]
    currentRunId: string
    workspaceId: string
    projectId: string
    onIntent?: (runId: string) => void
    onSelect: (runId: string) => unknown
  }
  anchor: HTMLElement | null
  submenuRef: RefObject<HTMLDivElement | null>
  resumeSessionId: string
  loading: boolean
  onHover: () => void
  onLeave: () => void
  onSelect: (session: NativeSession) => void
  onLoadMore: () => void
}) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const nativeSessions =
    group?.sessions.filter((session) => {
      const needle = query.trim().toLocaleLowerCase()
      return (
        !needle ||
        session.title.toLocaleLowerCase().includes(needle) ||
        session.projectName?.toLocaleLowerCase().includes(needle)
      )
    }) ?? []

  const conversationGroups = conversations
    ? groupThreadLensRuns(
        conversations.runs,
        { workspaceId: conversations.workspaceId, projectId: conversations.projectId },
        query,
      )
    : []

  useLayoutEffect(() => {
    if (!anchor) {
      setCoords(null)
      return
    }
    const update = () => {
      const rect = anchor.getBoundingClientRect()
      const width = 320
      const openLeft = window.innerWidth - rect.right < width + 8
      setCoords({
        top: Math.max(8, Math.min(rect.top, window.innerHeight - 240)),
        left: openLeft ? rect.left - width - 4 : rect.right + 4,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchor, group?.sessions.length, loading])

  useEffect(() => {
    if (coords) inputRef.current?.focus()
  }, [coords])

  return createPortal(
    <div
      ref={submenuRef}
      role="menu"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        position: 'fixed',
        top: coords?.top ?? 0,
        left: coords?.left ?? 0,
        zIndex: 401,
        visibility: coords ? 'visible' : 'hidden',
      }}
      className="max-h-[min(30rem,65vh)] w-80 overflow-auto rounded-xl border border-border bg-elevated p-1 shadow-xl shadow-black/40"
    >
      <div className="border-b border-border pb-1">
        <NavigationSearch
          value={query}
          onChange={setQuery}
          placeholder="Search conversations..."
          ariaLabel="Search conversations"
          inputRef={inputRef}
        />
      </div>
      {group && nativeSessions.length > 0 ? (
        nativeSessions.map((session) => (
          <NavigationItem
            key={`${session.workspaceId ?? ''}:${session.sessionId}`}
            active={session.sessionId === resumeSessionId}
            showActiveIndicator={false}
            label={session.title}
            hint={`${relativeTime(session.modifiedAt)}${
              session.messageCount
                ? ` · ${session.messageCount} message${session.messageCount === 1 ? '' : 's'}`
                : ''
            }${session.projectName ? ` · ${session.projectName}` : ''}`}
            icon={
              <ProviderIcon
                kind={modelKindForBin(group.bin || group.runtimeId)}
                className="size-3.5 shrink-0"
              />
            }
            onSelect={() => onSelect(session)}
          />
        ))
      ) : group && !conversations ? (
        <p className="px-2.5 py-2 text-ui-sm text-tier-quaternary">
          {query.trim() ? 'No conversations found' : `No ${group.label} chats yet.`}
        </p>
      ) : null}
      {conversations ? (
        <>
          {conversationGroups
            .flatMap((conversationGroup) => conversationGroup.runs)
            .map((run) => (
              <NavigationItem
                key={run.id}
                label={truncateNavTitle(run.chatTitle)}
                icon={
                  <ProviderIcon
                    kind={modelKindForBin(run.runtimeId)}
                    className="size-3.5 shrink-0"
                  />
                }
                active={run.id === conversations.currentRunId}
                showActiveIndicator={false}
                unread={run.unread}
                onPointerDown={() => conversations.onIntent?.(run.id)}
                onPointerEnter={() => conversations.onIntent?.(run.id)}
                onFocus={() => conversations.onIntent?.(run.id)}
                meta={
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {relativeTime(run.startedAt).replace(' ago', '')}
                  </span>
                }
                onSelect={() => conversations.onSelect(run.id)}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey) {
                    event.preventDefault()
                    window.open(
                      `/runs/${encodeURIComponent(run.id)}`,
                      '_blank',
                      'noopener,noreferrer',
                    )
                    return
                  }
                  conversations.onSelect(run.id)
                }}
              />
            ))}
          {conversationGroups.length === 0 && nativeSessions.length === 0 ? (
            <p className="px-2.5 py-2 text-ui-sm text-tier-quaternary">No conversations found</p>
          ) : null}
        </>
      ) : null}
      {group?.hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="flex w-full items-center justify-center rounded-lg px-2.5 py-2 text-ui-sm text-tier-tertiary transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>,
    document.body,
  )
}

export function RuntimePicker({
  runtimes,
  runtimeId,
  disabled,
  disableRuntimeSelection = false,
  align = 'end',
  initiallyOpen,
  keepOpen,
  sessions,
  conversations,
  onChange,
}: {
  runtimes: RuntimeOption[]
  runtimeId: string
  disabled?: boolean
  /** Keep child conversation links usable while runtime switching is unavailable. */
  disableRuntimeSelection?: boolean
  align?: 'start' | 'end'
  initiallyOpen?: boolean
  keepOpen?: boolean
  /** Adds a saved-chats submenu to every runtime that can resume one. */
  sessions?: {
    workspaceId: string
    groups: NativeSessionGroup[]
    resumeSessionId: string
    resumeSessionLabel: string
    onOpen?: () => unknown
    onSelectNew: () => void
    onSelect: (session: NativeSession, group: NativeSessionGroup) => void
  }
  conversations?: {
    runs: ThreadLensRun[]
    currentRunId: string
    workspaceId: string
    projectId: string
    onIntent?: (runId: string) => void
    onSelect: (runId: string) => unknown
  }
  onChange: (id: string) => void
}) {
  const { prefs, remember } = usePickerPrefs()
  const [showHidden, setShowHidden] = useState(false)
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const submenuRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { mergedGroups, loadingKind, loadMore } = useNativeSessionPaging(
    sessions?.workspaceId ?? '',
    sessions?.groups ?? [],
  )

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const openSubmenu = (id: string) => {
    clearCloseTimer()
    setOpenSubmenuId(id)
  }
  const deferCloseSubmenu = () => {
    clearCloseTimer()
    closeTimer.current = setTimeout(() => setOpenSubmenuId(null), 160)
  }
  useEffect(() => () => clearCloseTimer(), [])

  if (runtimes.length === 0) return null
  const selected = runtimes.find((r) => r.id === runtimeId) ?? runtimes[0]!
  const present = runtimes
  const shown = visibleRuntimes(present, prefs.hiddenRuntimes, selected.id)
  const hidden = hiddenRuntimesIn(present, prefs.hiddenRuntimes, selected.id)
  const explicitlyHidden = new Set(prefs.hiddenRuntimes ?? [])
  const toggleHidden = (id: string) =>
    remember({ hiddenRuntimes: toggleHiddenRuntime(prefs.hiddenRuntimes, id) })

  const groupFor = (id: string) => mergedGroups.find((g) => g.runtimeId === id)
  const openRuntime = openSubmenuId ? runtimes.find((r) => r.id === openSubmenuId) : undefined
  const openGroup = openSubmenuId ? groupFor(openSubmenuId) : undefined
  const conversationsFor = (id: string) =>
    conversations?.runs.filter((run) => run.runtimeId === id) ?? []
  const resumeLabel =
    sessions?.resumeSessionId &&
    groupFor(selected.id)?.sessions.find((s) => s.sessionId === sessions.resumeSessionId)?.title

  return (
    <FooterMenu
      label={resumeLabel || selected.label}
      title={
        resumeLabel ? `${selected.label} · ${resumeLabel}` : selected.description || selected.label
      }
      disabled={disabled}
      align={align}
      initiallyOpen={initiallyOpen}
      keepOpen={keepOpen}
      outsideRefs={[submenuRef]}
      onOpen={() => void sessions?.onOpen?.()}
      leading={<ProviderIcon kind={runtimeIconKind(selected)} className="size-4 shrink-0" />}
    >
      {(close) => (
        <>
          {(showHidden ? present : shown).map((r) => {
            const group = groupFor(r.id)
            const runtimeConversations = conversationsFor(r.id)
            const hasChildren = Boolean(group) || runtimeConversations.length > 0
            return (
              <HideableMenuItem
                key={r.id}
                label={r.label}
                hint={r.bin}
                leading={<ProviderIcon kind={runtimeIconKind(r)} className="size-4 shrink-0" />}
                active={r.id === selected.id}
                disabled={disableRuntimeSelection}
                hidden={explicitlyHidden.has(r.id) && !isAlwaysVisibleRuntime(r.id)}
                hideTitle={
                  isAlwaysVisibleRuntime(r.id)
                    ? `${r.label} is always shown`
                    : `Hide ${r.label} from this list`
                }
                showTitle={`Show ${r.label} again`}
                rowRef={(el) => {
                  rowRefs.current[r.id] = el
                }}
                {...(hasChildren
                  ? {
                      hasSubmenu: true,
                      submenuOpen: openSubmenuId === r.id,
                      onPointerEnter: () => openSubmenu(r.id),
                      onPointerLeave: deferCloseSubmenu,
                    }
                  : { onPointerEnter: deferCloseSubmenu })}
                onSelect={() => {
                  onChange(r.id)
                  sessions?.onSelectNew()
                  close()
                }}
                onToggleHidden={() => toggleHidden(r.id)}
              />
            )
          })}
          {hidden.length > 0 ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => setShowHidden((v) => !v)}
              className="mt-1 flex w-full items-center gap-2 border-t border-border px-2.5 pt-2.5 pb-1.5 text-left text-ui-sm text-tier-quaternary transition-colors hover:text-tier-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
            >
              {showHidden ? (
                <EyeOff aria-hidden="true" className="h-3 w-3" />
              ) : (
                <Eye aria-hidden="true" className="h-3 w-3" />
              )}
              {showHidden ? 'Hide hidden runtimes' : `${hidden.length} hidden`}
            </button>
          ) : null}
          {(sessions && openGroup) ||
          (conversations && openRuntime && conversationsFor(openRuntime.id).length > 0) ? (
            <RuntimeSessionSubmenu
              {...(openGroup ? { group: openGroup } : {})}
              {...(conversations && openRuntime
                ? {
                    conversations: {
                      ...conversations,
                      runs: conversationsFor(openRuntime.id),
                    },
                  }
                : {})}
              anchor={rowRefs.current[openRuntime?.id ?? ''] ?? null}
              submenuRef={submenuRef}
              resumeSessionId={sessions?.resumeSessionId ?? ''}
              loading={openGroup ? loadingKind === openGroup.kind : false}
              onHover={() => openSubmenu(openRuntime?.id ?? '')}
              onLeave={deferCloseSubmenu}
              onSelect={(session) => {
                if (!openGroup || !sessions) return
                sessions.onSelect(session, openGroup)
                setOpenSubmenuId(null)
                close()
              }}
              onLoadMore={() => {
                if (openGroup) void loadMore(openGroup.kind)
              }}
            />
          ) : null}
        </>
      )}
    </FooterMenu>
  )
}

export function ComposerModelControls({
  models,
  model,
  effort,
  disabled,
  onModelChange,
  onEffortChange,
}: {
  models: ModelOption[]
  model: string
  effort: string
  disabled?: boolean
  onModelChange: (slug: string) => void
  onEffortChange: (effort: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
    </div>
  )
}
