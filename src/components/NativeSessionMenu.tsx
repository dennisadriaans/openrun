import { Check, ChevronDown, ChevronRight, History, MessageSquare } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { relativeTime } from '../lib/format'
import {
  nativeResumeKindFor,
  type NativeSession,
  type NativeSessionGroup,
  type NativeSessionKind,
} from '../lib/nativeSessions'
import { loadNativeSessionPage } from '../lib/queries'
import { ProviderIcon } from './ProviderIcons'
import { Tooltip } from './ui'

function useClickOutside(
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

export function NativeSessionMenu({
  workspaceId,
  groups,
  loading,
  error,
  selectedId,
  selectedLabel,
  disabled,
  disabledReason: disabledReasonProp,
  onSelectNew,
  onSelect,
}: {
  workspaceId: string
  groups: NativeSessionGroup[]
  loading: boolean
  error?: string
  selectedId: string
  selectedLabel: string
  disabled?: boolean
  disabledReason?: string
  onSelectNew: () => void
  onSelect: (session: NativeSession, group: NativeSessionGroup) => void
}) {
  const [open, setOpen] = useState(false)
  const [kindOpen, setKindOpen] = useState<NativeSessionKind | null>(null)
  const [extraByKind, setExtraByKind] = useState<
    Partial<Record<NativeSessionKind, NativeSession[]>>
  >({})
  const [hasMoreByKind, setHasMoreByKind] = useState<Partial<Record<NativeSessionKind, boolean>>>(
    {},
  )
  const [loadingKind, setLoadingKind] = useState<NativeSessionKind | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const kindItemRefs = useRef<Partial<Record<NativeSessionKind, HTMLButtonElement | null>>>({})
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const [subCoords, setSubCoords] = useState<{ top: number; left: number } | null>(null)

  const closeAll = () => {
    setOpen(false)
    setKindOpen(null)
  }

  useClickOutside(open, closeAll, [triggerRef, menuRef, submenuRef])

  useEffect(() => {
    setExtraByKind({})
    setHasMoreByKind({})
  }, [workspaceId])

  useEffect(() => {
    if (!open) setKindOpen(null)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setCoords(null)
      return
    }
    const update = () => {
      const button = buttonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      setCoords({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 280)),
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!kindOpen) {
      setSubCoords(null)
      return
    }
    const item = kindItemRefs.current[kindOpen]
    if (!item) {
      setSubCoords(null)
      return
    }
    const update = () => {
      const el = kindItemRefs.current[kindOpen]
      if (!el) return
      const rect = el.getBoundingClientRect()
      const submenuWidth = 320
      const spaceRight = window.innerWidth - rect.right
      const openLeft = spaceRight < submenuWidth + 8
      setSubCoords({
        top: rect.top,
        left: openLeft ? rect.left - submenuWidth - 4 : rect.right + 4,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [kindOpen, extraByKind, loadingKind])

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const openKind = (kind: NativeSessionKind) => {
    clearCloseTimer()
    setKindOpen(kind)
  }

  const deferCloseKind = () => {
    clearCloseTimer()
    closeTimer.current = setTimeout(() => setKindOpen(null), 160)
  }

  useEffect(() => () => clearCloseTimer(), [])

  const mergedGroups = useMemo(() => {
    return groups.map((group) => {
      const extra = extraByKind[group.kind] ?? []
      const seen = new Set(group.sessions.map((s) => s.sessionId))
      const appended = extra.filter((s) => !seen.has(s.sessionId))
      return {
        ...group,
        sessions: [...group.sessions, ...appended],
        hasMore: hasMoreByKind[group.kind] ?? group.hasMore,
      }
    })
  }, [groups, extraByKind, hasMoreByKind])

  const selectedGroup = mergedGroups.find((g) => g.sessions.some((s) => s.sessionId === selectedId))
  const selected = selectedGroup?.sessions.find((s) => s.sessionId === selectedId)
  const triggerKind = selected
    ? selected.kind
    : nativeResumeKindFor({ bin: selectedGroup?.bin ?? '' })

  const loadMore = async (kind: NativeSessionKind) => {
    const group = mergedGroups.find((g) => g.kind === kind)
    if (!group || loadingKind) return
    setLoadingKind(kind)
    try {
      const page = await loadNativeSessionPage({
        workspaceId,
        kind,
        offset: group.sessions.length,
      })
      const next = page.groups[0]
      if (!next) return
      setExtraByKind((prev) => ({
        ...prev,
        [kind]: [...(prev[kind] ?? []), ...next.sessions],
      }))
      setHasMoreByKind((prev) => ({ ...prev, [kind]: next.hasMore }))
    } finally {
      setLoadingKind(null)
    }
  }

  const disabledReason = disabled
    ? (disabledReasonProp ?? 'Select a branch first')
    : !workspaceId
      ? (disabledReasonProp ?? 'Select a branch first')
      : undefined

  const trigger = (
    <div ref={triggerRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={Boolean(disabledReason)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Start from existing chat"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 max-w-64 min-w-0 items-center gap-2 truncate rounded-lg px-2.5 text-ui-base text-tier-tertiary transition-colors hover:bg-hover hover:text-tier-secondary disabled:pointer-events-none disabled:opacity-40"
      >
        {selected && triggerKind ? (
          <ProviderIcon kind={triggerKind} className="size-3.5 shrink-0" />
        ) : (
          <History className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">
          {selected
            ? selected.title
            : selectedId
              ? selectedLabel || selectedId.slice(0, 8)
              : 'New conversation'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-tier-quaternary" />
      </button>
      {open
        ? createPortal(
            <>
              <div
                ref={menuRef}
                role="menu"
                style={{
                  position: 'fixed',
                  top: coords?.top ?? 0,
                  left: coords?.left ?? 0,
                  zIndex: 200,
                  visibility: coords ? 'visible' : 'hidden',
                }}
                className="min-w-56 overflow-hidden rounded-xl border border-border bg-elevated p-1 shadow-xl shadow-black/40"
              >
                <button
                  type="button"
                  role="menuitem"
                  onMouseEnter={deferCloseKind}
                  onClick={() => {
                    onSelectNew()
                    closeAll()
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ui-base transition-colors ${
                    !selectedId
                      ? 'bg-hover text-foreground'
                      : 'text-foreground/85 hover:bg-hover hover:text-foreground'
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-tier-secondary" />
                  <span className="min-w-0 flex-1">New conversation</span>
                  {!selectedId ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-tier-secondary" />
                  ) : null}
                </button>
                {loading && mergedGroups.length === 0 ? (
                  <p className="px-2.5 py-2 text-ui-sm text-tier-quaternary">Loading chats…</p>
                ) : error && mergedGroups.length === 0 ? (
                  <p className="px-2.5 py-2 text-ui-sm text-tier-quaternary">{error}</p>
                ) : mergedGroups.length === 0 ? (
                  <p className="px-2.5 py-2 text-ui-sm text-tier-quaternary">
                    No resumable CLIs installed
                  </p>
                ) : (
                  mergedGroups.map((group) => {
                    const active = kindOpen === group.kind
                    const selectedHere = group.sessions.some((s) => s.sessionId === selectedId)
                    return (
                      <button
                        key={group.kind}
                        ref={(el) => {
                          kindItemRefs.current[group.kind] = el
                        }}
                        type="button"
                        role="menuitem"
                        aria-haspopup="menu"
                        aria-expanded={active}
                        onMouseEnter={() => openKind(group.kind)}
                        onMouseLeave={deferCloseKind}
                        onFocus={() => openKind(group.kind)}
                        onClick={() => openKind(group.kind)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ui-base transition-colors ${
                          active || selectedHere
                            ? 'bg-hover text-foreground'
                            : 'text-foreground/85 hover:bg-hover hover:text-foreground'
                        }`}
                      >
                        <ProviderIcon kind={group.kind} className="size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{group.label}</span>
                        <span className="shrink-0 text-ui-sm text-tier-quaternary">
                          {group.sessions.length}
                          {group.hasMore ? '+' : ''}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-tier-quaternary" />
                      </button>
                    )
                  })
                )}
              </div>
              {kindOpen
                ? (() => {
                    const group = mergedGroups.find((g) => g.kind === kindOpen)
                    if (!group) return null
                    return (
                      <div
                        ref={submenuRef}
                        role="menu"
                        onMouseEnter={() => openKind(group.kind)}
                        onMouseLeave={deferCloseKind}
                        style={{
                          position: 'fixed',
                          top: subCoords?.top ?? 0,
                          left: subCoords?.left ?? 0,
                          zIndex: 201,
                          visibility: subCoords ? 'visible' : 'hidden',
                        }}
                        className="max-h-80 w-80 overflow-auto rounded-xl border border-border bg-elevated p-1 shadow-xl shadow-black/40"
                      >
                        {group.sessions.length === 0 ? (
                          <p className="px-2.5 py-2 text-ui-sm text-tier-quaternary">
                            No {group.label} chats in this workspace folder.
                          </p>
                        ) : (
                          group.sessions.map((session) => {
                            const isSelected = session.sessionId === selectedId
                            return (
                              <button
                                key={session.sessionId}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  onSelect(session, group)
                                  closeAll()
                                }}
                                className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                                  isSelected
                                    ? 'bg-hover text-foreground'
                                    : 'text-foreground/85 hover:bg-hover hover:text-foreground'
                                }`}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-ui-base">
                                    {session.title}
                                  </span>
                                  <span className="block text-ui-sm text-tier-quaternary">
                                    {relativeTime(session.modifiedAt)}
                                    {session.messageCount
                                      ? ` · ${session.messageCount} message${session.messageCount === 1 ? '' : 's'}`
                                      : ''}
                                  </span>
                                </span>
                                {isSelected ? (
                                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-tier-secondary" />
                                ) : null}
                              </button>
                            )
                          })
                        )}
                        {group.hasMore ? (
                          <button
                            type="button"
                            onClick={() => void loadMore(group.kind)}
                            disabled={loadingKind === group.kind}
                            className="flex w-full items-center justify-center rounded-lg px-2.5 py-2 text-ui-sm text-tier-tertiary transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
                          >
                            {loadingKind === group.kind ? 'Loading…' : 'Load more'}
                          </button>
                        ) : null}
                      </div>
                    )
                  })()
                : null}
            </>,
            document.body,
          )
        : null}
    </div>
  )

  return (
    <Tooltip content={disabledReason ?? 'New chat or resume a CLI session'} disabled={open}>
      {trigger}
    </Tooltip>
  )
}
