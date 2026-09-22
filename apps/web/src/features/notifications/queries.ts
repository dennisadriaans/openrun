/** notifications queries and cache updates. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'

export function useNotifiers() {
  return useQuery({
    queryKey: ['notifiers'],
    queryFn: () => fns.listNotifiers(),
  })
}

export function useSaveNotifier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.saveNotifier>[0]['data']) =>
      fns.saveNotifier({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifiers'] }),
  })
}

export function useRemoveNotifier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.removeNotifier({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifiers'] })
      qc.invalidateQueries({ queryKey: ['notificationDeliveries'] })
    },
  })
}

export function useTestNotifier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.testNotifier({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notificationDeliveries'] }),
  })
}

export function useNotificationDeliveries(notifierId?: string) {
  return useQuery({
    queryKey: ['notificationDeliveries', notifierId ?? 'all'],
    queryFn: () => fns.listNotificationDeliveries({ data: { notifierId } }),
  })
}
