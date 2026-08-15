/**
 * A sub-agent spawn (`Task` / `Agent`) in the transcript.
 *
 * A sub-agent is a whole conversation of its own, not a tool result: it gets a
 * card with the agent's identity and live status, and expands to the brief it
 * was given plus the report it came back with, rendered as prose.
 * Presentation follows the t3code agent row (MIT, T3 Tools Inc.).
 */
import { useState } from 'react'
import { Bot, ChevronRight } from 'lucide-react'
import { isSettledToolStatus, type ToolCallStatus } from '../../lib/acp'
import { subagentMetaFromInput } from '../../lib/toolCallRole'
import { ChatMarkdown } from './ChatMarkdown'

function promptFromInput(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  const obj = input as Record<string, unknown>
  for (const key of ['prompt', 'task', 'instructions', 'input']) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function SubagentCall({
  name,
  title,
  status,
  input,
  result,
  onSelectFile,
}: {
  name?: string
  title?: string
  status?: ToolCallStatus
  input: unknown
  result: string
  onSelectFile?: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const meta = subagentMetaFromInput(input)
  const agent = meta.subagentType || name || 'subagent'
  const description = meta.description || title || ''
  const prompt = promptFromInput(input)
  const settled = status === undefined ? true : isSettledToolStatus(status)
  const failed = status === 'failed'
  const running = !settled
  const statusLabel = running ? 'working' : failed ? 'failed' : '✓ completed'
  const expandable = Boolean(prompt || result)

  return (
    <div
      className="chat-event chat-event--subagent chat-subagent"
      data-chat-event="subagent"
      data-status={status ?? 'completed'}
      data-open={open ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={() => expandable && setOpen(!open)}
        aria-expanded={expandable ? open : undefined}
        className="chat-subagent__header"
      >
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${
            running ? 'live-dot bg-accent' : failed ? 'bg-danger' : 'bg-success'
          }`}
        />
        <Bot className="size-3.5 shrink-0 opacity-80" />
        <span className="chat-event__eyebrow">Subagent</span>
        <span className="min-w-0 flex-1 truncate text-left">
          <span className="font-medium text-foreground">{agent}</span>
          {description ? <span className="text-muted-foreground"> · {description}</span> : null}
        </span>
        <span className="shrink-0 mono text-[11px] text-muted-foreground">{statusLabel}</span>
        <ChevronRight
          className={`size-3 shrink-0 transition-transform ${expandable ? 'opacity-50' : 'opacity-0'} ${
            open ? 'rotate-90' : ''
          }`}
        />
      </button>

      {open && expandable ? (
        <div className="chat-subagent__body">
          {prompt ? (
            <div>
              <div className="chat-event__section-label">Brief</div>
              <pre className="scroll-thin max-h-48 overflow-auto rounded-lg border border-border bg-chrome/80 p-2.5 mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {prompt}
              </pre>
            </div>
          ) : null}
          {result ? (
            <div>
              <div className="chat-event__section-label">Report</div>
              <ChatMarkdown
                text={result}
                {...(onSelectFile ? { onSelectFile } : {})}
                className="text-[13px]"
              />
            </div>
          ) : running ? (
            <div className="text-ui-xs text-tier-quaternary">Waiting for the sub-agent…</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
