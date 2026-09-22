/** integrations queries and cache updates. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'

export function useIntegrationProviders() {
  return useQuery({
    queryKey: ['integrationProviders'],
    queryFn: () => fns.listIntegrationProviders(),
    staleTime: 60_000,
  })
}

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () => fns.listIntegrations(),
  })
}

export function useWebhookDeliveries(integrationId?: string) {
  return useQuery({
    queryKey: ['webhookDeliveries', integrationId ?? 'all'],
    queryFn: () => fns.listWebhookDeliveries({ data: { integrationId, limit: 40 } }),
    refetchInterval: 10_000,
  })
}

export function useCreateIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.createIntegration>[0]['data']) =>
      fns.createIntegration({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
  })
}

export function useUpdateIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.updateIntegration>[0]['data']) =>
      fns.updateIntegration({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  })
}

export function useAutomationSetupContext() {
  return useQuery({
    queryKey: ['automationSetupContext'],
    queryFn: () => fns.getAutomationSetupContext(),
    staleTime: 30_000,
  })
}

/** Bind a connected integration to a workspace + runtime. */
export function useCreateIntegrationAutomation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.createIntegrationAutomation>[0]['data']) =>
      fns.createIntegrationAutomation({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
  })
}
