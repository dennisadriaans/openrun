import { CircleAlert, CircleCheck, CircleX, Info, LoaderCircle, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

type ToastType = 'success' | 'info' | 'warning' | 'error' | 'loading'

type ToastItem = {
  id: string
  title?: string
  description?: string
  type?: ToastType
}

const TOAST_LIMIT = 3
const TOAST_DURATION_MS = 4000

let count = 0
function nextId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return String(count)
}

let toasts: ToastItem[] = []
const listeners = new Set<(next: ToastItem[]) => void>()
const timeouts = new Map<string, ReturnType<typeof setTimeout>>()

function emit(next: ToastItem[]) {
  toasts = next
  for (const listener of listeners) listener(toasts)
}

function dismiss(id: string) {
  const timeout = timeouts.get(id)
  if (timeout) {
    clearTimeout(timeout)
    timeouts.delete(id)
  }
  emit(toasts.filter((t) => t.id !== id))
}

function add(item: Omit<ToastItem, 'id'>) {
  const id = nextId()
  emit([{ ...item, id }, ...toasts].slice(0, TOAST_LIMIT))
  if (item.type !== 'loading') {
    timeouts.set(
      id,
      setTimeout(() => dismiss(id), TOAST_DURATION_MS),
    )
  }
  return id
}

export const toast = {
  add,
  close: dismiss,
}

function ToastIcon({ type }: { type: ToastType | undefined }) {
  if (type === 'success') return <CircleCheck className="size-4 text-success" />
  if (type === 'info') return <Info className="size-4 text-tier-secondary" />
  if (type === 'warning') return <CircleAlert className="size-4 text-warn" />
  if (type === 'error') return <CircleX className="size-4 text-danger" />
  if (type === 'loading')
    return <LoaderCircle className="size-4 animate-spin text-tier-secondary" />
  return null
}

function ToastCard({ item }: { item: ToastItem }) {
  return (
    <div
      role="status"
      className="pointer-events-auto flex w-full origin-top animate-[toast-in_0.4s_cubic-bezier(0.22,1,0.36,1)] items-center gap-3 overflow-hidden rounded-2xl border border-border bg-elevated p-4 text-foreground shadow-[0_8px_24px_var(--shadow-primary)]"
    >
      <ToastIcon type={item.type} />
      <div className="min-w-0 flex-1">
        {item.title ? <p className="text-ui-sm font-medium">{item.title}</p> : null}
        {item.description ? (
          <p className="text-ui-sm text-tier-tertiary">{item.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Close toast"
        onClick={() => dismiss(item.id)}
        className="shrink-0 rounded-md p-0.5 text-tier-quaternary hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

export function Toaster({ children }: { children?: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>(toasts)

  useEffect(() => {
    listeners.add(setItems)
    return () => {
      listeners.delete(setItems)
    }
  }, [])

  return (
    <>
      {children}
      <div className="pointer-events-none fixed inset-x-4 top-4 z-50 mx-auto flex w-auto max-w-sm flex-col gap-2">
        {items.map((item) => (
          <ToastCard key={item.id} item={item} />
        ))}
      </div>
    </>
  )
}
