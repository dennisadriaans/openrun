import type { PermissionOption, ToolKind } from '../../lib/acp'
import type { ApprovalDecision } from '../../lib/claudeControl'
import { resolveCallRole } from '../../lib/toolCallRole'
import { eyebrowForCallRole, iconForCallRole } from './chatEventIcons'

/**
 * Tool-approval prompt. Style via `.chat-event--approval`.
 *
 * Buttons come from the agent's `PermissionOption[]` when present; older rows
 * fall back to Allow / Deny.
 */
export function ApprovalEvent({
  title,
  name,
  callRole,
  mcpServer,
  toolKind,
  requestId,
  options,
  pending,
  answering,
  onAnswer,
}: {
  title: string
  name?: string
  callRole?: string
  mcpServer?: string
  toolKind?: ToolKind
  requestId: string
  options: PermissionOption[]
  pending: boolean
  answering: boolean
  onAnswer?: (input: { requestId: string; optionId?: string; decision?: ApprovalDecision }) => void
}) {
  const role = resolveCallRole({ callRole, name, mcpServer })
  const Icon = iconForCallRole(role, toolKind)
  const eyebrow = eyebrowForCallRole(role)

  const buttons: Array<{ key: string; label: string; allow: boolean; answer: () => void }> =
    options.length > 0
      ? options.map((o) => ({
          key: o.optionId,
          label: o.name,
          allow: o.kind.startsWith('allow'),
          answer: () => onAnswer?.({ requestId, optionId: o.optionId }),
        }))
      : [
          {
            key: 'allow',
            label: 'Allow',
            allow: true,
            answer: () => onAnswer?.({ requestId, decision: 'allow' }),
          },
          {
            key: 'deny',
            label: 'Deny',
            allow: false,
            answer: () => onAnswer?.({ requestId, decision: 'deny' }),
          },
        ]

  return (
    <div
      className="chat-event chat-event--approval"
      data-chat-event="approval"
      data-call-role={role}
    >
      <div className="chat-event__approval-banner flex items-center gap-2">
        <Icon className="chat-event__icon size-3.5 shrink-0 opacity-70" />
        {eyebrow ? <span className="chat-event__eyebrow">{eyebrow}</span> : null}
        <span>
          Approval requested: <span className="mono">{title}</span>
        </span>
      </div>
      {pending && onAnswer && requestId ? (
        <div className="chat-event__actions mt-2 flex flex-wrap gap-2">
          {buttons.map((b) => (
            <button
              key={b.key}
              type="button"
              disabled={answering}
              onClick={b.answer}
              className={
                b.allow
                  ? 'chat-event__allow rounded-md bg-emerald-500/20 px-2.5 py-1 text-[12px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/40 transition-colors hover:bg-emerald-500/30 disabled:opacity-50'
                  : 'chat-event__deny rounded-md bg-rose-500/20 px-2.5 py-1 text-[12px] font-medium text-rose-300 ring-1 ring-inset ring-rose-500/40 transition-colors hover:bg-rose-500/30 disabled:opacity-50'
              }
            >
              {b.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
