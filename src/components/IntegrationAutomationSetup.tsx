/**
 * The step after Connect: bind the connection to a workspace and a runtime.
 *
 * A connection on its own does nothing — deliveries arrive and match no
 * automation. This is the screen that closes that gap, pre-filled from the
 * provider catalog so the common case is one button. Everything it offers is
 * editable later on the automation itself; the point here is to leave the user
 * with something that runs.
 */
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { providerMeta } from '../lib/integrations/catalog'
import { defaultAutomationPrompt } from '../lib/integrations/install'
import {
  availableTriggers,
  compileTrigger,
  defaultTrigger,
  describeTrigger,
  triggerOption,
  type IntegrationTrigger,
  type TriggerKind,
} from '../lib/integrations/triggers'
import type { IntegrationProviderId, WebhookFilters } from '../lib/integrations/types'
import { useCreateIntegrationAutomation, useInstallContext } from '../lib/queries'
import { Button, Field, inputClass } from './ui'

export function IntegrationAutomationSetup({
  provider,
  integrationId,
  integrationName,
  onCreated,
  onDismiss,
}: {
  provider: IntegrationProviderId
  integrationId: string
  integrationName: string
  onCreated: (result: { taskId: string }) => void
  onDismiss: () => void
}) {
  const meta = providerMeta(provider)
  const { data: ctx, isLoading } = useInstallContext()
  const create = useCreateIntegrationAutomation()

  const [workspaceId, setWorkspaceId] = useState('')
  const [runtimeId, setRuntimeId] = useState('')
  const [trigger, setTrigger] = useState<IntegrationTrigger>(() => defaultTrigger(provider))
  const [prompt, setPrompt] = useState(() => defaultAutomationPrompt(provider))
  const [showRaw, setShowRaw] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const triggers = useMemo(() => availableTriggers(provider), [provider])
  const option = triggerOption(provider, trigger.kind)
  // The same compile the server runs, so the preview is the binding.
  const compiled = compileTrigger(provider, trigger)
  const statusListId = useId()

  /** Every workspace across every project, labelled so the picker is one list. */
  const workspaces = useMemo(
    () =>
      (ctx?.projects ?? []).flatMap((project) =>
        project.workspaces.map((workspace) => ({
          id: workspace.id,
          label: `${project.name} · ${workspace.name}`,
        })),
      ),
    [ctx],
  )

  const runtimes = ctx?.runtimes ?? []
  const chosenWorkspace = workspaceId || workspaces[0]?.id || ''
  // Default to a runtime whose binary is actually on PATH — an automation bound
  // to a missing CLI is disabled the moment it is created.
  const chosenRuntime =
    runtimeId || runtimes.find((runtime) => runtime.installed)?.id || runtimes[0]?.id || ''

  const blocked = !workspaces.length
    ? 'Add a project first — an automation needs a workspace to run in.'
    : !runtimes.length
      ? 'Add a runtime first — an automation needs a CLI to run.'
      : !compiled.events.length
        ? 'Pick at least one event.'
        : ''

  const submit = async () => {
    setError(null)
    try {
      const result = await create.mutateAsync({
        integrationId,
        workspaceId: chosenWorkspace,
        runtimeId: chosenRuntime,
        trigger,
        prompt,
      })
      onCreated({ taskId: result.taskId })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const setKind = (kind: TriggerKind) => {
    setTrigger(
      kind === 'custom' ? { kind: 'custom', events: [...compiled.events] } : { kind, value: '' },
    )
  }

  if (!meta) return null
  if (isLoading) return <p className="text-ui-sm text-tier-tertiary">Loading…</p>

  return (
    <div className="space-y-4">
      <div>
        <div className="text-ui-base text-foreground">Finish setup</div>
        <p className="mt-0.5 text-ui-sm text-tier-secondary">
          {integrationName} is connected. Say when it should fire and where it should run, and Open
          Run will start a coding agent each time that happens.
        </p>
      </div>

      <Field label="Workspace">
        <select
          className={inputClass}
          value={chosenWorkspace}
          onChange={(e) => setWorkspaceId(e.target.value)}
          aria-label="Workspace"
          disabled={!workspaces.length}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Runtime">
        <select
          className={inputClass}
          value={chosenRuntime}
          onChange={(e) => setRuntimeId(e.target.value)}
          aria-label="Runtime"
          disabled={!runtimes.length}
        >
          {runtimes.map((runtime) => (
            <option key={runtime.id} value={runtime.id}>
              {runtime.label}
              {runtime.installed ? '' : ' (not on PATH)'}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Run when">
        <div className="space-y-2">
          <select
            className={inputClass}
            value={trigger.kind}
            onChange={(e) => setKind(e.target.value as TriggerKind)}
            aria-label="Trigger"
          >
            {triggers.map((entry) => (
              <option key={entry.kind} value={entry.kind}>
                {entry.label}
              </option>
            ))}
            <option value="custom">…pick raw events instead</option>
          </select>

          {option && option.value !== 'none' ? (
            <>
              <input
                className={inputClass}
                value={trigger.value ?? ''}
                onChange={(e) => setTrigger({ ...trigger, value: e.target.value })}
                placeholder={option.placeholder}
                list={option.suggestions ? statusListId : undefined}
                aria-label={option.label}
                autoComplete="off"
                spellCheck={false}
              />
              {option.suggestions ? (
                <datalist id={statusListId}>
                  {option.suggestions.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
              ) : (
                <p className="text-ui-sm text-tier-quaternary">
                  Type it exactly as {meta.label} shows it — matching ignores case but not spelling.
                </p>
              )}
            </>
          ) : null}

          {option?.note ? <p className="text-ui-sm text-warn">{option.note}</p> : null}

          {trigger.kind === 'custom' ? (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-[var(--border-quaternary)] p-2">
              {meta.events.map((event) => {
                const checked = (trigger.events ?? []).includes(event.id)
                return (
                  <label
                    key={event.id}
                    className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-hover"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() =>
                        setTrigger((prev) => {
                          const current = prev.events ?? []
                          return {
                            kind: 'custom',
                            events: checked
                              ? current.filter((id) => id !== event.id)
                              : [...current, event.id],
                          }
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="block text-ui-sm text-foreground">{event.label}</span>
                      <span className="mono block truncate text-ui-sm text-tier-quaternary">
                        {event.id}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          ) : null}

          {/*
            The compiled binding, verbatim. A trigger that reads right in
            English and matches nothing in practice is the failure this whole
            screen exists to prevent, so the events and filters it produces are
            visible before the button is pressed rather than after a delivery
            quietly matches nothing.
          */}
          <TriggerPreview
            sentence={describeTrigger(provider, trigger)}
            events={compiled.events}
            filters={compiled.filters}
            open={showRaw}
            onToggle={() => setShowRaw((prev) => !prev)}
          />
        </div>
      </Field>

      <Field label="Prompt" hint="{{issue.title}}, {{issue.body}}, {{event.type}} are filled in">
        <textarea
          className={`${inputClass} min-h-32 resize-y`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          spellCheck={false}
        />
      </Field>

      {blocked ? <p className="text-ui-sm text-warn">{blocked}</p> : null}
      {error ? (
        <p className="rounded-md border border-danger px-3 py-2 text-ui-sm text-danger">{error}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={Boolean(blocked) || create.isPending}
          title={blocked || undefined}
          onClick={() => void submit()}
        >
          {create.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…
            </>
          ) : (
            'Create automation'
          )}
        </Button>
        <Button type="button" variant="ghost" onClick={onDismiss}>
          Later
        </Button>
      </div>
    </div>
  )
}

/**
 * What the trigger actually compiles to. The sentence is always shown; the
 * event ids and filters are one click away, because "why did my automation not
 * fire" is answered by exactly these two lines.
 */
function TriggerPreview({
  sentence,
  events,
  filters,
  open,
  onToggle,
}: {
  sentence: string
  events: string[]
  filters: WebhookFilters
  open: boolean
  onToggle: () => void
}) {
  const Chevron = open ? ChevronDown : ChevronRight
  const filterPairs = Object.entries(filters).filter(
    (pair): pair is [string, string[]] => Array.isArray(pair[1]) && pair[1].length > 0,
  )

  return (
    <div className="rounded-md border border-[var(--border-quaternary)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-1.5 px-2.5 py-2 text-left text-ui-sm text-tier-secondary hover:text-foreground"
      >
        <Chevron className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0">{sentence}</span>
      </button>
      {open ? (
        <dl className="space-y-1 border-t border-[var(--border-quaternary)] px-2.5 py-2 text-ui-sm">
          <div className="flex gap-2">
            <dt className="shrink-0 text-tier-quaternary">Events</dt>
            <dd className="mono min-w-0 break-words text-tier-secondary">
              {events.length ? events.join(', ') : 'none — this would never fire'}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-tier-quaternary">Filters</dt>
            <dd className="mono min-w-0 break-words text-tier-secondary">
              {filterPairs.length
                ? filterPairs.map(([key, values]) => `${key}: ${values.join(', ')}`).join(' · ')
                : 'none — every delivery of those events'}
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  )
}
