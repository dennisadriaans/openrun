import {
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Plus,
  Settings,
  Timer,
  Trash2,
  Webhook,
  Zap,
} from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { invalidCronMessage, isValidCron } from '../lib/cron'
import { DEFAULT_RUN_TIMEOUT_MS } from '../lib/runBudget'
import { MAX_REPAIR_ATTEMPTS } from '../lib/verdict'
import { defaultEffort, defaultModel, findModel, modelsForBin } from '../lib/models'
import { pickerPrefForRuntime, usePickerPrefs } from '../lib/pickerPrefs'
import {
  useProjects,
  useRuntimes,
  useSaveTask,
  useWorkspaces,
  useIntegrations,
  useIntegrationProviders,
  useProjectBranches,
  useCreateWorkspace,
} from '../lib/queries'
import { parsePendingGitBranchId, projectBranchChoices } from '../lib/gitBranches'
import {
  HOURLY_MINUTES,
  HOUR_TIMES,
  WEEKDAYS,
  buildCron,
  formatNextRunLabel,
  formatTime,
  formatTimezoneOffset,
  parseSchedule,
  scheduleLeadIn,
  type ParsedSchedule,
} from '../lib/schedule'
import { pickDefaultRuntime } from '../lib/pickRuntime'
import { pickDefaultWorkspace } from '../lib/pickWorkspace'
import { invalidTriggerEditorSeed } from '../lib/scheduleHealth'
import { emptyTaskPromptMessage, hasTaskPrompt } from '../lib/taskPrompt'
import { workspaceBlockedReason } from '../lib/runPrereqGate'
import { hasWorkspaceId, missingWorkspaceMessage } from '../lib/workspaceRef'
import { isWorkspaceReady, workspaceNotReadyMessage } from '../lib/workspaceReady'
import { missingRuntimeBinaryMessage } from '../lib/runtimeBinary'
import { AddProjectModal } from './AddProjectModal'
import {
  EffortPicker,
  ModelPicker,
  ProjectPicker,
  RuntimePicker,
  BranchPicker,
} from './ComposerControls'
import { ActiveToggle, Button, inputClass } from './ui'

const SCHEDULE_OPTIONS: Array<{
  label: string
  value: string | 'custom'
  icon: ReactNode
}> = [
  { label: 'Hourly', value: '0 * * * *', icon: <Timer className="h-3.5 w-3.5" /> },
  { label: 'Daily', value: '0 9 * * *', icon: <Calendar className="h-3.5 w-3.5" /> },
  { label: 'Weekly', value: '0 9 * * 1', icon: <CalendarDays className="h-3.5 w-3.5" /> },
  { label: 'Custom (cron)', value: 'custom', icon: <Code2 className="h-3.5 w-3.5" /> },
]

function useClickOutside(
  open: boolean,
  onClose: () => void,
  refs: Array<RefObject<HTMLElement | null>>,
) {
  const refsRef = useRef(refs)
  refsRef.current = refs

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node
      if (refsRef.current.some((ref) => ref.current?.contains(target))) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
}

