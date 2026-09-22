/** shared queries and cache updates. */
import { useQueryClient } from '@tanstack/react-query'

export function useInvalidate() {
  const qc = useQueryClient()
  return (keys: string[]) => {
    for (const k of keys) qc.invalidateQueries({ queryKey: [k] })
  }
}
