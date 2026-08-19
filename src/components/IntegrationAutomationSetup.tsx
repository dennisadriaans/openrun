/**
 * The step after Connect: bind the connection to a workspace and a runtime.
 *
 * A connection on its own does nothing — deliveries arrive and match no
 * automation. This is the screen that closes that gap, pre-filled from the
 * provider catalog so the common case is one button. Everything it offers is
 * editable later on the automation itself; the point here is to leave the user
 * with something that runs.
 */
import { Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { providerMeta } from '../lib/integrations/catalog'
import { defaultAutomationPrompt, defaultInstallEvents } from '../lib/integrations/install'
import type { IntegrationProviderId } from '../lib/integrations/types'
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
  const [events, setEvents] = useState<string[]>(() => defaultInstallEvents(provider))
  const [prompt, setPrompt] = useState(() => defaultAutomationPrompt(provider))
  const [error, setError] = useState<string | null>(null)

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
      : !events.length
        ? 'Pick at least one event.'
        : ''

  const submit = async () => {
    setError(null)
    try {
      const result = await create.mutateAsync({
        integrationId,
        workspaceId: chosenWorkspace,
        runtimeId: chosenRuntime,
        events,
        prompt,
      })
      onCreated({ taskId: result.taskId })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!meta) return null
  if (isLoading) return <p className="text-ui-sm text-tier-tertiary">Loading…</p>

  return (
    <div className="space-y-4">
      <div>
        <div className="text-ui-base text-foreground">Finish setup</div>
        <p className="mt-0.5 text-ui-sm text-tier-secondary">
          {integrationName} is connected. Pick where it should run and Open Run will start a coding
          agent whenever one of these events arrives.
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

      <Field label="Run on">
        <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-[var(--border-quaternary)] p-2">
          {meta.events.map((event) => {
            const checked = events.includes(event.id)
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
                    setEvents((prev) =>
                      checked ? prev.filter((id) => id !== event.id) : [...prev, event.id],
                    )
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
