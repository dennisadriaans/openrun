/** devices queries and cache updates. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'

/**
 * Paired phones and the pairing state. No live events cover devices, and the
 * only thing that changes without a local action is `lastSeenAt`, so a plain
 * interval is right here rather than the stream-health pattern.
 */
export function useMobileStatus() {
  return useQuery({
    queryKey: ['mobileStatus'],
    queryFn: () => fns.mobileStatus(),
    refetchInterval: 30_000,
  })
}

export function useCreatePairingCode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => fns.createPairingCode(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mobileStatus'] }),
  })
}

export function useCancelPairing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.cancelPairing({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mobileStatus'] }),
  })
}

export function useRevokeDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.revokeDevice({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mobileStatus'] }),
  })
}

export function useRemoveDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.removeDevice({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mobileStatus'] }),
  })
}
