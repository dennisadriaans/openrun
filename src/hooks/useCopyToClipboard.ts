import { useCallback, useEffect, useRef, useState } from 'react'

export function useCopyToClipboard(timeoutMs = 1000) {
  const [isCopied, setIsCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const copyToClipboard = useCallback(
    async (text: string) => {
      if (!text) return false
      try {
        await navigator.clipboard.writeText(text)
        setIsCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setIsCopied(false), timeoutMs)
        return true
      } catch {
        setIsCopied(false)
        return false
      }
    },
    [timeoutMs],
  )

  return { copyToClipboard, isCopied }
}
