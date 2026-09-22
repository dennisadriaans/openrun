import { QueryClient } from '@tanstack/react-query'

let browserQueryClient: QueryClient | undefined

export function getQueryClient(): QueryClient {
  if (typeof document === 'undefined') {
    return new QueryClient({ defaultOptions: { queries: { staleTime: 5_000 } } })
  }
  if (!browserQueryClient) {
    browserQueryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000 } } })
  }
  return browserQueryClient
}
