import { useEffect, useState } from 'react'

/**
 * Trailing-edge debounce for a value that drives a server call — e.g. the
 * command preview while someone types in an args template.
 */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
