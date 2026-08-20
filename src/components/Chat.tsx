/**
 * Run conversation UI.
 *
 * Renders the turn-by-turn transcript of a run and the follow-up composer.
 * Layout adapted from the t3code chat view (MIT, T3 Tools Inc.).
 */
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Square, Terminal } from 'lucide-react'
import type { ChatMessage } from '../server/core'
import type { ApprovalDecision } from '../lib/claudeControl'
import type { TurnEventPayload, TurnEventRow } from '../lib/turnEvents'
import { defaultEffort, defaultModel, findModel, type ModelOption } from '../lib/models'
import { formatChatTimestampTooltip, formatShortTimestamp } from '../lib/format'
import { useAnswerApproval } from '../lib/queries'
import { DEFAULT_RUNTIME_MODE, parseRuntimeMode, type RuntimeMode } from '../lib/runtimeMode'
import { usePickerPrefs } from '../lib/pickerPrefs'
import { resolvedApprovalIds } from '../lib/pendingApprovals'
import { supportsSupervised } from '../lib/supervisedPolicy'
import { ComposerModelControls } from './ComposerControls'
import { FilesChanged } from './FilesChanged'
import { MessageCopyButton } from './MessageCopyButton'
import { MessageSourceBadge } from './MessageSourceBadge'
import { PlanProposalsInChat } from './PlanProposalsInChat'
import { looksLikePlanProposalArray, parsePlanProposals } from '../lib/planProposals'
import {
  ApprovalEvent,
  CallEvent,
  ChatMarkdown,
  PlanEvent,
  ThoughtEvent,
  TurnFold,
  WorkGroup,
  WorkingIndicator,
} from './chat/index'
import { latestActivityLabel } from '../lib/turnActivity'
import { foldedRows, planTurnFold, type TurnFoldStage, type TurnRowKind } from '../lib/turnFold'

function isJsonlNoiseLine(line: string): boolean {
  const t = line.trim()
  if (!t.startsWith('{')) return false
  try {
    const obj = JSON.parse(t) as { type?: unknown }
    return typeof obj.type === 'string'
  } catch {
    return false
  }
}

/** True when stdout looks like CLI JSONL (hide the live dump; events render it). */
function looksLikeJsonlStdout(stdout: string): boolean {
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t) continue
    return isJsonlNoiseLine(t)
  }
  return false
}

function activityLogPreview(stdout: string, stderr: string): string {
  for (const line of `${stdout}\n${stderr}`.split('\n')) {
    if (!line.trim() || isJsonlNoiseLine(line)) continue
    return line.trim().slice(0, 80)
  }
  return 'Process log'
}

