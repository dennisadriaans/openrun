/**
 * Finish setup: turn a fresh connection into an automation that runs.
 *
 * Connecting is only half of what the user came for — until something binds
 * the connection, every delivery arrives and matches nothing. This is the
 * shortest path from that state to a working automation: pick a starting
 * point, a workspace and a runtime, and the trigger, prompt and name come from
 * the recipe. Everything stays editable afterwards in the full form, which is
 * one link away for anyone who wants it now.
 *
 * The trigger is sent as an `IntegrationTrigger`, not as event ids: the server
 * compiles it with the same `compileTrigger` this previews with, so the
 * sentence shown here *is* the binding that gets written.
 */
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { parseChecks } from '../lib/checks'
import { availableRecipes, defaultRecipe, type AutomationRecipe } from '../lib/integrations/recipes'
import { integrationSetupBlockedReason } from '../lib/integrations/setupGate'
import { describeTrigger, triggerOption } from '../lib/integrations/triggers'
import type { IntegrationProviderId } from '../lib/integrations/types'
import {
  useAutomationSetupContext,
  useCreateIntegrationAutomation,
  useProjects,
  useWorkspaces,
} from '../lib/queries'
import { ManageProjectsModal } from './ProjectsManager'
import { Button, Card, Field, inputClass } from './ui'
import { WorkspacePicker } from './WorkspacePicker'

export function IntegrationAutomationSetup({
  integrationId,
  provider,
  connectionName,
  onSkip,
}: {
  integrationId: string
  provider: IntegrationProviderId
  connectionName: string
  /** "I'll do it in the full form" — the route decides where that goes. */
  onSkip: () => void
}) {
  const navigate = useNavigate()
  const { data: context } = useAutomationSetupContext()
  const create = useCreateIntegrationAutomation()

  const recipes = availableRecipes(provider)
  const [recipeId, setRecipeId] = useState(() => defaultRecipe(provider)?.id ?? '')
  const recipe: AutomationRecipe | undefined = recipes.find((r) => r.id === recipeId) ?? recipes[0]

  const [triggerValue, setTriggerValue] = useState(
    () => defaultRecipe(provider)?.trigger.value ?? '',
  )
  const [projectId, setProjectId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [runtimeId, setRuntimeId] = useState('')
  const [error, setError] = useState('')
  const [managingProjects, setManagingProjects] = useState(false)

  const { data: workspaces } = useWorkspaces(projectId || undefined)
  const workspace = (workspaces ?? []).find((w) => w.id === workspaceId)

  // A webhook automation is unattended, and the server refuses to arm one
  // against a project with no definition of done. Count the checks here so the
  // panel can offer the fix instead of failing on submit.
  const { data: projects } = useProjects()
  const project = (projects ?? []).find((p) => p.id === projectId)
  const projectCheckCount = project ? parseChecks(project.checks).length : 0

  const runtimes = context?.runtimes ?? []
  // Prefer a runtime that is actually on PATH: picking the first row and then
  // refusing to arm it is the same dead end this panel exists to remove.
  const runtime =
    runtimes.find((r) => r.id === runtimeId) ?? runtimes.find((r) => r.installed) ?? runtimes[0]

  const option = recipe ? triggerOption(provider, recipe.trigger.kind) : null
  const trigger = recipe ? { ...recipe.trigger, value: triggerValue } : null

  const blocked = recipe
    ? integrationSetupBlockedReason({
        workspaceId,
        workspaceStatus: workspace?.status ?? null,
        workspaceKind: workspace?.kind ?? null,
        runtimeId: runtime?.id ?? '',
        runtimeInstalled: runtime?.installed ?? false,
        runtimeBin: runtime?.bin ?? '',
        prompt: recipe.prompt,
        projectCheckCount,
      })
    : 'This provider has no starting point that can be armed yet.'

  const submit = async () => {
    if (!recipe || !trigger || blocked) return
    setError('')
    try {
      const result = await create.mutateAsync({
        integrationId,
        workspaceId,
        runtimeId: runtime?.id ?? '',
        trigger,
        name: recipe.automationName,
        prompt: recipe.prompt,
      })
      await navigate({ to: '/tasks/$taskId', params: { taskId: result.taskId } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the automation.')
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div>
        <div className="text-ui-base text-foreground">Finish setup</div>
        <p className="mt-0.5 text-ui-sm text-tier-tertiary">
          {connectionName} is connected. Nothing runs until an automation binds it — pick a starting
          point and it is armed.
        </p>
      </div>

      {recipes.length > 0 ? (
        <div className="space-y-1.5">
          {recipes.map((r) => (
            <label
              key={r.id}
              className={
                r.id === recipe?.id
                  ? 'flex cursor-pointer gap-2.5 rounded-lg border border-border-strong bg-hover px-3 py-2.5'
                  : 'flex cursor-pointer gap-2.5 rounded-lg border border-border px-3 py-2.5 hover:border-border-strong'
              }
            >
              <input
                type="radio"
                name="recipe"
                className="mt-1"
                checked={r.id === recipe?.id}
                onChange={() => {
                  setRecipeId(r.id)
                  setTriggerValue(r.trigger.value ?? '')
                }}
              />
              <span className="min-w-0">
                <span className="block text-ui-base text-foreground">{r.title}</span>
                <span className="block text-ui-sm text-tier-tertiary">{r.summary}</span>
              </span>
            </label>
          ))}
        </div>
      ) : null}

      {option && option.value !== 'none' ? (
        <Field
          label={
            option.value === 'status'
              ? 'Status to watch'
              : option.value === 'label'
                ? 'Label to watch'
                : 'Assignee to watch'
          }
          hint={option.suggestions?.length ? option.suggestions.join(' · ') : undefined}
        >
          <input
            className={inputClass}
            value={triggerValue}
            placeholder={option.placeholder ?? 'Any'}
            onChange={(e) => setTriggerValue(e.target.value)}
          />
        </Field>
      ) : null}

      <WorkspacePicker
        projectId={projectId}
        workspaceId={workspaceId}
        onChange={(v) => {
          setProjectId(v.projectId)
          setWorkspaceId(v.workspaceId)
        }}
      />

      <Field label="Runtime">
        <select
          className={inputClass}
          value={runtime?.id ?? ''}
          onChange={(e) => setRuntimeId(e.target.value)}
        >
          {runtimes.length === 0 ? <option value="">No runtimes configured</option> : null}
          {runtimes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
              {r.installed ? '' : ' — not on PATH'}
            </option>
          ))}
        </select>
      </Field>

      {trigger ? (
        <p className="text-ui-sm text-tier-tertiary">{describeTrigger(provider, trigger)}</p>
      ) : null}

      {option?.note ? <p className="text-ui-sm text-tier-quaternary">{option.note}</p> : null}

      {error ? (
        <p className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-ui-sm text-rose-300">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex" title={blocked ?? undefined}>
          <Button
            type="button"
            variant="primary"
            disabled={Boolean(blocked) || create.isPending}
            onClick={() => void submit()}
          >
            {create.isPending ? 'Creating…' : 'Create automation'}
          </Button>
        </span>
        <Button type="button" variant="ghost" onClick={onSkip}>
          Set it up in the full form
        </Button>
        {projectId && projectCheckCount === 0 ? (
          <Button type="button" variant="ghost" onClick={() => setManagingProjects(true)}>
            Add project checks
          </Button>
        ) : null}
        {blocked ? <span className="text-ui-sm text-tier-quaternary">{blocked}</span> : null}
      </div>

      {managingProjects ? <ManageProjectsModal onClose={() => setManagingProjects(false)} /> : null}
    </Card>
  )
}
