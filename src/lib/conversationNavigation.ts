import { useQuery } from '@tanstack/react-query'
import {
  getLatestRunForProject,
  listConversationNavigationRuns,
} from '../fns/conversationNavigation'

export function useConversationNavigationRuns() {
  return useQuery({
    queryKey: ['runs', 'conversation-navigation'],
    queryFn: () => listConversationNavigationRuns(),
  })
}

export async function fetchLatestRunForProject(projectId: string) {
  return getLatestRunForProject({ data: { projectId } })
}
