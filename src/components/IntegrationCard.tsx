import { BookOpen, Pencil } from 'lucide-react'
import type { ReactNode, SVGProps } from 'react'
import { siGithub, siJira, siLinear } from 'simple-icons'
import { Switch } from './ui'

type IconProps = SVGProps<SVGSVGElement>

function SlackMark({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 54 54" className={className} aria-hidden="true" {...props}>
      <path
        fill="#36C5F0"
        d="M19.712 31.954c0 2.706-2.199 4.905-4.905 4.905s-4.905-2.199-4.905-4.905 2.199-4.905 4.905-4.905h4.905v4.905zm2.456 0c0-2.706 2.199-4.905 4.905-4.905s4.905 2.199 4.905 4.905v12.262c0 2.706-2.199 4.905-4.905 4.905s-4.905-2.199-4.905-4.905V31.954z"
      />
      <path
        fill="#2EB67D"
        d="M27.073 19.712c-2.706 0-4.905-2.199-4.905-4.905s2.199-4.905 4.905-4.905 4.905 2.199 4.905 4.905v4.905h-4.905zm0 2.456c2.706 0 4.905 2.199 4.905 4.905s-2.199 4.905-4.905 4.905H14.81c-2.706 0-4.905-2.199-4.905-4.905s2.199-4.905 4.905-4.905h12.263z"
      />
      <path
        fill="#ECB22E"
        d="M34.334 27.073c0-2.706 2.199-4.905 4.905-4.905s4.905 2.199 4.905 4.905-2.199 4.905-4.905 4.905h-4.905v-4.905zm-2.456 0c0 2.706-2.199 4.905-4.905 4.905s-4.905-2.199-4.905-4.905V14.81c0-2.706 2.199-4.905 4.905-4.905s4.905 2.199 4.905 4.905v12.263z"
      />
      <path
        fill="#E01E5A"
        d="M27.073 34.334c2.706 0 4.905 2.199 4.905 4.905s-2.199 4.905-4.905 4.905-4.905-2.199-4.905-4.905v-4.905h4.905zm0-2.456c-2.706 0-4.905-2.199-4.905-4.905s2.199-4.905 4.905-4.905h12.262c2.706 0 4.905 2.199 4.905 4.905s-2.199 4.905-4.905 4.905H27.073z"
      />
    </svg>
  )
}

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
    <svg
      role="img"
      aria-label={title}
      viewBox="0 0 24 24"
      className={className}
      fill={`#${hex}`}
    >
      <path d={path} />
    </svg>
  )
}

export function IntegrationBrandIcon({
  id,
  className = 'size-5',
}: {
  id: 'slack' | 'github' | 'jira' | 'linear'
  className?: string
}) {
  if (id === 'slack') return <SlackMark className={className} />
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