function ActivityLog({ stdout, stderr }: { stdout: string; stderr: string }) {
  const [open, setOpen] = useState(false)
  if (!stdout && !stderr) return null

  const preview = activityLogPreview(stdout, stderr)

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="group/activity flex w-full max-w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground"
      >
        <ChevronRight
          className={`size-3.5 shrink-0 opacity-70 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <Terminal className="size-3.5 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate">{open ? 'Process log' : preview}</span>
      </button>
      {open ? (
        <div className="mt-1 space-y-2 pl-6">
          {stdout ? (
            <pre className="scroll-thin max-h-72 overflow-auto rounded-lg border border-border bg-chrome/80 p-3 mono text-[11.5px] leading-relaxed text-muted-foreground">
              {stdout}
            </pre>
          ) : null}
          {stderr ? (
            <pre className="scroll-thin max-h-56 overflow-auto rounded-lg border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] p-3 mono text-[11.5px] leading-relaxed text-danger">
              {stderr}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function eventPayload(ev: TurnEventRow): TurnEventPayload {
  try {
    return JSON.parse(ev.payload) as TurnEventPayload
  } catch {
    return {}
  }
}

type TranscriptRow = { id: string; kind: TurnRowKind; node: ReactNode }

/**
 * Turn-event transcript rows.
 *
 * Tool / MCP / skill / sub-agent calls render through `components/chat`
 * (`CallEvent` + `.chat-event--*` CSS). Pairing a start with its result is
 * only needed to attach the output — appearance comes from `callRole` /
 * ACP fields on the event itself. Each row is tagged `text` (the agent's own
 * prose) or `work` so `planTurnFold` can hide the work of a settled turn.
 */
function turnRows({
  events,
  answering,
  onAnswer,
  onSelectFile,
}: {
  events: TurnEventRow[]
  answering?: boolean
  onAnswer?: (input: { requestId: string; optionId?: string; decision?: ApprovalDecision }) => void
  onSelectFile?: (path: string) => void
}): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  const push = (id: string, kind: TurnRowKind, node: ReactNode) => rows.push({ id, kind, node })
  let lastAssistant = ''
  const openCalls = new Map<string, TurnEventPayload>()
  const consumedResults = new Set<string>()
  // Shared with the mobile API so the two can never disagree about what is
  // still waiting on a human.
  const resolvedApprovals = resolvedApprovalIds(events)

  // Pre-index results so we can render a start+result pair at the start row.
  const resultByCallId = new Map<string, { id: string; payload: TurnEventPayload }>()
  for (const ev of events) {
    if (ev.kind !== 'tool_result') continue
    const payload = eventPayload(ev)
    const callId = payload.toolCallId
    if (!callId) continue
    resultByCallId.set(callId, { id: ev.id, payload })
  }

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!
    const payload = eventPayload(ev)
    if (ev.kind === 'assistant' && payload.text) {
      if (payload.text.trim() === lastAssistant.trim()) continue
      lastAssistant = payload.text
      push(
        ev.id,
        'text',
        <div className="min-w-0">
          <ChatMarkdown text={payload.text} {...(onSelectFile ? { onSelectFile } : {})} />
        </div>,
      )
    } else if (ev.kind === 'thought' && payload.text) {
      push(ev.id, 'work', <ThoughtEvent text={payload.text} />)
    } else if (ev.kind === 'plan' && payload.plan && payload.plan.length > 0) {
      push(ev.id, 'work', <PlanEvent plan={payload.plan} />)
    } else if (ev.kind === 'tool_start') {
      const callId = payload.toolCallId
      if (callId) openCalls.set(callId, payload)
      const paired = callId ? resultByCallId.get(callId) : undefined
      if (paired) consumedResults.add(paired.id)
      push(
        ev.id,
        'work',
        <CallEvent
          name={payload.name}
          title={payload.title}
          callRole={payload.callRole ?? paired?.payload.callRole}
          mcpServer={payload.mcpServer ?? paired?.payload.mcpServer}
          toolKind={payload.toolKind}
          // The settled status wins: it is the last thing the agent said about
          // this call. A start with no result yet keeps its own status. Rows
          // written before statuses existed have neither, so a paired result
          // still means completed — otherwise old turns would spin forever.
          status={paired ? (paired.payload.status ?? 'completed') : payload.status}
          input={payload.input}
          result={paired?.payload.content ?? ''}
          locations={paired?.payload.locations ?? payload.locations}
          onSelectFile={onSelectFile}
        />,
      )
    } else if (ev.kind === 'tool_result') {
      if (consumedResults.has(ev.id)) continue
      const callId = payload.toolCallId
      const opened = callId ? openCalls.get(callId) : undefined
      push(
        ev.id,
        'work',
        <CallEvent
          name={payload.name || opened?.name}
          title={payload.title || opened?.title}
          callRole={payload.callRole ?? opened?.callRole}
          mcpServer={payload.mcpServer ?? opened?.mcpServer}
          toolKind={payload.toolKind ?? opened?.toolKind}
          status={payload.status ?? 'completed'}
          input={opened?.input}
          result={payload.content || ''}
          locations={payload.locations}
          onSelectFile={onSelectFile}
        />,
      )
    } else if (ev.kind === 'error') {
      push(
        ev.id,
        'work',
        <div
          className="chat-event chat-event--error my-1.5 text-sm text-danger"
          data-chat-event="error"
        >
          {payload.message || 'Error'}
        </div>,
      )
    } else if (ev.kind === 'approval_request') {
      const requestId = payload.requestId || ''
      push(
        ev.id,
        'work',
        <ApprovalEvent
          title={payload.title || payload.name || 'tool'}
          name={payload.name}
          callRole={payload.callRole}
          mcpServer={payload.mcpServer}
          toolKind={payload.toolKind}
          requestId={requestId}
          options={payload.options ?? []}
          pending={Boolean(requestId) && !resolvedApprovals.has(requestId)}
          answering={Boolean(answering)}
          onAnswer={onAnswer}
        />,
      )
    } else if (ev.kind === 'approval_resolved') {
      push(
        ev.id,
        'work',
        <div className="my-1.5 text-sm text-tier-tertiary">
          Approval {payload.decision ?? 'resolved'}
          {payload.reason ? ` — ${payload.reason}` : ''}
        </div>,
      )
    } else if (ev.kind === 'raw' && payload.text) {
      // Fold consecutive raw lines into one block (plain / pretty-printed dumps).
      const rawLines = [payload.text]
      while (i + 1 < events.length) {
        const next = events[i + 1]!
        if (next.kind !== 'raw') break
        const nextText = eventPayload(next).text
        if (!nextText) break
        rawLines.push(nextText)
        i += 1
      }
      push(
        ev.id,
        'work',
        <pre
          className="chat-event chat-event--raw scroll-thin my-1.5 max-h-80 overflow-auto rounded-lg border border-border bg-chrome/80 p-2.5 mono text-[11px] text-muted-foreground"
          data-chat-event="raw"
        >
          {rawLines.join('\n')}
        </pre>,
      )
    } else if (
      ev.kind === 'turn_done' &&
      payload.result &&
      payload.result.trim() &&
      payload.result.trim() !== lastAssistant.trim()
    ) {
      push(
        ev.id,
        'text',
        <div className="min-w-0">
          <ChatMarkdown text={payload.result} {...(onSelectFile ? { onSelectFile } : {})} />
        </div>,
      )
    }
  }

  return rows
}

/**
 * Draws transcript rows, batching each run of consecutive tool rows so a long
 * stretch of them collapses behind one "+N previous tool calls" toggle.
 */
function TranscriptRows({ rows }: { rows: TranscriptRow[] }) {
  const groups: { id: string; kind: TurnRowKind; rows: TranscriptRow[] }[] = []
  for (const row of rows) {
    const last = groups.at(-1)
    if (row.kind === 'work' && last?.kind === 'work') last.rows.push(row)
    else groups.push({ id: row.id, kind: row.kind, rows: [row] })
  }

  return (
    <div className="space-y-1">
      {groups.map((group) =>
        group.kind === 'work' ? (
          <WorkGroup key={group.id} rows={group.rows} />
        ) : (
          <div key={group.id}>{group.rows[0]?.node}</div>
        ),
      )}
    </div>
  )
}

function MessageMeta({
  createdAt,
  content,
  extra,
  align = 'start',
}: {
  createdAt: number
  content: string
  extra?: ReactNode
  align?: 'start' | 'end'
}) {
  const short = formatShortTimestamp(createdAt)
  const tip = formatChatTimestampTooltip(createdAt)

  return (
    <div
      className={`flex items-center gap-1 text-xs tabular-nums opacity-0 transition-opacity duration-200 ${
        align === 'end' ? 'justify-end' : 'justify-start'
      } group-hover:opacity-100 group-focus-within:opacity-100 group-hover/assistant:opacity-100`}
    >
      <MessageCopyButton text={content} />
      <p className="text-muted-foreground text-xs tabular-nums" title={tip}>
        {short}
      </p>
      {extra}
    </div>
  )
}

const UserMessage = memo(function UserMessage({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false)
  const long = message.content.length > 400

  return (
    <div className="group flex flex-col items-end gap-1">
      <div className="relative max-w-[80%] rounded-[10px] border border-border bg-secondary px-3 py-2">
        <div
          className={`whitespace-pre-wrap text-sm leading-relaxed text-foreground ${
            long && !expanded ? 'line-clamp-6' : ''
          }`}
        >
          {message.content}
        </div>
        {long ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="mt-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : null}
      </div>
      <div className="flex w-full max-w-[80%] items-center justify-end gap-1.5 pe-1">
        <MessageMeta createdAt={message.createdAt} content={message.content} align="end" />
        <MessageSourceBadge
          provider={message.sourceProvider}
          url={message.sourceUrl}
          label={message.sourceLabel}
        />
      </div>
    </div>
  )
})

const AssistantMessage = memo(function AssistantMessage({
  message,
  activePath,
  answering,
  onAnswer,
  onSelectFile,
  runId,
  runtimeId,
  runTrigger,
  installWorkspaceId,
  installWorkspaceReady,
  installWorkspaceStatus,
  installProjectId,
  installProjectName,
  installWorkspaceLabel,
}: {
  message: ChatMessage
  activePath: string | null
  answering?: boolean
  onAnswer?: (input: { requestId: string; optionId?: string; decision?: ApprovalDecision }) => void
  onSelectFile: (path: string) => void
  runId: string
  runtimeId?: string
  runTrigger?: string
  installWorkspaceId?: string
  installWorkspaceReady?: boolean
  installWorkspaceStatus?: string | null
  installProjectId?: string
  installProjectName?: string | null
  installWorkspaceLabel?: string | null
}) {
  const [foldStage, setFoldStage] = useState<TurnFoldStage>('closed')
  const running = message.status === 'running'
  const hasEvents = message.events.length > 0
  // Planner / plain CLI dumps used to store one `raw` event per line while
  // `content` already held the real answer — prefer content in that case.
  const eventsAreRawDump =
    hasEvents &&
    message.events.every((e) => {
      if (e.kind === 'raw') return true
      if (e.kind !== 'turn_done') return false
      const result = eventPayload(e).result
      return !result?.trim()
    })
  const showContentOverRaw = Boolean(eventsAreRawDump && message.content.trim())
  const showEvents = hasEvents && !showContentOverRaw

  const planProposals =
    !running &&
    message.content &&
    (runTrigger === 'planner' || looksLikePlanProposalArray(message.content))
      ? parsePlanProposals(message.content)
      : []
  const showPlanCards = planProposals.length > 0 && Boolean(runtimeId)
  const activityLabel = running ? latestActivityLabel(message.events) : undefined
  // A turn whose events are all tool calls still has an answer — it just lives
  // on the message rather than in an `assistant` event (older rows, and CLIs
  // that only report their reply once, at the end).
  const eventsCarryText = message.events.some((e) => {
    if (e.kind === 'assistant') return Boolean(eventPayload(e).text?.trim())
    if (e.kind === 'turn_done') return Boolean(eventPayload(e).result?.trim())
    return false
  })
  const showContentAfterEvents =
    showEvents && !running && !eventsCarryText && Boolean(message.content.trim())

  const rows = showEvents
    ? turnRows({
        events: message.events,
        answering,
        ...(onAnswer ? { onAnswer } : {}),
        onSelectFile,
      })
    : []
  const fold = planTurnFold(rows, !running)
  const { visible: visibleRows, moreCount } = foldedRows(rows, fold, foldStage)

  return (
    <div className="group/assistant space-y-3">
      <div className="relative min-w-0 px-1 py-0.5">
        {showEvents ? (
          <>
            {fold.foldable ? (
              <TurnFold
                startedAt={message.createdAt}
                finishedAt={message.finishedAt}
                cancelled={message.status === 'cancelled'}
                expanded={foldStage !== 'closed'}
                onToggle={() => setFoldStage(foldStage === 'closed' ? 'partial' : 'closed')}
              />
            ) : null}
            {moreCount > 0 && foldStage !== 'closed' ? (
              <button
                type="button"
                aria-expanded={foldStage === 'all'}
                onClick={() => setFoldStage(foldStage === 'all' ? 'partial' : 'all')}
                className="mb-2 block cursor-pointer rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {foldStage === 'all' ? 'Hide' : 'Load'} {moreCount} earlier{' '}
                {moreCount === 1 ? 'step' : 'steps'}
              </button>
            ) : null}
            <TranscriptRows rows={visibleRows} />
            {showContentAfterEvents ? (
              <div className="mt-2">
                <ChatMarkdown text={message.content} onSelectFile={onSelectFile} />
              </div>
            ) : null}
          </>
        ) : showPlanCards && runtimeId ? (
          <PlanProposalsInChat
            proposals={planProposals}
            runtimeId={runtimeId}
            runId={runId}
            workspaceId={installWorkspaceId}
            workspaceReady={installWorkspaceReady}
            workspaceStatus={installWorkspaceStatus}
            projectId={installProjectId}
            projectName={installProjectName}
            workspaceLabel={installWorkspaceLabel}
          />
        ) : !running && message.content ? (
          <ChatMarkdown text={message.content} onSelectFile={onSelectFile} />
        ) : !running ? (
          <div className="text-sm text-muted-foreground/50">(empty response)</div>
        ) : null}

        {running ? (
          <WorkingIndicator
            startedAt={message.createdAt}
            {...(activityLabel ? { step: activityLabel } : {})}
          />
        ) : null}

        {running && !showEvents && message.stdout && !looksLikeJsonlStdout(message.stdout) ? (
          <pre className="scroll-thin mt-2 max-h-48 overflow-auto rounded-lg border border-border bg-chrome/80 p-3 mono text-[11.5px] leading-relaxed text-muted-foreground">
            {message.stdout.slice(-4000)}
          </pre>
        ) : null}

        {!running && (message.stderr || (!showEvents && !showContentOverRaw && !showPlanCards)) ? (
          <ActivityLog
            stdout={showEvents || showContentOverRaw || showPlanCards ? '' : message.stdout}
            stderr={message.stderr}
          />
        ) : null}

        {!running ? (
          <div className="mt-1.5">
            <MessageMeta
              createdAt={message.createdAt}
              content={message.content}
              extra={
                <>
                  {message.status === 'error' ? (
                    <span className="text-danger">exit {message.exitCode ?? '?'}</span>
                  ) : null}
                  {message.status === 'cancelled' ? (
                    <span className="text-warn">cancelled</span>
                  ) : null}
                </>
              }
            />
          </div>
        ) : null}
      </div>

      {!running && message.diffSummary.length > 0 ? (
        <FilesChanged files={message.diffSummary} activePath={activePath} onSelect={onSelectFile} />
      ) : null}
    </div>
  )
})

/** Stable-sized placeholder while conversation fetches — avoids layout jump. */
export function ChatBootSkeleton() {
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="scroll-thin flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-5">
        <div
          className="mx-auto w-full min-w-0 max-w-3xl space-y-4 pt-3 sm:pt-4"
          style={{ paddingBottom: 156 }}
        >
          <div className="flex flex-col items-end gap-1">
            <div className="h-14 w-[55%] max-w-[80%] animate-pulse rounded-[10px] border border-border bg-secondary/80" />
          </div>
          <div className="space-y-2 px-1">
            <div className="h-3 w-24 animate-pulse rounded bg-muted-foreground/10" />
            <div className="h-3 w-full max-w-md animate-pulse rounded bg-muted-foreground/10" />
            <div className="h-3 w-[85%] max-w-sm animate-pulse rounded bg-muted-foreground/10" />
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2">
        <div className="chat-composer-horizontal-inset relative z-10 isolate">
          <div className="mx-auto h-[140px] w-full max-w-3xl rounded-t-[20px] border border-border bg-elevated/80" />
          <div className="chat-composer-lower-chrome relative z-10 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-[calc(env(safe-area-inset-bottom)+1rem)]" />
        </div>
      </div>
    </div>
  )
}

export function Composer({
  disabled,
  disabledReason,
  placeholder,
  leading,
  pending,
  running,
  models,
  model,
  effort,
  runtimeMode,
  supportsSupervised,
  onModelChange,
  onEffortChange,
  onRuntimeModeChange,
  onSend,
  onStop,
}: {
  disabled: boolean
  disabledReason?: string
  /** Overrides the idle placeholder — e.g. the first message of a new chat. */
  placeholder?: string
  /** Extra pickers rendered left of the model controls (project/branch/runtime). */
  leading?: ReactNode
  pending: boolean
  running: boolean
  models: ModelOption[]
  model: string
  effort: string
  runtimeMode: RuntimeMode
  supportsSupervised?: boolean
  onModelChange: (slug: string) => void
  onEffortChange: (effort: string) => void
  onRuntimeModeChange: (mode: RuntimeMode) => void
  onSend: (text: string) => void
  onStop?: () => void
}) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  const submit = () => {
    const text = value.trim()
    if (!text || disabled || pending || running) return
    onSend(text)
    setValue('')
  }

  const canSend = !disabled && !pending && !running && value.trim().length > 0

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl pt-2 pl-2">
      <div className="rounded-[22px] p-px">
        <div
          className={`chat-composer-glass rounded-[20px] border transition-[background-color,border-color] duration-200 focus-within:border-ring/45 ${
            disabled ? 'border-border opacity-75' : 'border-border'
          }`}
        >
          <div className="relative px-3 pb-2 pt-3 sm:px-3.5 sm:pt-3.5">
            <textarea
              ref={ref}
              rows={1}
              value={value}
              disabled={disabled || running}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder={
                running
                  ? 'Agent is working…'
                  : disabled
                    ? (disabledReason ?? 'Follow-up unavailable')
                    : (placeholder ?? 'Ask for follow-up changes…')
              }
              className="block max-h-[200px] min-h-[3.25rem] w-full resize-none overflow-y-auto bg-transparent text-[16px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/35 disabled:cursor-not-allowed sm:text-[14px]"
            />
          </div>

          <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2 px-2 pb-2 sm:px-2.5 sm:pb-2.5">
            {leading}
            <ComposerModelControls
              models={models}
              model={model}
              effort={effort}
              runtimeMode={runtimeMode}
              disabled={pending || running}
              supportsSupervised={supportsSupervised}
              onModelChange={onModelChange}
              onEffortChange={onEffortChange}
              onRuntimeModeChange={onRuntimeModeChange}
            />

            {running && onStop ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop"
                title="Stop"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-danger/90 text-white transition-colors hover:bg-danger"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSend}
                onClick={submit}
                aria-label={pending ? 'Sending' : 'Send message'}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/90 text-primary-foreground transition-colors enabled:cursor-pointer enabled:hover:bg-primary disabled:pointer-events-none disabled:opacity-30"
              >
                {pending ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path
                      d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function Chat({
  messages,
  activePath,
  canFollowUp,
  followUpReason,
  pending,
  running,
  models,
  runId,
  runtimeId,
  runtimeBin,
  runtimeTransport,
  runTrigger,
  installWorkspaceId,
  installWorkspaceReady,
  installWorkspaceStatus,
  installProjectId,
  installProjectName,
  installWorkspaceLabel,
  initialModel,
  initialEffort,
  initialRuntimeMode,
  onSelectFile,
  onSend,
  onStop,
}: {
  messages: ChatMessage[]
  activePath: string | null
  canFollowUp: boolean
  followUpReason?: string
  pending: boolean
  running: boolean
  models: ModelOption[]
  /** Run id — required for supervised Allow/Deny. */
  runId: string
  /** Runtime this run executed on; scopes the remembered model/effort. */
  runtimeId?: string
  /** Binary name — used with the transport to gate Supervised mode. */
  runtimeBin?: string
  /** 'cli' or 'acp'; ACP runtimes can always be supervised. */
  runtimeTransport?: string
  /** e.g. planner — drives proposal install cards in chat. */
  runTrigger?: string
  /** Planner install target (from the run row). */
  installWorkspaceId?: string
  installWorkspaceReady?: boolean
  installWorkspaceStatus?: string | null
  installProjectId?: string
  installProjectName?: string | null
  installWorkspaceLabel?: string | null
  initialModel: string
  initialEffort: string
  initialRuntimeMode?: string
  onSelectFile: (path: string) => void
  onSend: (input: {
    prompt: string
    model: string
    effort: string
    runtimeMode: RuntimeMode
  }) => void
  onStop?: () => void
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const { remember } = usePickerPrefs()
  const [composerHeight, setComposerHeight] = useState(140)
  const composerOverlayRef = useRef<HTMLDivElement | null>(null)
  const [model, setModel] = useState(initialModel)
  const [effort, setEffort] = useState(initialEffort)
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(
    parseRuntimeMode(initialRuntimeMode ?? DEFAULT_RUNTIME_MODE),
  )
  const canSupervise = supportsSupervised({ bin: runtimeBin, transport: runtimeTransport })
  const answerApproval = useAnswerApproval(runId)

  useEffect(() => {
    setModel(initialModel)
    setEffort(initialEffort)
    setRuntimeMode(parseRuntimeMode(initialRuntimeMode ?? DEFAULT_RUNTIME_MODE))
  }, [initialModel, initialEffort, initialRuntimeMode])

  useEffect(() => {
    if (models.length === 0) return
    if (findModel(models, model)) return
    const next = defaultModel(models)
    if (!next) return
    setModel(next.slug)
    setEffort(defaultEffort(next))
  }, [models, model])

  // The transcript keeps growing after mount and while a turn streams, so stay
  // pinned to the bottom on every resize rather than scrolling once per message.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current
    if (!scroller || !content) return
    const pin = () => {
      if (!pinnedRef.current) return
      scroller.scrollTop = scroller.scrollHeight
    }
    const onScroll = () => {
      pinnedRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60
    }
    pin()
    const observer = new ResizeObserver(pin)
    observer.observe(content)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [])

  useEffect(() => {
    const el = composerOverlayRef.current
    if (!el) return
    const update = () => setComposerHeight(Math.ceil(el.getBoundingClientRect().height))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // The run keeps its own model/effort/mode; changing a picker here also
  // records it as the last-used default for future new chats and automations.
  const handleModelChange = (slug: string) => {
    setModel(slug)
    const nextEffort = defaultEffort(findModel(models, slug))
    setEffort(nextEffort)
    remember({ runtimeId, forRuntimeId: runtimeId, model: slug, effort: nextEffort })
  }
  const handleEffortChange = (value: string) => {
    setEffort(value)
    remember({ runtimeId, forRuntimeId: runtimeId, effort: value })
  }
  const handleRuntimeModeChange = (mode: RuntimeMode) => {
    setRuntimeMode(mode)
    remember({ runtimeMode: mode })
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={scrollerRef}
        className="scroll-thin flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-5"
      >
        <div
          ref={contentRef}
          className="mx-auto w-full min-w-0 max-w-3xl space-y-4 pt-3 sm:pt-4"
          style={{ paddingBottom: composerHeight + 16 }}
        >
          {messages.map((message) =>
            message.role === 'system' ? (
              <p key={message.id} className="text-ui-sm text-tier-quaternary">
                {message.content}
              </p>
            ) : message.role === 'user' ? (
              <UserMessage key={message.id} message={message} />
            ) : (
              <AssistantMessage
                key={message.id}
                message={message}
                activePath={activePath}
                answering={answerApproval.isPending}
                onAnswer={(input) => answerApproval.mutate(input)}
                onSelectFile={onSelectFile}
                runId={runId}
                runtimeId={runtimeId}
                runTrigger={runTrigger}
                installWorkspaceId={installWorkspaceId}
                installWorkspaceReady={installWorkspaceReady}
                installWorkspaceStatus={installWorkspaceStatus}
                installProjectId={installProjectId}
                installProjectName={installProjectName}
                installWorkspaceLabel={installWorkspaceLabel}
              />
            ),
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div
        ref={composerOverlayRef}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2"
      >
        <div
          aria-hidden="true"
          className="chat-composer-horizontal-inset pointer-events-none absolute inset-x-0 top-1.5 bottom-0 z-0 sm:top-2"
        >
          <div className="relative mx-auto h-full w-full max-w-3xl overflow-clip rounded-t-[20px]">
            <div className="chat-composer-shared-blur absolute -inset-8" />
          </div>
        </div>

        <div className="chat-composer-horizontal-inset pointer-events-auto relative z-10 isolate">
          <Composer
            disabled={!canFollowUp && !running}
            disabledReason={followUpReason}
            pending={pending}
            running={running}
            models={models}
            model={model}
            effort={effort}
            runtimeMode={runtimeMode}
            supportsSupervised={canSupervise}
            onModelChange={handleModelChange}
            onEffortChange={handleEffortChange}
            onRuntimeModeChange={handleRuntimeModeChange}
            onStop={onStop}
            onSend={(text) => onSend({ prompt: text, model, effort, runtimeMode })}
          />
          <div className="chat-composer-lower-chrome relative z-10 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-[calc(env(safe-area-inset-bottom)+1rem)]" />
        </div>
      </div>
    </div>
  )
}
