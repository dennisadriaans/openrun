/**
 * Shared expandable chrome for every chat transcript event.
 *
 * Tune appearance via CSS custom properties on `:root` / `.chat-event--*` in
 * `styles.css` — each role sets `--chat-event-accent` and can override gap,
 * radius, header/body colors independently. Prefer editing those variables
 * (or the `.chat-event--mcp` etc. rules) over changing this component.
 */
import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ToolCallStatus } from '../../lib/acp'
import { isSettledToolStatus } from '../../lib/acp'

/** Every stylable transcript block — matches `data-chat-event`. */
export type ChatEventKind =
  | 'tool'
  | 'mcp'
  | 'skill'
  | 'subagent'
  | 'thought'
  | 'plan'
  | 'approval'
  | 'error'
  | 'raw'

export function ChatEventShell({
  kind,
  title,
  eyebrow,
  icon: Icon,
  status,
  open,
  onToggle,
  children,
  trailing,
}: {
  kind: ChatEventKind
  title: string
  /** Small label above / beside the title (e.g. "MCP", "Skill"). */
  eyebrow?: string
  icon: LucideIcon
  status?: ToolCallStatus
  open: boolean
  onToggle: () => void
  children?: ReactNode
  trailing?: ReactNode
}) {
  const settled = status === undefined ? true : isSettledToolStatus(status)
  const failed = status === 'failed'
  const running = status !== undefined && !settled
  const titleText = running ? `⟳ ${title}` : status !== undefined ? `↕ ${title}` : title

  return (
    <div
      className={`chat-event chat-event--${kind}`}
      data-chat-event={kind}
      data-status={status ?? (settled ? 'completed' : 'in_progress')}
      data-open={open ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`chat-event__header ${failed ? 'chat-event__header--failed' : ''}`}
      >
        <ChevronRight
          className={`chat-event__chevron size-3.5 shrink-0 opacity-70 transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        />
        <Icon className="chat-event__icon size-3.5 shrink-0 opacity-70" />
        {eyebrow ? <span className="chat-event__eyebrow">{eyebrow}</span> : null}
        <span
          className={`chat-event__title min-w-0 flex-1 truncate ${
            kind === 'thought' ? 'italic' : 'mono'
          }`}
        >
          {titleText}
        </span>
        {trailing}
        {status !== undefined && !settled ? (
          <span className="chat-event__status shrink-0 text-[10px] uppercase tracking-wide">
            {status === 'pending' ? 'pending' : 'running'}
          </span>
        ) : failed ? (
          <span className="chat-event__status chat-event__status--failed shrink-0 text-[10px] uppercase tracking-wide">
            failed
          </span>
        ) : null}
      </button>
      {open && children != null ? <div className="chat-event__body">{children}</div> : null}
    </div>
  )
}

export function ChatEventSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="chat-event__section">
      <div className="chat-event__section-label">{label}</div>
      {children}
    </div>
  )
}
