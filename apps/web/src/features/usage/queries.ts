/** usage queries and cache updates. */
import { useQuery } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'
import type { UsageRange } from '@openrun/domain/runtimes/usage'

/**
 * Usage across every configured runtime. The first call after a lot of CLI
 * activity re-parses whatever changed on disk, so keep it cached rather than
 * refetching on focus. Changing the range re-aggregates from the same cache.
 */
export function useUsageReport(range: UsageRange) {
  return useQuery({
    queryKey: ['usageReport', range],
    queryFn: () => fns.usageReport({ data: { range } }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  })
}

/**
 * The tightest limit any CLI reports about itself, for the account-menu badge.
 * One file read, so the sidebar can poll it without the full scan.
 */
export function useUsagePressure() {
  return useQuery({
    queryKey: ['usagePressure'],
    queryFn: () => fns.usagePressure(),
    staleTime: 120_000,
    refetchInterval: 300_000,
  })
}
