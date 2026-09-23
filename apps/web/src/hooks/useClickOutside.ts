import { useEffect, useRef, type RefObject } from 'react'

/**
 * Close a popover when the pointer is outside every `refs` node, or Escape.
 * `refs` is read from a ref so identity changes do not rebind listeners.
 */
export function useClickOutside(
  open: boolean,
  onClose: () => void,
  refs: Array<RefObject<HTMLElement | null>>,
) {
  const refsRef = useRef(refs)
  refsRef.current = refs

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node
      if (refsRef.current.some((ref) => ref.current?.contains(target))) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
}