function ChipSelect({
  label,
  ariaLabel,
  options,
  value,
  onChange,
}: {
  label: string
  ariaLabel: string
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  useClickOutside(open, () => setOpen(false), [triggerRef, menuRef])

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setCoords(null)
      return
    }
    const update = () => {
      const button = buttonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      const menuWidth = 128
      setCoords({
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  return (
    <div ref={triggerRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-[var(--bg-quaternary)] px-2 text-ui-base text-foreground transition-colors hover:bg-hover"
      >
        <span className="mono">{label}</span>
        <ChevronDown className="h-3 w-3 text-tier-quaternary" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={{
                position: 'fixed',
                top: coords?.top ?? 0,
                left: coords?.left ?? 0,
                zIndex: 200,
                visibility: coords ? 'visible' : 'hidden',
              }}
              className="max-h-56 min-w-28 overflow-auto rounded-lg border border-border bg-elevated p-1 shadow-xl shadow-black/40"
            >
              {options.map((opt) => {
                const selected = opt.value === value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(opt.value)
                      setOpen(false)
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-ui-base transition-colors ${
                      selected
                        ? 'bg-hover text-foreground'
                        : 'text-foreground/85 hover:bg-hover hover:text-foreground'
                    }`}
                  >
                    <span className="mono min-w-0 flex-1">{opt.label}</span>
                    {selected ? <Check className="h-3 w-3 shrink-0 text-tier-secondary" /> : null}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

function ScheduleTriggerRow({
  cron,
  onChange,
  onRemove,
}: {
  cron: string
  onChange: (cron: string) => void
  onRemove: () => void
}) {
  const schedule = useMemo(() => parseSchedule(cron), [cron])
  const tz = useMemo(() => formatTimezoneOffset(), [])
  const nextRun = useMemo(() => formatNextRunLabel(cron), [cron])

  const setSchedule = (next: ParsedSchedule) => onChange(buildCron(next))

  const timeOptions = HOUR_TIMES.map((t) => ({
    value: formatTime(t.hour, t.minute),
    label: t.label,
  }))

  const minuteOptions = HOURLY_MINUTES.map((m) => ({
    value: String(m),
    label: `:${String(m).padStart(2, '0')}`,
  }))

  const dayOptions = WEEKDAYS.map((d) => ({
    value: String(d.dow),
    label: d.label,
  }))

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-elevated px-3.5 py-2.5">
      <Clock className="h-3.5 w-3.5 shrink-0 text-tier-secondary" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
        {schedule.kind === 'custom' ? (
          <>
            <span className="text-ui-base text-foreground">{scheduleLeadIn(schedule)}</span>
            <span className="mono text-ui-sm text-tier-quaternary">{cron}</span>
            <span className="text-ui-base text-foreground">{tz}</span>
            {nextRun ? <span className="text-ui-sm text-tier-quaternary">{nextRun}</span> : null}
          </>
        ) : (
          <>
            {schedule.kind === 'weekly' ? (
              <>
                <span className="text-ui-base text-foreground">Every week on</span>
                <ChipSelect
                  ariaLabel="Day of week"
                  label={WEEKDAYS.find((d) => d.dow === schedule.dow)?.label ?? 'Monday'}
                  value={String(schedule.dow)}
                  options={dayOptions}
                  onChange={(value) => setSchedule({ ...schedule, dow: Number(value) })}
                />
                <span className="text-ui-base text-foreground">at</span>
              </>
            ) : (
              <span className="text-ui-base text-foreground">{scheduleLeadIn(schedule)}</span>
            )}

            {schedule.kind === 'hourly' ? (
              <ChipSelect
                ariaLabel="Minute past the hour"
                label={`:${String(schedule.minute).padStart(2, '0')}`}
                value={String(schedule.minute)}
                options={minuteOptions}
                onChange={(value) => setSchedule({ kind: 'hourly', minute: Number(value) })}
              />
            ) : (
              <ChipSelect
                ariaLabel="Time of day"
                label={formatTime(schedule.hour, schedule.minute)}
                value={formatTime(schedule.hour, schedule.minute)}
                options={
                  timeOptions.some((o) => o.value === formatTime(schedule.hour, schedule.minute))
                    ? timeOptions
                    : [
                        {
                          value: formatTime(schedule.hour, schedule.minute),
                          label: formatTime(schedule.hour, schedule.minute),
                        },
                        ...timeOptions,
                      ]
                }
                onChange={(value) => {
                  const [h, m] = value.split(':').map(Number)
                  setSchedule({
                    ...schedule,
                    hour: h ?? 0,
                    minute: m ?? 0,
                  })
                }}
              />
            )}

            <span className="text-ui-base text-foreground">{tz}</span>
            {nextRun ? <span className="text-ui-sm text-tier-quaternary">{nextRun}</span> : null}
          </>
        )}
      </div>
      <button
        type="button"
        aria-label="Remove trigger"
        onClick={onRemove}
        className="shrink-0 rounded-md p-1.5 text-tier-quaternary hover:bg-hover hover:text-foreground"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function TriggerAddMenu({
  onPickPreset,
  onCustom,
  onRunOnce,
  onWebhook,
}: {
  onPickPreset: (cron: string) => void
  onCustom: () => void
  onRunOnce: () => void
  onWebhook: () => void
}) {
  const [open, setOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const scheduledItemRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const [subCoords, setSubCoords] = useState<{ top: number; left: number } | null>(null)

  const closeAll = () => {
    setOpen(false)
    setScheduleOpen(false)
  }

  useClickOutside(open, closeAll, [triggerRef, menuRef, submenuRef])

  useEffect(() => {
    if (!open) setScheduleOpen(false)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setCoords(null)
      return
    }
    const update = () => {
      const button = buttonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      setCoords({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 220)),
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!scheduleOpen || !scheduledItemRef.current) {
      setSubCoords(null)
      return
    }
    const update = () => {
      const item = scheduledItemRef.current
      if (!item) return
      const rect = item.getBoundingClientRect()
      const submenuWidth = 180
      const spaceRight = window.innerWidth - rect.right
      const openLeft = spaceRight < submenuWidth + 8
      setSubCoords({
        top: rect.top,
        left: openLeft ? rect.left - submenuWidth - 4 : rect.right + 4,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [scheduleOpen])

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const openSchedule = () => {
    clearCloseTimer()
    setScheduleOpen(true)
  }

  const deferCloseSchedule = () => {
    clearCloseTimer()
    closeTimer.current = setTimeout(() => setScheduleOpen(false), 120)
  }

  useEffect(() => () => clearCloseTimer(), [])

  const pick = (value: string | 'custom') => {
    closeAll()
    if (value === 'custom') onCustom()
    else onPickPreset(value)
  }

  return (
    <div ref={triggerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-3.5 py-2.5 text-left text-ui-base text-tier-tertiary transition-colors hover:bg-hover hover:text-tier-secondary"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Trigger
      </button>
      {open
        ? createPortal(
            <>
              <div
                ref={menuRef}
                role="menu"
                style={{
                  position: 'fixed',
                  top: coords?.top ?? 0,
                  left: coords?.left ?? 0,
                  zIndex: 200,
                  visibility: coords ? 'visible' : 'hidden',
                }}
                className="min-w-52 overflow-hidden rounded-xl border border-border bg-elevated p-1 shadow-xl shadow-black/40"
              >
                <button
                  ref={scheduledItemRef}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={scheduleOpen}
                  onMouseEnter={openSchedule}
                  onMouseLeave={deferCloseSchedule}
                  onFocus={openSchedule}
                  onClick={openSchedule}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ui-base transition-colors ${
                    scheduleOpen
                      ? 'bg-hover text-foreground'
                      : 'text-foreground/85 hover:bg-hover hover:text-foreground'
                  }`}
                >
                  <Clock className="h-3.5 w-3.5 shrink-0 text-tier-secondary" />
                  <span className="min-w-0 flex-1">Scheduled</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-tier-quaternary" />
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onMouseEnter={deferCloseSchedule}
                  onClick={() => {
                    closeAll()
                    onRunOnce()
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ui-base text-foreground/85 transition-colors hover:bg-hover hover:text-foreground"
                >
                  <Zap className="h-3.5 w-3.5 shrink-0 text-tier-secondary" />
                  <span className="min-w-0 flex-1">Run once</span>
                  <span className="shrink-0 text-ui-sm text-tier-quaternary">test</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onMouseEnter={deferCloseSchedule}
                  onClick={() => {
                    closeAll()
                    onWebhook()
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ui-base text-foreground/85 transition-colors hover:bg-hover hover:text-foreground"
                >
                  <Webhook className="h-3.5 w-3.5 shrink-0 text-tier-secondary" />
                  <span className="min-w-0 flex-1">Webhook</span>
                  <span className="shrink-0 text-ui-sm text-tier-quaternary">
                    GitHub · Jira · Linear
                  </span>
                </button>
              </div>
              {scheduleOpen ? (
                <div
                  ref={submenuRef}
                  role="menu"
                  onMouseEnter={openSchedule}
                  onMouseLeave={deferCloseSchedule}
                  style={{
                    position: 'fixed',
                    top: subCoords?.top ?? 0,
                    left: subCoords?.left ?? 0,
                    zIndex: 201,
                    visibility: subCoords ? 'visible' : 'hidden',
                  }}
                  className="min-w-44 overflow-hidden rounded-xl border border-border bg-elevated p-1 shadow-xl shadow-black/40"
                >
                  {SCHEDULE_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      role="menuitem"
                      onClick={() => pick(opt.value)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ui-base text-foreground/85 transition-colors hover:bg-hover hover:text-foreground"
                    >
                      <span className="shrink-0 text-tier-secondary">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </>,
            document.body,
          )
        : null}
    </div>
  )
}

export type TaskFormValues = {
  id?: string
  name: string
  description: string
  runtimeId: string
  prompt: string
  workspaceId: string
  cron: string
  enabled: boolean
  /** Persisted model slug for an existing task (empty for a fresh form). */
  model?: string
  /** Persisted effort/thinking level for an existing task. */
  effort?: string
  webhookIntegrationId?: string
  webhookEvents?: string[]
  webhookFilters?: {
    labels?: string[]
    projects?: string[]
    statuses?: string[]
    previousStatuses?: string[]
    assignees?: string[]
  }
  /** Run the project's verification checks after each turn. */
  verifyEnabled?: number
  /** Repair turns allowed when blocking checks fail. */
  maxRepairAttempts?: number
  /** Wall-clock budget in ms; 0 = the app default. */
  timeoutMs?: number
}

const empty: TaskFormValues = {
  name: '',
  description: '',
  // Seeded once runtimes load via pickDefaultRuntime (installed CLI).
  runtimeId: '',
  prompt: '',
  workspaceId: '',
  cron: '',
  enabled: false,
  webhookIntegrationId: '',
  webhookEvents: [],
  webhookFilters: {},
  verifyEnabled: 1,
  maxRepairAttempts: 1,
  timeoutMs: 0,
}

function WebhookTriggerRow({
  integrationId,
  events,
  filters,
  onIntegrationChange,
  onEventsChange,
  onFiltersChange,
  onRemove,
}: {
  integrationId: string
  events: string[]
  filters: TaskFormValues['webhookFilters']
  onIntegrationChange: (id: string) => void
  onEventsChange: (events: string[]) => void
  onFiltersChange: (filters: NonNullable<TaskFormValues['webhookFilters']>) => void
  onRemove: () => void
}) {
  const { data: integrations } = useIntegrations()
  const { data: providers } = useIntegrationProviders()
  const selected = integrations?.find((i) => i.id === integrationId)
  const catalog = providers?.find((p) => p.id === selected?.provider)
  const enabledIntegrations = (integrations ?? []).filter((i) => i.enabled)

  return (
    <div className="space-y-2 rounded-xl border border-border bg-elevated px-3.5 py-2.5">
      <div className="flex items-start gap-2">
        <Webhook className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tier-secondary" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="text-ui-base text-foreground">Webhook</div>
            <div className="text-ui-sm text-tier-quaternary">
              Fires when a connected provider delivers a matching event.
            </div>
          </div>
          {enabledIntegrations.length === 0 ? (
            <p className="text-[12px] text-amber-200/90">
              No connections yet.{' '}
              <a href="/integrations" className="underline-offset-2 hover:underline">
                Add GitHub, Jira, or Linear
              </a>{' '}
              first.
            </p>
          ) : (
            <select
              className={inputClass}
              value={integrationId}
              onChange={(e) => onIntegrationChange(e.target.value)}
              aria-label="Webhook connection"
            >
              <option value="">Select connection…</option>
              {enabledIntegrations.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.providerLabel})
                </option>
              ))}
            </select>
          )}
          {catalog ? (
            <div className="flex flex-wrap gap-1.5">
              {catalog.events.map((ev) => {
                const on = events.length === 0 || events.includes(ev.id)
                const explicit = events.includes(ev.id)
                return (
                  <button
                    key={ev.id}
                    type="button"
                    title={ev.description ?? ev.id}
                    onClick={() => {
                      if (events.length === 0) {
                        // Leaving [] means "all". First click narrows to everything
                        // except this one, or to only this one — prefer toggle-on list.
                        onEventsChange([ev.id])
                        return
                      }
                      if (explicit) {
                        const next = events.filter((id) => id !== ev.id)
                        onEventsChange(next)
                      } else {
                        onEventsChange([...events, ev.id])
                      }
                    }}
                    className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                      on && (events.length === 0 || explicit)
                        ? 'bg-[var(--bg-primary)] text-foreground'
                        : 'text-tier-quaternary hover:bg-hover hover:text-tier-secondary'
                    }`}
                  >
                    {ev.label}
                  </button>
                )
              })}
              {events.length > 0 ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-[11px] text-tier-tertiary hover:bg-hover"
                  onClick={() => onEventsChange([])}
                >
                  All events
                </button>
              ) : (
                <span className="px-2 py-1 text-[11px] text-tier-quaternary">All events</span>
              )}
            </div>
          ) : null}
          <label className="block space-y-1">
            <span className="text-[11px] text-tier-quaternary">Assignees (optional)</span>
            <input
              className={inputClass}
              value={(filters?.assignees ?? []).join(', ')}
              onChange={(e) => {
                const assignees = e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                onFiltersChange({ ...filters, assignees: assignees.length ? assignees : undefined })
              }}
              placeholder="Ada, Bob — empty means anyone"
            />
          </label>
          <p className="text-[11px] leading-relaxed text-tier-quaternary">
            Prompt placeholders: {'{{issue.title}}'}, {'{{issue.body}}'}, {'{{issue.key}}'},{' '}
            {'{{issue.status}}'}, {'{{issue.previousStatus}}'}, {'{{event.type}}'}. Without
            placeholders, issue context is appended automatically.
          </p>
        </div>
        <button
          type="button"
          aria-label="Remove webhook trigger"
          onClick={onRemove}
          className="shrink-0 rounded-md p-1.5 text-tier-quaternary hover:bg-hover hover:text-foreground"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function StepLabel({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-ui-sm text-tier-tertiary">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-primary)] text-[11px] font-medium text-tier-secondary">
        {n}
      </span>
      <span>{children}</span>
    </div>
  )
}

export function TaskForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Partial<TaskFormValues>
  onSaved: (id: string) => void
  onCancel: () => void
}) {
  const { data: runtimes } = useRuntimes()
  const { data: projects } = useProjects()
  const save = useSaveTask()
  const { prefs, remember } = usePickerPrefs()
  // A brand-new automation seeds its pickers from the last-used selections; an
  // existing task keeps whatever runtime/model it was saved with.
  const isNew = !initial?.id
  // Legacy rows may still carry a cron that save/enable would reject — open the
  // custom trigger editor on that draft so Edit can repair it instead of
  // rendering the junk as a healthy schedule row.
  const triggerSeed = invalidTriggerEditorSeed(initial?.cron)
  const [v, setV] = useState<TaskFormValues>(() => ({
    ...empty,
    ...(isNew && prefs.runtimeId ? { runtimeId: prefs.runtimeId } : {}),
    ...initial,
    cron: triggerSeed.cron,
  }))
  const [projectId, setProjectId] = useState('')
  const [addingTrigger, setAddingTrigger] = useState(triggerSeed.addingTrigger)
  // "Run once" is a manual trigger (no schedule). It carries no cron, so we
  // track it as its own visual selection to show a trigger row for it. An
  // existing task with no cron is manual — seed the row so edits reflect it.
  const [runOnce, setRunOnce] = useState(
    () =>
      Boolean(initial?.id) &&
      !initial?.cron?.trim() &&
      !initial?.webhookIntegrationId?.trim() &&
      !triggerSeed.showInvalid,
  )
  const [webhookEnabled, setWebhookEnabled] = useState(() =>
    Boolean(initial?.webhookIntegrationId?.trim()),
  )
  const [triggerDraft, setTriggerDraft] = useState(triggerSeed.triggerDraft)
  const [triggerError, setTriggerError] = useState<string | null>(() =>
    triggerSeed.showInvalid ? invalidCronMessage(triggerSeed.triggerDraft) : null,
  )
  // Editing an existing task starts from its saved model/effort; a new task
  // seeds from the last-used pickers below.
  const [model, setModel] = useState(initial?.model ?? '')
  const [effort, setEffort] = useState(initial?.effort ?? '')
  const [verifyEnabled, setVerifyEnabled] = useState((initial?.verifyEnabled ?? 1) !== 0)
  const [repairAttempts, setRepairAttempts] = useState(initial?.maxRepairAttempts ?? 1)
  const [timeoutMinutes, setTimeoutMinutes] = useState(
    initial?.timeoutMs ? Math.round(initial.timeoutMs / 60_000) : 0,
  )
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [promptError, setPromptError] = useState<string | null>(null)
  const [showAddProject, setShowAddProject] = useState(false)
  const [showVerificationSettings, setShowVerificationSettings] = useState(false)

  const { data: allWorkspaces } = useWorkspaces()
  const { data: projectWorkspaces } = useWorkspaces(projectId || undefined)
  const { data: gitBranches } = useProjectBranches(projectId || undefined)
  const createWorkspace = useCreateWorkspace()

  useEffect(() => {
    if (!v.workspaceId || projectId) return
    const ws = allWorkspaces?.find((w) => w.id === v.workspaceId)
    if (ws) setProjectId(ws.projectId)
  }, [allWorkspaces, v.workspaceId, projectId])

  useEffect(() => {
    if (!runtimes?.length) return
    // Keep a still-valid selection (user pick, prefs, or saved task).
    if (v.runtimeId && runtimes.some((r) => r.id === v.runtimeId)) return
    // Missing / deleted / not-yet-seeded: last-used → installed → first.
    const next = pickDefaultRuntime(runtimes, isNew ? prefs.runtimeId : undefined)
    if (next) setV((prev) => ({ ...prev, runtimeId: next.id }))
  }, [runtimes, v.runtimeId, isNew, prefs.runtimeId])

  const runtime = runtimes?.find((r) => r.id === v.runtimeId) ?? runtimes?.[0]
  const models = useMemo(() => (runtime ? modelsForBin(runtime.bin) : []), [runtime])

  // Re-seed model/effort whenever the active runtime's catalog changes, pulling
  // the last-used choice for that runtime before falling back to the default.
  const seededRuntimeRef = useRef<string | null>(null)
  useEffect(() => {
    if (models.length === 0) {
      setModel('')
      setEffort('')
      seededRuntimeRef.current = v.runtimeId
      return
    }
    const alreadySeeded = seededRuntimeRef.current === v.runtimeId
    const remembered = pickerPrefForRuntime(prefs, v.runtimeId)
    // On the very first seed of an existing task, keep the model/effort it was
    // saved with (still in `model`/`effort` from initial) so editing never
    // silently swaps the picked model out from under the user.
    const savedModel = !alreadySeeded && !isNew ? findModel(models, model) : undefined
    const current = alreadySeeded ? findModel(models, model) : undefined
    const selected =
      savedModel ?? current ?? findModel(models, remembered.model) ?? defaultModel(models)
    if (!selected) return
    if (selected.slug !== model) setModel(selected.slug)
    if (savedModel) {
      // Preserve the saved effort as-is (may legitimately be empty for thinking).
    } else if (!alreadySeeded) {
      setEffort(remembered.effort || defaultEffort(selected))
    } else if (!effort) {
      setEffort(defaultEffort(selected))
    }
    seededRuntimeRef.current = v.runtimeId
    // Prefs are read once per runtime switch; excluding them keeps the seed stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, model, effort, v.runtimeId])

  const changeRuntimeId = (id: string) => {
    seededRuntimeRef.current = null
    set('runtimeId', id)
    remember({ runtimeId: id })
  }
  const changeModel = (slug: string) => {
    setModel(slug)
    const nextEffort = defaultEffort(findModel(models, slug))
    setEffort(nextEffort)
    remember({ forRuntimeId: v.runtimeId, model: slug, effort: nextEffort })
  }
  const changeEffort = (value: string) => {
    setEffort(value)
    remember({ forRuntimeId: v.runtimeId, effort: value })
  }

  const set = <K extends keyof TaskFormValues>(k: K, val: TaskFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: val }))

  const selectProject = (pid: string) => {
    setProjectId(pid)
    setWorkspaceError(null)
    if (!pid) {
      set('workspaceId', '')
      return
    }
    const list = (allWorkspaces ?? []).filter((w) => w.projectId === pid)
    set('workspaceId', pickDefaultWorkspace(list)?.id ?? '')
  }

  const branchChoices = useMemo(
    () =>
      projectBranchChoices({
        gitBranches: gitBranches ?? [],
        workspaces: (projectWorkspaces ?? []).map((w) => ({
          id: w.id,
          branch: w.branch,
          kind: w.kind,
          status: w.status,
          activeRunId: w.activeRunId,
        })),
      }),
    [gitBranches, projectWorkspaces],
  )

  const selectBranch = async (id: string) => {
    setWorkspaceError(null)
    const pending = parsePendingGitBranchId(id)
    if (!pending) {
      set('workspaceId', id)
      return
    }
    if (!projectId) return
    const gitRow = (gitBranches ?? []).find((b) => b.name === pending)
    try {
      const ws = await createWorkspace.mutateAsync({
        projectId,
        branch: pending,
        fromBranch: pending,
        useExistingBranch: gitRow ? !gitRow.remote : true,
      })
      set('workspaceId', ws.id)
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    if (!projectId || v.workspaceId) return
    const picked = pickDefaultWorkspace(projectWorkspaces ?? [])
    if (picked) set('workspaceId', picked.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projectWorkspaces])

  // Validate + save. Returns the saved task, or null when validation blocked
  // the write (errors are surfaced inline). Shared by Create/Save and "Run once".
  const persist = async (): Promise<{ id: string; name: string } | null> => {
    const cron = v.cron.trim()
    if (!isValidCron(cron)) {
      setTriggerError(invalidCronMessage(cron))
      set('cron', '')
      setTriggerDraft(cron)
      setAddingTrigger(true)
      return null
    }
    if (!hasWorkspaceId(v.workspaceId)) {
      setWorkspaceError(missingWorkspaceMessage())
      return null
    }
    const selectedWs = (allWorkspaces ?? []).find((w) => w.id === v.workspaceId)
    if (!selectedWs || !isWorkspaceReady(selectedWs.status)) {
      setWorkspaceError(workspaceNotReadyMessage(selectedWs?.status))
      return null
    }
    if (!hasTaskPrompt(v.prompt)) {
      setPromptError(emptyTaskPromptMessage())
      return null
    }
    if (v.enabled && !runtime?.installed) {
      setWorkspaceError(null)
      setPromptError(null)
      // Same message as the form warning / Run now — refuse Active+save so the
      // schedule is never armed against a missing CLI.
      window.alert(missingRuntimeBinaryMessage(runtime?.bin ?? ''))
      return null
    }
    if (webhookEnabled && !(v.webhookIntegrationId ?? '').trim()) {
      setTriggerError('Pick a webhook connection, or remove the webhook trigger.')
      return null
    }
    setWorkspaceError(null)
    setPromptError(null)
    const name = v.name.trim() || 'Untitled'
    const saved = await save.mutateAsync({
      id: v.id,
      name,
      description: v.description,
      runtimeId: v.runtimeId,
      prompt: v.prompt.trim(),
      cwd: '',
      workspaceId: v.workspaceId,
      cron,
      enabled: v.enabled,
      model,
      effort,
      webhookIntegrationId: webhookEnabled ? (v.webhookIntegrationId ?? '') : '',
      webhookEvents: webhookEnabled ? (v.webhookEvents ?? []) : [],
      webhookFilters: webhookEnabled ? (v.webhookFilters ?? {}) : {},
      verifyEnabled: verifyEnabled,
      maxRepairAttempts: repairAttempts,
      timeoutMinutes: timeoutMinutes,
    })
    return { id: saved.id, name }
  }

  const selectedWorkspace = (allWorkspaces ?? []).find((w) => w.id === v.workspaceId)
  // Checks live on the project, so how many exist depends on which repository
  // the automation targets — worth saying out loud here, because with none the
  // "verified" outcome is unreachable no matter what this form is set to.
  const workspaceUsable =
    hasWorkspaceId(v.workspaceId) &&
    Boolean(selectedWorkspace && isWorkspaceReady(selectedWorkspace.status))
  const promptUsable = hasTaskPrompt(v.prompt)
  const workspaceBlockReason =
    workspaceBlockedReason({
      workspaceValid: hasWorkspaceId(v.workspaceId),
      workspaceReady: Boolean(selectedWorkspace && isWorkspaceReady(selectedWorkspace.status)),
      workspaceStatus: selectedWorkspace?.status ?? null,
    }) ?? undefined
  const saveBlockReason = save.isPending
    ? 'Saving…'
    : workspaceBlockReason
      ? workspaceBlockReason
      : !promptUsable
        ? emptyTaskPromptMessage()
        : undefined

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const saved = await persist()
    if (saved) onSaved(saved.id)
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl">
      <header className="mb-7">
        <div className="flex items-start justify-between gap-4">
          <input
            className="min-w-0 flex-1 bg-transparent text-[28px] font-semibold leading-tight text-foreground outline-none placeholder:text-tier-quaternary"
            value={v.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Untitled automation"
            autoFocus
          />
          <div className="flex shrink-0 items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <span className="inline-flex" title={saveBlockReason}>
              <Button
                type="submit"
                variant="primary"
                disabled={save.isPending || !workspaceUsable || !promptUsable}
              >
                {save.isPending ? 'Saving…' : v.id ? 'Save changes' : 'Create'}
              </Button>
            </span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-ui-base">
          <ActiveToggle checked={v.enabled} onChange={(on) => set('enabled', on)} />

          <span aria-hidden className="text-tier-quaternary">
            |
          </span>

          <ProjectPicker
            projects={projects ?? []}
            projectId={projectId}
            invalid={Boolean(workspaceError)}
            aria-describedby={workspaceError ? 'workspace-required-error' : undefined}
            onChange={selectProject}
            onAddProject={() => setShowAddProject(true)}
          />

          <span aria-hidden className="text-tier-quaternary">
            |
          </span>

          <BranchPicker
            workspaces={branchChoices}
            workspaceId={v.workspaceId}
            disabled={!projectId || createWorkspace.isPending}
            placeholder={createWorkspace.isPending ? 'Opening branch…' : 'Select branch'}
            onChange={(id) => void selectBranch(id)}
          />
        </div>
      </header>

      {showAddProject ? (
        <AddProjectModal
          onClose={() => setShowAddProject(false)}
          onAdded={(project) => selectProject(project.id)}
        />
      ) : null}

      <div className="space-y-7">
        <section>
          <StepLabel n={1}>What the agent should do</StepLabel>
          <div
            className={`flex min-h-40 flex-col rounded-xl border bg-elevated p-1 ${
              promptError ? 'border-rose-500/40' : 'border-border'
            }`}
          >
            <textarea
              className="min-h-28 flex-1 resize-y bg-transparent px-3.5 py-3 text-ui-base text-foreground outline-none placeholder:text-tier-quaternary"
              value={v.prompt}
              onChange={(e) => {
                set('prompt', e.target.value)
                if (promptError) setPromptError(null)
              }}
              aria-invalid={Boolean(promptError)}
              aria-describedby={promptError ? 'prompt-required-error' : undefined}
              placeholder="Describe the outcome, constraints, and what not to touch…"
            />
            {promptError ? (
              <p id="prompt-required-error" className="px-3.5 pb-2 text-[12px] text-rose-300">
                {promptError}
              </p>
            ) : null}
            {v.prompt.length > 8_000 ? (
              <p className="px-3.5 pb-1 text-[11px] text-amber-300/90">
                Prompt is large ({v.prompt.length.toLocaleString()} chars) — consider trimming
                pasted context to save tokens
                {v.prompt.length > 32_000 ? ' and avoid ARG_MAX failures on argv-based CLIs' : ''}.
              </p>
            ) : null}
            <div className="flex items-center gap-1 px-2 pb-2">
              {models.length > 0 ? (
                <>
                  <ModelPicker models={models} model={model} onChange={changeModel} />
                  <EffortPicker
                    models={models}
                    model={model}
                    effort={effort}
                    onChange={changeEffort}
                  />
                </>
              ) : runtimes && runtimes.length > 0 ? (
                <RuntimePicker
                  runtimes={runtimes}
                  runtimeId={v.runtimeId}
                  align="start"
                  onChange={changeRuntimeId}
                />
              ) : null}
              {runtimes && runtimes.length > 1 && models.length > 0 ? (
                <div className="ml-auto">
                  <RuntimePicker
                    runtimes={runtimes}
                    runtimeId={v.runtimeId}
                    align="end"
                    onChange={changeRuntimeId}
                  />
                </div>
              ) : null}
            </div>
          </div>
          {runtime && !runtime.installed ? (
            <p className="mt-2 text-[12px] text-rose-300">
              {missingRuntimeBinaryMessage(runtime.bin)}
            </p>
          ) : null}
        </section>

        <section>
          <StepLabel n={2}>When it should run</StepLabel>
          <div className="space-y-1.5">
            {v.cron ? (
              <ScheduleTriggerRow
                cron={v.cron}
                onChange={(cron) => {
                  set('cron', cron)
                  setRunOnce(false)
                  setTriggerError(null)
                }}
                onRemove={() => {
                  set('cron', '')
                  setAddingTrigger(false)
                  setTriggerDraft('')
                  setTriggerError(null)
                }}
              />
            ) : null}

            {runOnce && !v.cron ? (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-elevated px-3.5 py-2.5">
                <Zap className="h-3.5 w-3.5 shrink-0 text-tier-secondary" />
                <div className="min-w-0 flex-1">
                  <div className="text-ui-base text-foreground">Run once</div>
                  <div className="text-ui-sm text-tier-quaternary">
                    Manual — start it yourself with “Run now”.
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Remove trigger"
                  onClick={() => setRunOnce(false)}
                  className="shrink-0 rounded-md p-1.5 text-tier-quaternary hover:bg-hover hover:text-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}

            {webhookEnabled ? (
              <WebhookTriggerRow
                integrationId={v.webhookIntegrationId ?? ''}
                events={v.webhookEvents ?? []}
                filters={v.webhookFilters ?? {}}
                onIntegrationChange={(id) => {
                  set('webhookIntegrationId', id)
                  set('webhookEvents', [])
                }}
                onEventsChange={(events) => set('webhookEvents', events)}
                onFiltersChange={(filters) => set('webhookFilters', filters)}
                onRemove={() => {
                  setWebhookEnabled(false)
                  set('webhookIntegrationId', '')
                  set('webhookEvents', [])
                  set('webhookFilters', {})
                }}
              />
            ) : null}

            {addingTrigger && !v.cron ? (
              <div className="space-y-2 rounded-xl border border-border bg-elevated px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <Code2 className="h-3.5 w-3.5 shrink-0 text-tier-secondary" />
                  <input
                    className={`${inputClass} mono text-[13px]`}
                    value={triggerDraft}
                    onChange={(e) => {
                      setTriggerDraft(e.target.value)
                      if (triggerError) setTriggerError(null)
                    }}
                    placeholder="0 9 * * 1-5"
                    autoFocus
                    aria-invalid={triggerError ? true : undefined}
                    aria-describedby={triggerError ? 'cron-trigger-error' : undefined}
                  />
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!triggerDraft.trim()}
                    onClick={() => {
                      const next = triggerDraft.trim()
                      if (!isValidCron(next)) {
                        setTriggerError(invalidCronMessage(next))
                        return
                      }
                      set('cron', next)
                      setAddingTrigger(false)
                      setTriggerDraft('')
                      setTriggerError(null)
                    }}
                  >
                    Add
                  </Button>
                  <button
                    type="button"
                    aria-label="Cancel custom trigger"
                    onClick={() => {
                      setAddingTrigger(false)
                      setTriggerDraft('')
                      setTriggerError(null)
                    }}
                    className="shrink-0 rounded-md p-1.5 text-tier-quaternary hover:bg-hover hover:text-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {triggerError ? (
                  <p id="cron-trigger-error" className="text-[12px] text-rose-300">
                    {triggerError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {!addingTrigger || v.cron || runOnce || webhookEnabled ? (
              <div className="rounded-xl border border-border bg-elevated p-1">
                <TriggerAddMenu
                  onPickPreset={(cron) => {
                    setRunOnce(false)
                    set('cron', cron)
                    setAddingTrigger(false)
                    setTriggerDraft('')
                    setTriggerError(null)
                  }}
                  onCustom={() => {
                    setRunOnce(false)
                    set('cron', '')
                    setAddingTrigger(true)
                    setTriggerError(null)
                  }}
                  onRunOnce={() => {
                    set('cron', '')
                    setAddingTrigger(false)
                    setTriggerDraft('')
                    setTriggerError(null)
                    setRunOnce(true)
                  }}
                  onWebhook={() => {
                    setRunOnce(false)
                    setWebhookEnabled(true)
                    setAddingTrigger(false)
                    setTriggerError(null)
                  }}
                />
              </div>
            ) : null}
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              type="button"
              variant="ghost"
              aria-expanded={showVerificationSettings}
              onClick={() => setShowVerificationSettings((open) => !open)}
            >
              <Settings className="h-3.5 w-3.5" />
              {showVerificationSettings ? 'Hide settings' : 'Settings'}
            </Button>
            {!showVerificationSettings ? (
              <span className="text-ui-sm text-tier-quaternary">
                {verificationSummary(verifyEnabled, repairAttempts, timeoutMinutes)}
              </span>
            ) : null}
          </div>
          {showVerificationSettings ? (
            <VerificationSection
              verifyEnabled={verifyEnabled}
              onVerifyEnabledChange={setVerifyEnabled}
              repairAttempts={repairAttempts}
              onRepairAttemptsChange={setRepairAttempts}
              timeoutMinutes={timeoutMinutes}
              onTimeoutMinutesChange={setTimeoutMinutes}
            />
          ) : null}
        </section>

        {workspaceError ? (
          <p
            id="workspace-required-error"
            className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-sm text-rose-300"
          >
            {workspaceError}
          </p>
        ) : null}

        {save.isError ? (
          <p className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-sm text-rose-300">
            {save.error instanceof Error ? save.error.message : String(save.error)}
          </p>
        ) : null}
      </div>
    </form>
  )
}

/**
 * Collapsed summary for verification — repair attempts and time budget only.
 */
function verificationSummary(
  verifyEnabled: boolean,
  repairAttempts: number,
  timeoutMinutes: number,
): string {
  if (!verifyEnabled) return 'Checks off'
  const limit = timeoutMinutes > 0 ? timeoutMinutes : DEFAULT_RUN_TIMEOUT_MS / 60_000
  return `Checks on · ${repairAttempts} repair${repairAttempts === 1 ? '' : 's'} · ${limit} min`
}

/**
 * Verification settings for one automation — shown behind the Settings toggle.
 */
function VerificationSection({
  verifyEnabled,
  onVerifyEnabledChange,
  repairAttempts,
  onRepairAttemptsChange,
  timeoutMinutes,
  onTimeoutMinutesChange,
}: {
  verifyEnabled: boolean
  onVerifyEnabledChange: (value: boolean) => void
  repairAttempts: number
  onRepairAttemptsChange: (value: number) => void
  timeoutMinutes: number
  onTimeoutMinutesChange: (value: number) => void
}) {
  return (
    <div className="mt-2 space-y-3 rounded-xl border border-border bg-elevated px-3.5 py-3">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-[var(--base)]"
          checked={verifyEnabled}
          onChange={(e) => onVerifyEnabledChange(e.target.checked)}
        />
        <span className="text-ui-base text-foreground">
          Run this project's checks when a run ends
        </span>
      </label>
      <p className="-mt-1 text-ui-sm text-tier-tertiary">
        Unattended turns only — checks never run on a message you type into the conversation.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-ui-sm text-tier-tertiary">
          Repair attempts
          <input
            type="number"
            min={0}
            max={MAX_REPAIR_ATTEMPTS}
            disabled={!verifyEnabled}
            className={`${inputClass} mt-1 w-full tabular-nums disabled:opacity-40`}
            value={repairAttempts}
            onChange={(e) => onRepairAttemptsChange(Number(e.target.value))}
          />
        </label>

        <label className="block text-ui-sm text-tier-tertiary">
          Time limit (minutes)
          <input
            type="number"
            min={0}
            className={`${inputClass} mt-1 w-full tabular-nums`}
            placeholder={String(DEFAULT_RUN_TIMEOUT_MS / 60_000)}
            value={timeoutMinutes || ''}
            onChange={(e) => onTimeoutMinutesChange(Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  )
}
