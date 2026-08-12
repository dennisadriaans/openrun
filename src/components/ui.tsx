/** Reusable presentational primitives. */
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { statusMeta } from '../lib/format'
import {
  verdictDescription,
  verdictLabel,
  verdictTone,
  type RunVerdict,
  type VerdictTone,
} from '../lib/verdict'

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim px-4 py-10"
      onClick={onClose}
    >
      <div
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-2xl'} rounded-[10px] border border-border bg-elevated`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-ui-base text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-tier-quaternary transition-colors hover:bg-hover hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  )
}

/** The status colour alone, for dense lists where the label is noise. */
export function StatusDot({ status }: { status: string }) {
  const m = statusMeta(status)
  return (
    <span
      title={m.label}
      aria-label={m.label}
      role="img"
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot} ${status === 'running' ? 'live-dot' : ''}`}
    />
  )
}

export function StatusBadge({ status }: { status: string }) {
  const m = statusMeta(status)
  return (
    <span className={`inline-flex items-center gap-1.5 text-ui-sm ${m.text}`} title={m.label}>
      <StatusDot status={status} />
      {m.label}
    </span>
  )
}

const TONE_CLASSES: Record<VerdictTone, string> = {
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warn',
  neutral: 'text-tier-tertiary',
}

/**
 * What the run actually amounted to, as opposed to whether the process exited
 * 0 (that is `StatusBadge`). Renders nothing until verification has settled,
 * so a live run shows only its status.
 */
export function VerdictBadge({ verdict }: { verdict: RunVerdict | string }) {
  const v = verdict as RunVerdict
  if (!v) return null
  return (
    <span
      title={verdictDescription(v)}
      className={`inline-flex items-center text-ui-sm ${TONE_CLASSES[verdictTone(v)]}`}
    >
      {verdictLabel(v)}
    </span>
  )
}

/**
 * Standard page header. Title is deliberately small — orientation, not hero.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="mb-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-ui-lg font-medium tracking-tight text-foreground">{title}</h1>
        {description ? (
          <p className="mt-0.5 max-w-2xl text-ui-sm text-tier-tertiary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[10px] border border-border bg-elevated ${className}`}>{children}</div>
  )
}

/** Active/inactive switch — same control as the automation form header. */
export function ActiveToggle({
  checked,
  onChange,
  disabled,
  title,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={checked ? 'Active' : 'Inactive'}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-ui-base text-tier-secondary disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        data-on={checked ? 'true' : 'false'}
        className="active-toggle-track relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-[background-color,border-color,box-shadow]"
      >
        <span
          className={`active-toggle-thumb absolute h-3 w-3 rounded-full transition-transform ${
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className={checked ? 'text-tier-secondary' : 'text-tier-tertiary'}>
        {checked ? 'Active' : 'Inactive'}
      </span>
    </button>
  )
}

/** Compact on/off switch with no visible label — used on integration cards. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className="shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        data-on={checked ? 'true' : 'false'}
        className="switch-track relative inline-flex h-5 w-9 items-center rounded-full transition-[background-color,border-color]"
      >
        <span
          className={`switch-thumb absolute h-4 w-4 rounded-full transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  )
}

export function Button({
  children,
  variant = 'default',
  className = '',
  ...props
}: {
  children: ReactNode
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants: Record<string, string> = {
    default:
      'bg-transparent hover:bg-hover text-tier-secondary hover:text-foreground border border-border',
    primary:
      'bg-[var(--base)] hover:bg-[color-mix(in_oklab,var(--base)_88%,transparent)] text-[var(--actionLabel)] border border-transparent',
    danger:
      'bg-transparent hover:bg-hover text-tier-secondary hover:text-danger border border-border',
    ghost:
      'bg-transparent hover:bg-hover text-tier-quaternary hover:text-foreground border border-transparent',
  }
  return (
    <button
      className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-ui-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-ui-sm text-tier-tertiary">{label}</span>
        {hint ? <span className="text-ui-xs text-tier-quaternary">{hint}</span> : null}
      </div>
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-ui-base text-foreground outline-none transition-colors placeholder:text-tier-quaternary hover:border-border-strong focus:border-border-strong focus:bg-hover'

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-[10px] border border-border px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-tier-quaternary">{icon}</div> : null}
      <div className="text-ui-base text-tier-secondary">{title}</div>
      {children ? <div className="max-w-sm text-ui-sm text-tier-quaternary">{children}</div> : null}
    </div>
  )
}
