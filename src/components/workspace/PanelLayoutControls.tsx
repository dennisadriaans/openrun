import { ChevronDown, Maximize2, Minimize2, PanelBottom, PanelRight } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'

/** Bordered chip used in the workspace top bars (git menu, panel tabs, etc.). */
export function WorkspaceToolbarChip({
  icon: Icon,
  label,
  count,
  showChevron,
  active,
  mono,
  className = '',
  ...props
}: {
  icon?: ComponentType<{ className?: string }>
  label: ReactNode
  count?: number
  showChevron?: boolean
  active?: boolean
  mono?: boolean
  className?: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`flex h-7 max-w-[220px] items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors ${
        active
          ? 'border border-border bg-[var(--bg-luminous-tertiary)] text-foreground'
          : 'border border-transparent text-muted-foreground hover:bg-[var(--bg-luminous-quaternary)] hover:text-foreground'
      } ${className}`}
      {...props}
    >
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" /> : null}
      <span className={`min-w-0 truncate ${mono ? 'mono' : ''}`}>{label}</span>
      {count != null && count > 0 ? (
        <span className="shrink-0 rounded-full bg-[var(--modified)]/15 px-1.5 text-[10.5px] tabular-nums text-[var(--modified)]">
          {count}
        </span>
      ) : null}
      {showChevron ? (
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
      ) : null}
    </button>
  )
}

/** Shared chrome for the small square icon toggles in the workspace top bars. */
function ToggleButton({
  icon: Icon,
  label,
  active,
  onToggle,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onToggle}
      className={`inline-flex size-7 items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      <Icon className="size-3.5" />
    </button>
  )
}

export function TerminalToggleControl({
  terminalOpen,
  onToggle,
}: {
  terminalOpen: boolean
  onToggle: () => void
}) {
  return (
    <ToggleButton
      icon={PanelBottom}
      label="Toggle terminal"
      active={terminalOpen}
      onToggle={onToggle}
    />
  )
}

export function RightPanelToggleControl({
  rightPanelOpen,
  onToggle,
}: {
  rightPanelOpen: boolean
  onToggle: () => void
}) {
  return (
    <ToggleButton
      icon={PanelRight}
      label="Toggle right panel"
      active={rightPanelOpen}
      onToggle={onToggle}
    />
  )
}

export function RightPanelMaximizeControl({
  maximized,
  onToggle,
}: {
  maximized: boolean
  onToggle: () => void
}) {
  const label = maximized ? 'Restore panel size' : 'Maximize panel'
  return (
    <ToggleButton
      icon={maximized ? Minimize2 : Maximize2}
      label={label}
      active={maximized}
      onToggle={onToggle}
    />
  )
}
