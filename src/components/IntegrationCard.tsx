import { BookOpen, Pencil } from 'lucide-react'
import type { ReactNode } from 'react'
import { siGithub, siJira, siLinear } from 'simple-icons'
import { Switch } from './ui'

function SimpleMark({
  title,
  path,
  hex,
  className,
}: {
  title: string
  path: string
  hex: string
  className?: string
}) {
  return (
    <svg role="img" aria-label={title} viewBox="0 0 24 24" className={className} fill={`#${hex}`}>
      <path d={path} />
    </svg>
  )
}

export function IntegrationBrandIcon({
  id,
  className = 'size-5',
}: {
  id: 'github' | 'jira' | 'linear'
  className?: string
}) {
  if (id === 'github') {
    return (
      <SimpleMark
        title={siGithub.title}
        path={siGithub.path}
        hex={siGithub.hex}
        className={className}
      />
    )
  }
  if (id === 'jira') {
    return (
      <SimpleMark title={siJira.title} path={siJira.path} hex={siJira.hex} className={className} />
    )
  }
  return (
    <SimpleMark
      title={siLinear.title}
      path={siLinear.path}
      hex={siLinear.hex}
      className={className}
    />
  )
}

const BADGE_TONE: Record<'blue' | 'purple', string> = {
  blue: 'bg-[color-mix(in_oklab,var(--blue)_16%,transparent)] text-[var(--blue)]',
  purple: 'bg-[color-mix(in_oklab,var(--purple)_16%,transparent)] text-[var(--purple)]',
}

export function IntegrationCard({
  title,
  badge,
  badgeTone,
  description,
  icon,
  enabled,
  configured,
  selected,
  onToggle,
  onAction,
  toggleDisabled,
}: {
  title: string
  badge: string
  badgeTone: 'blue' | 'purple'
  description: string
  icon: ReactNode
  enabled: boolean
  configured: boolean
  selected?: boolean
  onToggle: (enabled: boolean) => void
  onAction: () => void
  toggleDisabled?: boolean
}) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-[10px] border bg-elevated ${
        selected ? 'border-border-strong' : 'border-border'
      }`}
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-white">
            {icon}
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h2 className="truncate text-ui-base font-semibold text-foreground">{title}</h2>
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[11px] leading-4 ${BADGE_TONE[badgeTone]}`}
            >
              {badge}
            </span>
          </div>
          <Switch
            checked={enabled}
            onChange={onToggle}
            disabled={toggleDisabled}
            label={`${enabled ? 'Disable' : 'Enable'} ${title}`}
          />
        </div>
        <p className="text-ui-sm leading-relaxed text-tier-tertiary">{description}</p>
      </div>
      <div className="border-t border-border">
        <button
          type="button"
          onClick={onAction}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-ui-sm text-tier-tertiary transition-colors hover:bg-hover hover:text-foreground"
        >
          {configured ? (
            <Pencil className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
          )}
          {configured ? 'Configure integration' : 'Learn more'}
        </button>
      </div>
    </div>
  )
}
