/**
 * Compact transcript row for one ACP tool call (Bash / Read / Edit / …).
 *
 * Ordinary tools render as a verb + target (`Ran pnpm lint`, `Read payments.vue`)
 * using the type scale, opacity tiers, file-type icons, and diff tokens already
 * in `styles.css`. MCP / skill / sub-agent calls keep their role eyebrow.
 * Expand a row for command output, the edit hunk, or the result.
 */
import { useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  isSettledToolStatus,
  type ToolCallLocation,
  type ToolCallStatus,
  type ToolKind,
} from '../../lib/acp'
import { resolveCallRole, toolCallRoleTitle, type ToolCallRole } from '../../lib/toolCallRole'
import {
  displayPath,
  formatToolResult,
  toolCallFields,
  toolCallView,
  type DisplayPath,
  type ToolCallField,
  type ToolCallTarget,
  type ToolCallView,
} from '../../lib/toolCallView'
import { FileTypeIcon } from '../FileTypeIcon'
import { ChatEventSection } from './ChatEventShell'
import { EditDiff } from './EditDiff'
import { SubagentCall } from './SubagentCall'
import { TerminalOutput } from './TerminalOutput'
import { eyebrowForCallRole, iconForCallRole, iconForToolKind } from './chatEventIcons'
import { ActivityOrb } from './ActivityOrb'
import { useChatThemeBehaviour } from './ChatThemeProvider'
import { orbStateForTool } from '../../lib/orbState'

function clip(text: string, maxLines = 16, maxChars = 4000): string {
  const sliced = text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text
  const lines = sliced.split('\n')
  if (lines.length <= maxLines) return sliced
  return `${lines.slice(0, maxLines).join('\n')}\n…`
}

function isGenericEditResult(result: string): boolean {
  return /has been updated successfully/i.test(result)
}

/**
 * Arguments worth showing under the header.
 *
 * A tool we have a layout for (a command, a file, a pattern) already says
 * everything in its header row; a custom or MCP tool has arguments nobody has
 * seen before, and those are what this renders.
 */
function inputFields(view: ToolCallView, input: unknown): ToolCallField[] {
  if (input == null || view.hunks.length > 0) return []
  return toolCallFields(input, view.target)
}

function shouldShowRawInput(view: ToolCallView, input: unknown): boolean {
  return inputFields(view, input).length > 0
}

