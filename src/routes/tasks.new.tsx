import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { NeedProjectEmpty } from '../components/NeedProjectEmpty'
import { TaskForm } from '../components/TaskForm'
import { defaultAutomationPrompt } from '../lib/integrations/install'
import type { IntegrationProviderId } from '../lib/integrations/types'
import { hasProjects } from '../lib/projectGate'
import { useIntegrations, useProjects } from '../lib/queries'

type NewTaskSearch = {
  webhookIntegrationId?: string
}

export const Route = createFileRoute('/tasks/new')({
  validateSearch: (search: Record<string, unknown>): NewTaskSearch => ({
    webhookIntegrationId:
      typeof search.webhookIntegrationId === 'string' ? search.webhookIntegrationId : undefined,
  }),
  component: NewTaskPage,
})

function NewTaskPage() {
  const navigate = useNavigate()
  const { webhookIntegrationId } = Route.useSearch()
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

  const initial = integ
    ? {
        name: `${integ.providerLabel} webhook`,
        prompt: defaultAutomationPrompt(integ.provider as IntegrationProviderId),
        webhookIntegrationId: integ.id,
        webhookEvents: [] as string[],
        cron: '',
        enabled: true,
      }
    : undefined

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
