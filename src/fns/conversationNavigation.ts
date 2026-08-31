import { createServerFn } from '@tanstack/react-start'

export const listConversationNavigationRuns = createServerFn({ method: 'GET' }).handler(async () =>
  (await import('../server/conversationNavigation')).listConversationNavigationRuns(),
)

export const getLatestRunForProject = createServerFn({ method: 'GET' })
  .validator((d: { projectId: string }) => d)
  .handler(async ({ data }) =>
    (await import('../server/conversationNavigation')).getLatestRunForProject(data.projectId),
  )
