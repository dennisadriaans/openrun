/**
 * Compact transcript row for one ACP tool call (Bash / Read / Edit / …).
 *
 * Ordinary tools render as a verb + target (`Ran pnpm lint`, `Read payments.vue`)
 * using the type scale, opacity tiers, file-type icons, and diff tokens already
 * in `styles.css`. MCP / skill / sub-agent calls keep their role eyebrow.
 * Expand a row for command output, the edit hunk, or the result.
 */
import { useState, type ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import {
  isSettledToolStatus,
  type ToolCallLocation,
  type ToolCallStatus,
  type ToolKind,
} from '../../lib/acp'
import {
  resolveCallRole,
  toolCallRoleTitle,
  type ToolCallRole,
} from '../../lib/toolCallRole'
import {
  displayPath,
  toolCallView,
  type DisplayPath,
  type ToolCallEditHunk,
  type ToolCallTarget,
  type ToolCallView,
} from '../../lib/toolCallView'
import { FileTypeIcon } from '../FileTypeIcon'
import { ChatEventSection } from './ChatEventShell'
import { eyebrowForCallRole, iconForCallRole, iconForToolKind } from './chatEventIcons'

function clip(text: string, maxLines = 16, maxChars = 4000): string {
  const sliced = text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text
  const lines = sliced.split('\n')
  if (lines.length <= maxLines) return sliced
  return `${lines.slice(0, maxLines).join('\n')}\n…`
}

function formatToolInput(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function isGenericEditResult(result: string): boolean {
  return /has been updated successfully/i.test(result)
}

function shouldShowRawInput(view: ToolCallView, input: unknown): boolean {
  if (input == null) return false
  if (view.hunks.length > 0) return false
  if (
    view.target.type === 'command' ||
    view.target.type === 'path' ||
    view.target.type === 'pattern' ||
    view.target.type === 'url'
  ) {
    return false
  }
  if (typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0) {
    return false
  }
  return true
}

function PathLabel({ path }: { path: DisplayPath }) {
  return (
    <span className="min-w-0 truncate">
      {path.dir ? <span className="text-tier-quaternary">{path.dir}/</span> : null}
      <span className="text-tier-secondary">{path.name}</span>
      {path.line != null ? <span className="text-tier-quaternary">:{path.line}</span> : null}
    </span>
  )
}

function TargetLabel({ target }: { target: ToolCallTarget }) {
  if (target.type === 'path') return <PathLabel path={target.path} />
  if (target.type === 'command') {
    return <span className="min-w-0 truncate mono text-tier-secondary">{target.command}</span>
  }
  if (target.type === 'pattern') {
    return (
      <span className="min-w-0 truncate">
        <span className="mono text-tier-secondary">{target.pattern}</span>
        {target.scope ? <span className="text-tier-quaternary"> in {target.scope}</span> : null}
      </span>
    )
  }
  if (target.type === 'url') {
    return <span className="min-w-0 truncate text-tier-secondary">{target.url}</span>
  }
  return <span className="min-w-0 truncate text-tier-secondary">{target.text}</span>
}

function targetTitle(target: ToolCallTarget): string {
  if (target.type === 'path') {
    return target.path.line != null ? `${target.path.path}:${target.path.line}` : target.path.path
  }
  if (target.type === 'command') return target.description || target.command
  if (target.type === 'pattern') {
    return target.scope ? `${target.pattern} in ${target.scope}` : target.pattern
  }
  if (target.type === 'url') return target.url
  return target.text
}

function ToolCallGlyph({
  role,
  view,
}: {
  role: ToolCallRole
  view: ToolCallView
}) {
  if (role !== 'tool') {
    const Icon = iconForCallRole(role, view.kind)
    return <Icon className="chat-tool__icon size-3.5 shrink-0" />
  }
  if (view.target.type === 'path') {
    return <FileTypeIcon path={view.target.path.path} className="chat-tool__icon size-3.5" />
  }
  if (view.kind === 'execute') {
    return <FileTypeIcon path="run.bash" className="chat-tool__icon size-3.5" />
  }
  const Icon: LucideIcon = iconForToolKind(view.kind)
  return <Icon className="chat-tool__icon size-3.5 shrink-0" />
}

function MiniDiff({ hunks }: { hunks: ToolCallEditHunk[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {hunks.map((hunk, i) => (
        <div key={i} className={i > 0 ? 'border-t border-border' : ''}>
          {hunk.oldString ? (
            <pre className="scroll-thin max-h-40 overflow-auto bg-[var(--diffs-bg-deletion-override)] px-2.5 py-1.5 mono text-[11px] leading-relaxed text-[var(--removed)]">
              {clip(hunk.oldString)
                .split('\n')
                .map((line) => `− ${line}`)
                .join('\n')}
            </pre>
          ) : null}
          {hunk.newString ? (
            <pre className="scroll-thin max-h-40 overflow-auto bg-[var(--diffs-bg-addition-override)] px-2.5 py-1.5 mono text-[11px] leading-relaxed text-[var(--added)]">
              {clip(hunk.newString)
                .split('\n')
                .map((line) => `+ ${line}`)
                .join('\n')}
            </pre>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ResultPre({ children }: { children: string }) {
  return (
    <pre className="chat-tool__pre scroll-thin max-h-48 overflow-auto rounded-lg border border-border bg-chrome/80 p-2.5 mono text-[11px] leading-relaxed text-muted-foreground">
      {clip(children, 40, 8000)}
    </pre>
  )
}

function ToolLocations({
  locations,
  onSelectFile,
}: {
  locations: ToolCallLocation[]
  onSelectFile?: (path: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {locations.map((loc) => {
        const label = loc.line ? `${loc.path}:${loc.line}` : loc.path
        const path = displayPath(loc.path, loc.line)
        return onSelectFile ? (
          <button
            key={label}
            type="button"
            onClick={() => onSelectFile(loc.path)}
            className="rounded bg-secondary px-1.5 py-0.5 text-left transition-colors hover:text-foreground"
          >
            <PathLabel path={path} />
          </button>
        ) : (
          <span key={label} className="rounded bg-secondary px-1.5 py-0.5">
            <PathLabel path={path} />
          </span>
        )
      })}
    </div>
  )
}

function ToolCallBody({
  view,
  role,
  mcpServer,
  input,
  result,
  status,
  onSelectFile,
}: {
  view: ToolCallView
  role: ToolCallRole
  mcpServer?: string
  input: unknown
  result: string
  status?: ToolCallStatus
  onSelectFile?: (path: string) => void
}) {
  const running = status !== undefined && !isSettledToolStatus(status)
  const showResult = Boolean(result) && !(view.hunks.length > 0 && isGenericEditResult(result))
  const showRaw = shouldShowRawInput(view, input)
  const rawText = showRaw ? formatToolInput(input) : ''
  const pathTarget = view.target.type === 'path' ? view.target.path.path : undefined
  const extraLocations = pathTarget
    ? view.locations.filter((loc) => loc.path !== pathTarget)
    : view.locations
  const sections: ReactNode[] = []

  if (mcpServer) {
    sections.push(
      <ChatEventSection key="server" label="Server">
        <div className="mono text-ui-xs text-tier-tertiary">{mcpServer}</div>
      </ChatEventSection>,
    )
  }

  if (view.target.type === 'command') {
    sections.push(
      <div key="cmd" className="overflow-hidden rounded-lg border border-border bg-chrome/80">
        <div className="border-b border-border px-2.5 py-1.5 mono text-[11px] text-tier-secondary">
          <span className="text-tier-quaternary">$ </span>
          {view.target.command}
        </div>
        {showResult ? (
          <pre className="scroll-thin max-h-48 overflow-auto p-2.5 mono text-[11px] leading-relaxed text-muted-foreground">
            {clip(result, 40, 8000)}
          </pre>
        ) : running ? (
          <div className="px-2.5 py-1.5 text-ui-xs text-tier-quaternary">Waiting for result…</div>
        ) : null}
      </div>,
    )
  } else if (view.hunks.length > 0) {
    sections.push(<MiniDiff key="diff" hunks={view.hunks} />)
    if (showResult) {
      sections.push(
        <ChatEventSection key="result" label="Result">
          <ResultPre>{result}</ResultPre>
        </ChatEventSection>,
      )
    }
  } else {
    if (rawText) {
      sections.push(
        <ChatEventSection key="input" label="Input">
          <ResultPre>{rawText}</ResultPre>
        </ChatEventSection>,
      )
    }
    if (showResult) {
      sections.push(
        <ChatEventSection key="result" label={view.kind === 'read' ? 'Contents' : 'Result'}>
          <ResultPre>{result}</ResultPre>
        </ChatEventSection>,
      )
    } else if (running) {
      sections.push(
        <div key="wait" className="text-ui-xs text-tier-quaternary">
          Waiting for result…
        </div>,
      )
    }
  }

  if (extraLocations.length > 0) {
    sections.push(
      <ToolLocations key="locs" locations={extraLocations} onSelectFile={onSelectFile} />,
    )
  }

  if (role !== 'tool' && sections.length === 0 && running) {
    sections.push(
      <div key="wait" className="text-ui-xs text-tier-quaternary">
        Waiting for result…
      </div>,
    )
  }

  if (sections.length === 0) return null
  return <div className="chat-tool__body">{sections}</div>
}

export function ToolCall({
  name,
  title,
  callRole,
  mcpServer,
  toolKind,
  status,
  input,
  result,
  locations,
  onSelectFile,
}: {
  name?: string
  title?: string
  callRole?: string
  mcpServer?: string
  toolKind?: ToolKind
  status?: ToolCallStatus
  input: unknown
  result: string
  locations?: ToolCallLocation[]
  onSelectFile?: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const role = resolveCallRole({ callRole, name, toolInput: input, mcpServer })
  const view = toolCallView({
    name,
    title,
    toolKind,
    status,
    toolInput: input,
    locations,
  })
  const eyebrow = eyebrowForCallRole(role)
  const settled = status === undefined ? true : isSettledToolStatus(status)
  const failed = status === 'failed'
  const running = status !== undefined && !settled
  const roleTitle =
    role === 'tool'
      ? undefined
      : toolCallRoleTitle(role, name, input, { mcpServer, fallback: title })
  const expandable =
    Boolean(result) ||
    view.hunks.length > 0 ||
    shouldShowRawInput(view, input) ||
    view.target.type === 'command' ||
    Boolean(mcpServer) ||
    running ||
    (locations && locations.length > 0)

  const pathTarget = view.target.type === 'path' ? view.target.path : undefined
  const headerTarget = roleTitle ? (
    <span className="min-w-0 truncate text-tier-secondary">{roleTitle}</span>
  ) : (
    <TargetLabel target={view.target} />
  )

  return (
    <div
      className={`chat-event chat-tool chat-event--${role}`}
      data-chat-event={role}
      data-tool-kind={view.kind}
      data-status={status ?? (settled ? 'completed' : 'in_progress')}
      data-open={open ? 'true' : 'false'}
    >
      <div className={`chat-tool__header ${failed ? 'chat-tool__header--failed' : ''}`}>
        <button
          type="button"
          onClick={() => {
            if (expandable) setOpen(!open)
          }}
          aria-expanded={expandable ? open : undefined}
          className={`flex shrink-0 items-center gap-2 ${expandable ? '' : 'cursor-default'}`}
        >
          <ChevronRight
            className={`chat-tool__chevron size-3 shrink-0 transition-transform ${
              expandable ? 'opacity-50' : 'opacity-0'
            } ${open ? 'rotate-90' : ''}`}
          />
          <ToolCallGlyph role={role} view={view} />
          {eyebrow ? <span className="chat-event__eyebrow">{eyebrow}</span> : null}
          {role === 'tool' ? <span className="chat-tool__verb">{view.verb}</span> : null}
        </button>
        {pathTarget && onSelectFile && !roleTitle ? (
          <button
            type="button"
            onClick={() => onSelectFile(pathTarget.path)}
            title={pathTarget.path}
            className="min-w-0 flex-1 truncate text-left transition-colors hover:text-foreground"
          >
            <PathLabel path={pathTarget} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (expandable) setOpen(!open)
            }}
            title={roleTitle || targetTitle(view.target)}
            className={`min-w-0 flex-1 truncate text-left ${expandable ? '' : 'cursor-default'}`}
          >
            {headerTarget}
          </button>
        )}
        {running ? (
          <span
            className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
            aria-label={status === 'pending' ? 'pending' : 'running'}
          />
        ) : failed ? (
          <span className="shrink-0 text-ui-xs text-danger">failed</span>
        ) : null}
      </div>
      {open && expandable ? (
        <ToolCallBody
          view={view}
          role={role}
          mcpServer={mcpServer}
          input={input}
          result={result}
          status={status}
          onSelectFile={onSelectFile}
        />
      ) : null}
    </div>
  )
}