function FieldRows({ fields }: { fields: ToolCallField[] }) {
  return (
    <dl className="grid gap-1">
      {fields.map((field) =>
        field.block ? (
          <div key={field.key} className="min-w-0">
            <dt className="text-ui-xs text-tier-quaternary">{field.label}</dt>
            <dd className="mt-0.5">
              <ResultPre>{field.value}</ResultPre>
            </dd>
          </div>
        ) : (
          <div key={field.key} className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-ui-xs text-tier-quaternary">{field.label}</dt>
            <dd className="min-w-0 flex-1 truncate mono text-[11px] text-tier-secondary">
              {field.value}
            </dd>
          </div>
        ),
      )}
    </dl>
  )
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

function ToolCallGlyph({ role, view }: { role: ToolCallRole; view: ToolCallView }) {
  if (role !== 'tool') {
    const Icon = iconForCallRole(role, view.kind)
    return <Icon className="chat-tool__icon size-3.5 shrink-0" />
  }
  if (view.kind !== 'execute' && view.target.type === 'path') {
    return <FileTypeIcon path={view.target.path.path} className="chat-tool__icon size-3.5" />
  }
  const Icon = iconForToolKind(view.kind)
  return <Icon className="chat-tool__icon size-3.5 shrink-0" />
}

function ResultPre({ children }: { children: string }) {
  return (
    <TerminalOutput
      text={clip(children, 40, 8000)}
      className="chat-tool__pre scroll-thin max-h-48 overflow-auto rounded-lg border border-border bg-chrome/80 p-2.5 mono text-[11px] leading-relaxed text-muted-foreground"
    />
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
  onUndoFile,
  onRedoFile,
  undoDisabled,
  undoDisabledReason,
  undoBusyPath,
  redoBusyPath,
  changedPaths,
  undonePaths,
  redoablePaths,
}: {
  view: ToolCallView
  role: ToolCallRole
  mcpServer?: string
  input: unknown
  result: string
  status?: ToolCallStatus
  onSelectFile?: (path: string) => void
  onUndoFile?: (path: string) => void
  onRedoFile?: (path: string) => void
  undoDisabled?: boolean
  undoDisabledReason?: string
  undoBusyPath?: string | null
  redoBusyPath?: string | null
  changedPaths?: string[]
  undonePaths?: string[]
  redoablePaths?: string[]
}) {
  const running = status !== undefined && !isSettledToolStatus(status)
  const showResult = Boolean(result) && !(view.hunks.length > 0 && isGenericEditResult(result))
  const fields = inputFields(view, input)
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
          <TerminalOutput
            text={clip(result, 40, 8000)}
            className="scroll-thin max-h-48 overflow-auto p-2.5 mono text-[11px] leading-relaxed text-muted-foreground"
          />
        ) : running ? (
          <div className="px-2.5 py-1.5 text-ui-xs text-tier-quaternary">Waiting for result…</div>
        ) : null}
      </div>,
    )
  } else if (view.hunks.length > 0) {
    sections.push(
      <EditDiff
        key="diff"
        hunks={view.hunks}
        {...(view.target.type === 'path' ? { path: view.target.path.path } : {})}
        {...(onSelectFile ? { onSelectFile } : {})}
        {...(onUndoFile ? { onUndoFile } : {})}
        {...(onRedoFile ? { onRedoFile } : {})}
        {...(undoDisabled ? { undoDisabled } : {})}
        {...(undoDisabledReason ? { undoDisabledReason } : {})}
        {...(undoBusyPath ? { undoBusyPath } : {})}
        {...(redoBusyPath ? { redoBusyPath } : {})}
        {...(changedPaths ? { changedPaths } : {})}
        {...(undonePaths ? { undonePaths } : {})}
        {...(redoablePaths ? { redoablePaths } : {})}
      />,
    )
    if (showResult) {
      sections.push(
        <ChatEventSection key="result" label="Result">
          <ResultPre>{formatToolResult(result)}</ResultPre>
        </ChatEventSection>,
      )
    }
  } else {
    if (fields.length > 0) {
      sections.push(
        <ChatEventSection key="input" label="Arguments">
          <FieldRows fields={fields} />
        </ChatEventSection>,
      )
    }
    if (showResult) {
      sections.push(
        <ChatEventSection key="result" label={view.kind === 'read' ? 'Contents' : 'Result'}>
          <ResultPre>{formatToolResult(result)}</ResultPre>
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
  onReviewFile,
  onUndoFile,
  onRedoFile,
  undoDisabled,
  undoDisabledReason,
  undoBusyPath,
  redoBusyPath,
  changedPaths,
  undonePaths,
  redoablePaths,
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
  onReviewFile?: (path: string) => void
  onUndoFile?: (path: string) => void
  onRedoFile?: (path: string) => void
  undoDisabled?: boolean
  undoDisabledReason?: string
  undoBusyPath?: string | null
  redoBusyPath?: string | null
  changedPaths?: string[]
  undonePaths?: string[]
  redoablePaths?: string[]
}) {
  const [picked, setOpen] = useState<boolean | null>(null)
  const { expandToolKinds } = useChatThemeBehaviour()
  const role = resolveCallRole({ callRole, name, toolInput: input, mcpServer })
  if (role === 'subagent') {
    return (
      <SubagentCall
        {...(name ? { name } : {})}
        {...(title ? { title } : {})}
        {...(status ? { status } : {})}
        input={input}
        result={result}
        {...(onSelectFile ? { onSelectFile } : {})}
      />
    )
  }
  const view = toolCallView({
    name,
    title,
    toolKind,
    status,
    toolInput: input,
    locations,
  })
  if (role === 'tool' && view.hunks.length > 0) {
    const openFile = onReviewFile ?? onSelectFile
    return (
      <EditDiff
        hunks={view.hunks}
        {...(view.target.type === 'path' ? { path: view.target.path.path } : {})}
        {...(openFile ? { onSelectFile: openFile } : {})}
        {...(onUndoFile ? { onUndoFile } : {})}
        {...(onRedoFile ? { onRedoFile } : {})}
        {...(undoDisabled ? { undoDisabled } : {})}
        {...(undoDisabledReason ? { undoDisabledReason } : {})}
        {...(undoBusyPath ? { undoBusyPath } : {})}
        {...(redoBusyPath ? { redoBusyPath } : {})}
        {...(changedPaths ? { changedPaths } : {})}
        {...(undonePaths ? { undonePaths } : {})}
        {...(redoablePaths ? { redoablePaths } : {})}
      />
    )
  }
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
  // Until the reader clicks, the theme decides: a CLI theme prints shell output
  // under the row the way `claude` does, but never unrolls a file read.
  const open = picked ?? expandToolKinds.includes(view.kind)

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
        {expandable ? (
          <ChevronDown
            className={`chat-tool__chevron size-3 shrink-0 opacity-50 transition-transform duration-200 ${
              open ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          />
        ) : null}
        {running ? (
          <ActivityOrb
            state={orbStateForTool({ toolKind: view.kind, callRole: role })}
            live
            label={status === 'pending' ? 'pending' : 'running'}
          />
        ) : failed ? (
          <span className="shrink-0 text-ui-xs text-danger">failed</span>
        ) : status !== undefined ? (
          <Check className="size-3 shrink-0 text-muted-foreground/45" aria-label="completed" />
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
          onUndoFile={onUndoFile}
          onRedoFile={onRedoFile}
          undoDisabled={undoDisabled}
          undoDisabledReason={undoDisabledReason}
          undoBusyPath={undoBusyPath}
          redoBusyPath={redoBusyPath}
          changedPaths={changedPaths}
          undonePaths={undonePaths}
          redoablePaths={redoablePaths}
        />
      ) : null}
    </div>
  )
}
