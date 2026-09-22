/** cloud queries and cache updates. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'

export function useCloudStatus() {
  return useQuery({
    queryKey: ['cloudStatus'],
    queryFn: () => fns.cloudStatus(),
    refetchInterval: 10_000,
  })
}

/**
 * Which providers this control plane can connect. Deliberately not gated on
 * `signedIn`: the integrations list has to be honest before anyone signs in,
 * and the endpoint needs no token.
 */
export function useCloudProviders() {
  const { data: cloud } = useCloudStatus()
  return useQuery({
    queryKey: ['cloudProviders', cloud?.cloudUrl ?? 'off'],
    queryFn: () => fns.cloudProviders(),
    enabled: Boolean(cloud?.cloudUrl),
    staleTime: 60_000,
  })
}

export function useStartCloudLogin() {
  return useMutation({
    mutationFn: (input: string | { origin: string; next?: string }) =>
      fns.startCloudLogin({ data: typeof input === 'string' ? { origin: input } : input }),
  })
}

export function useCompleteCloudLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { code: string; state: string }) => fns.completeCloudLogin({ data }),
    // Awaited, not fired and forgotten: the callback navigates as soon as this
    // resolves, and a stale `signedIn: false` status bounces it back to /welcome.
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['cloudStatus'] })
      // A fresh sign-in can reach a plane the cached catalog never saw.
      void qc.invalidateQueries({ queryKey: ['cloudProviders'] })
    },
  })
}

export function useSkipCloudOnboarding() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => fns.skipCloudOnboarding(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloudStatus'] }),
  })
}

export function useSignOutCloud() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => fns.signOutCloud(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cloudStatus'] })
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
  })
}

export function useStartHostedConnect() {
  return useMutation({
    mutationFn: (data: { provider: string; origin: string }) => fns.startHostedConnect({ data }),
  })
}

export function useCompleteHostedConnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      provider: string
      cloudConnectionId: string
      state?: string
      siteUrl?: string
      accountName?: string
    }) => fns.completeHostedConnect({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['automationSetupContext'] })
      qc.invalidateQueries({ queryKey: ['hostedConnections'] })
    },
  })
}

export function useHostedConnections() {
  const { data: cloud } = useCloudStatus()
  return useQuery({
    queryKey: ['hostedConnections'],
    queryFn: () => fns.listHostedConnections(),
    enabled: Boolean(cloud?.signedIn),
    staleTime: 30_000,
  })
}

export function useDisconnectHostedIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (integrationId: string) =>
      fns.disconnectHostedIntegration({ data: { integrationId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['hostedConnections'] })
    },
  })
}

export function useIngestTestEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (integrationId: string) => fns.ingestTestEvent({ data: { integrationId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhookDeliveries'] }),
  })
}
