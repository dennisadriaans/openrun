import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { NeedProjectEmpty } from '../components/NeedProjectEmpty'
import { TaskForm, type TaskFormValues } from '../components/TaskForm'
import { automationShortcut, isAutomationShortcutId } from '../lib/automationShortcuts'
import { defaultAutomationPrompt } from '../lib/integrations/automation'
import type { IntegrationProviderId } from '../lib/integrations/types'
import { hasProjects } from '../lib/projectGate'
import { useIntegrations, useProjects } from '../lib/queries'

type NewTaskSearch = {
  webhookIntegrationId?: string
  /** A start-page template (`lib/automationShortcuts.ts`) to seed the form with. */
  shortcut?: string
}

export const Route = createFileRoute('/tasks/new')({
  validateSearch: (search: Record<string, unknown>): NewTaskSearch => ({
    webhookIntegrationId:
      typeof search.webhookIntegrationId === 'string' ? search.webhookIntegrationId : undefined,
    shortcut:
      typeof search.shortcut === 'string' && isAutomationShortcutId(search.shortcut)
        ? search.shortcut
        : undefined,
  }),
  component: NewTaskPage,
})

function NewTaskPage() {
  const navigate = useNavigate()
  const { webhookIntegrationId, shortcut } = Route.useSearch()
  const { data: projects, isLoading } = useProjects()
  const { data: integrations } = useIntegrations()

  if (isLoading) {
    return <div className="px-8 py-8 text-ui-base text-tier-tertiary">Loading…</div>
  }

  if (!hasProjects(projects?.length ?? 0)) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-8">
        <NeedProjectEmpty />
      </div>
    )
  }

  const integ = webhookIntegrationId
    ? integrations?.find((i) => i.id === webhookIntegrationId)
    : undefined
  const template = automationShortcut(shortcut)

  let initial: Partial<TaskFormValues> | undefined
  if (integ) {
    initial = {
      name: `${integ.providerLabel} webhook`,
      prompt: defaultAutomationPrompt(integ.provider as IntegrationProviderId),
      webhookIntegrationId: integ.id,
      webhookEvents: [],
      cron: '',
      enabled: true,
    }
  } else if (template) {
    // Seeded disabled: a schedule that fires before the branch is confirmed
    // would run against whatever the form defaulted to.
    initial = {
      name: template.automationName,
      description: `${template.verb} ${template.line}`,
      prompt: template.prompt,
      cron: template.cron,
      enabled: false,
    }
  }

  return (
    <div className="px-8 py-8">
      <TaskForm
        initial={initial}
        onCancel={() => navigate({ to: '/tasks' })}
        onSaved={(id) => navigate({ to: '/tasks/$taskId', params: { taskId: id } })}
      />
    </div>
  )
}
