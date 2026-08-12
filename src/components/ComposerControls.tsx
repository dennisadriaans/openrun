/**
 * Composer footer model, effort, access-mode, and runtime pickers.
 *
 * Layout adapted from the t3code chat composer footer (MIT, T3 Tools Inc.).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, FolderGit2, GitBranch, Lock, LockOpen, PenLine, Plus } from 'lucide-react'
import {
  defaultEffort,
  effortLabel,
  findModel,
  modelKindForBin,
  type ModelOption,
} from '../lib/models'
import {
  DEFAULT_RUNTIME_MODE,
  RUNTIME_MODES,
  runtimeModeLabel,
  type RuntimeMode,
} from '../lib/runtimeMode'
import { ProviderIcon } from './ProviderIcons'

export type RuntimeOption = {
  id: string
  label: string
  bin: string
  description?: string
}

function useClickOutside(
  open: boolean,
  onClose: () => void,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, triggerRef, menuRef])
}

function FooterMenu({
  label,
  title,
  disabled,
  leading,
  align = 'start',
  invalid,
  'aria-describedby': ariaDescribedBy,
  children,
}: {
  label: string
  title?: string
  disabled?: boolean
  leading?: ReactNode
  align?: 'start' | 'end'
  invalid?: boolean
  'aria-describedby'?: string
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
  } | null>(null)

  useClickOutside(open, () => setOpen(false), triggerRef, menuRef)

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
      const menuHeight = menuRef.current?.offsetHeight ?? 260
      const spaceBelow = window.innerHeight - rect.bottom
      const openUp = spaceBelow < menuHeight + 12 && rect.top > spaceBelow
      const left =
        align === 'end'
          ? Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8))
          : Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8))
      setCoords({
        top: openUp ? rect.top - 6 : rect.bottom + 6,
        left,
        openUp,
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

  return (
    <div ref={triggerRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        title={title}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-invalid={invalid || undefined}
        aria-describedby={ariaDescribedBy}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-8 max-w-52 min-w-0 items-center gap-2 truncate rounded-lg px-2.5 text-ui-base transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40 sm:max-w-60 ${
          invalid
            ? 'text-rose-300 hover:text-rose-200'
            : 'text-tier-tertiary hover:text-tier-secondary'
        }`}
      >
        {leading}
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-tier-quaternary" />
      </button>
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
                zIndex: 200,
                visibility: coords ? 'visible' : 'hidden',
              }}
              className="min-w-52 overflow-hidden rounded-xl border border-border bg-elevated p-1 shadow-xl shadow-black/40"
            >
              {children(() => setOpen(false))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

function MenuItem({
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
        active ? 'bg-hover text-foreground' : 'text-foreground/85 hover:bg-hover hover:text-foreground'
      }`}
    >
      {leading ? <span className="shrink-0 text-tier-secondary">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint ? <span className="block truncate text-ui-sm text-tier-quaternary">{hint}</span> : null}
      </span>
      {active ? <Check className="h-3.5 w-3.5 shrink-0 text-tier-secondary" /> : null}
    </button>
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
  if (models.length === 0) return null
  const selected = findModel(models, model) ?? models[0]!

  return (
    <FooterMenu
      label={selected.shortName}
      title={selected.name}
      disabled={disabled}
      leading={<ProviderIcon kind={selected.provider} className="h-3.5 w-3.5 shrink-0" />}
    >
      {(close) =>
        models.map((m) => (
          <MenuItem
            key={m.slug}
            active={m.slug === selected.slug}
            label={m.name}
            hint={m.slug}
            leading={<ProviderIcon kind={m.provider} className="h-3.5 w-3.5 shrink-0" />}
            onSelect={() => {
              onChange(m.slug)
              close()
            }}
          />
        ))
      }
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
  'aria-describedby': ariaDescribedBy,
  placeholder = 'Select repository',
  onChange,
  onAddProject,
}: {
  projects: ProjectOption[]
  projectId: string
  disabled?: boolean
  invalid?: boolean
  'aria-describedby'?: string
  placeholder?: string
  onChange: (id: string) => void
  /** Opens add-project flow. Shown when the list is empty, and as a trailing action when not. */
  onAddProject?: () => void
}) {
  const selected = projects.find((p) => p.id === projectId)

  return (
    <FooterMenu
      label={selected?.name ?? placeholder}
      title={selected?.path || selected?.name || placeholder}
      disabled={disabled}
      invalid={invalid}
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
              <div className="px-2.5 py-2 text-ui-base text-tier-quaternary">No repositories yet</div>
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
  kind?: string
  status?: string
  /** Disables the entry and shows as the hint — e.g. a workspace still cloning. */
  blockedReason?: string | null
}

export function BranchPicker({
  workspaces,
  workspaceId,
  disabled,
  placeholder = 'Select branch',
  onChange,
  onRequestNewBranch,
}: {
  workspaces: BranchOption[]
  workspaceId: string
  disabled?: boolean
  placeholder?: string
  onChange: (id: string) => void
  onRequestNewBranch?: () => void
}) {
  const selected = workspaces.find((w) => w.id === workspaceId)

  return (
    <FooterMenu
      label={selected?.branch ?? placeholder}
      title={selected?.branch ?? placeholder}
      disabled={disabled}
      leading={<GitBranch className="h-3.5 w-3.5 shrink-0" />}
    >
      {(close) => (
        <>
          {workspaces.length === 0 ? (
            <div className="px-2.5 py-2 text-ui-base text-tier-quaternary">No branches yet</div>
          ) : (
            workspaces.map((w) => (
              <MenuItem
                key={w.id}
                active={w.id === workspaceId}
                disabled={Boolean(w.blockedReason)}
                label={w.branch}
                hint={w.blockedReason ?? (w.kind === 'main' ? 'main checkout' : undefined)}
                leading={<GitBranch className="h-3.5 w-3.5 shrink-0" />}
                onSelect={() => {
                  onChange(w.id)
                  close()
                }}
              />
            ))
          )}
          {onRequestNewBranch ? (
            <MenuItem
              label="New branch"
              leading={<Plus className="h-3.5 w-3.5 shrink-0" />}
              onSelect={() => {
                close()
                onRequestNewBranch()
              }}
            />
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
  if (runtimes.length === 0) return null
  const selected = runtimes.find((r) => r.id === runtimeId) ?? runtimes[0]!

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
      {(close) =>
        runtimes.map((r) => (
          <MenuItem
            key={r.id}
            active={r.id === selected.id}
            label={r.label}
            hint={r.bin}
            leading={
              <ProviderIcon kind={modelKindForBin(r.bin)} className="h-3.5 w-3.5 shrink-0" />
            }
            onSelect={() => {
              onChange(r.id)
              close()
            }}
          />
        ))
      }
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
