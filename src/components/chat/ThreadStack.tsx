import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, GitBranch, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { relativeTime } from '../../lib/format'
import { useConversationNavigationRuns } from '../../lib/conversationNavigation'
import { adjacentThreadId, groupThreadLensRuns } from '../../lib/threadLens'
import { truncateNavTitle } from '../../lib/truncateLabel.ts'
import { ProviderIcon } from '../ProviderIcons'

/** Change this default to `plain` to remove the wallet-card affordance only. */
export const DEFAULT_THREAD_SELECTOR_APPEARANCE: 'stack' | 'plain' = 'stack'

function runtimeKind(runtimeId: string, label: string) {
  const value = `${runtimeId} ${label}`.toLocaleLowerCase()
  if (value.includes('claude')) return 'claude'
  if (value.includes('codex') || value.includes('openai')) return 'codex'
  if (value.includes('grok')) return 'grok'
  if (value.includes('antigravity')) return 'antigravity'
  if (value.includes('fx')) return 'fx'
  return value
}

export function ThreadStack({
  runId,
  title,
  runtimeId,
  runtimeLabel,
  workspaceId,
  projectId,
  appearance = DEFAULT_THREAD_SELECTOR_APPEARANCE,
}: {
  runId: string
  title: string
  runtimeId: string
  runtimeLabel: string
  workspaceId: string
  projectId: string
  appearance?: 'stack' | 'plain'
}) {
  const { data: runs = [] } = useConversationNavigationRuns()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const groups = useMemo(
    () => groupThreadLensRuns(runs, { workspaceId, projectId }, query),
    [projectId, query, runs, workspaceId],
  )
  const currentThreads = runs
    .filter((run) => run.workspaceId === workspaceId)
    .sort((a, b) => b.startedAt - a.startedAt)
  const hasUnreadCurrentThread = currentThreads.some((run) => run.id !== runId && run.unread)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
        return
      }
      if (event.key === 'Escape') setOpen(false)
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return
      const direction = event.key === '[' ? -1 : event.key === ']' ? 1 : 0
      if (!direction || currentThreads.length < 2) return
      const nextId = adjacentThreadId(runs, workspaceId, runId, direction)
      if (!nextId) return
      event.preventDefault()
      void navigate({ to: '/runs/$runId', params: { runId: nextId } })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [currentThreads.length, navigate, runId, runs, workspaceId])

  const select = (id: string, newWindow = false) => {
    setOpen(false)
    setQuery('')
    if (newWindow) {
      window.open(`/runs/${encodeURIComponent(id)}`, '_blank', 'noopener,noreferrer')
      return
    }
    void navigate({ to: '/runs/$runId', params: { runId: id } })
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div className="relative min-w-0">
        {appearance === 'stack' && currentThreads.length > 1 ? (
          <>
            <span className="absolute inset-x-2 -top-1.5 h-4 rounded-md border border-border/40 bg-elevated/50" />
            {currentThreads.length > 2 ? (
              <span className="absolute inset-x-1 -top-0.5 h-4 rounded-md border border-border/60 bg-elevated/80" />
            ) : null}
          </>
        ) : null}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          title={title}
          onClick={() => setOpen((value) => !value)}
          className={`relative flex w-full min-w-0 max-w-44 items-center gap-1 overflow-hidden rounded-md px-2 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-[var(--bg-luminous-quaternary)] sm:max-w-56 ${
            open ? 'bg-secondary' : 'bg-background'
          }`}
        >
          <ProviderIcon kind={runtimeKind(runtimeId, runtimeLabel)} className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{truncateNavTitle(title)}</span>
          {hasUnreadCurrentThread ? (
            <span
              role="img"
              aria-label="New activity in another conversation"
              title="New activity in another conversation"
              className="size-1.5 shrink-0 rounded-full bg-accent"
            />
          ) : null}
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
        </button>
      </div>

      {open ? (
        <div
          role="dialog"
          aria-label="Conversation context"
          className="absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-elevated shadow-2xl shadow-black/40"
        >
          <div className="relative border-b border-border p-2.5">
            <Search className="absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search this worktree, or type to reach others…"
              aria-label="Search conversations"
              className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-12 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/50"
            />
            <kbd className="absolute right-5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </div>
          <div className="max-h-[min(30rem,65vh)] overflow-y-auto p-2">
            {groups.map((group) => (
              <section key={group.key} className="not-first:mt-2">
                {query.trim() || group.kind !== 'current' ? (
                  <h3 className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {group.kind === 'workspace' ? <GitBranch className="size-3" /> : null}
                    {group.label}
                    {group.runs.some((item) => item.unread) ? (
                      <span
                        aria-label="New activity in this worktree"
                        title="New activity in this worktree"
                        className="size-1.5 rounded-full bg-accent"
                      />
                    ) : null}
                  </h3>
                ) : null}
                {group.runs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={(event) => select(item.id, event.metaKey || event.ctrlKey)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-secondary/70 ${
                      item.id === runId ? 'bg-secondary text-foreground' : 'text-foreground/85'
                    }`}
                  >
                    <ProviderIcon
                      kind={runtimeKind(item.runtimeId, item.runtimeLabel)}
                      className="size-3.5 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{item.chatTitle}</span>
                    {item.unread ? (
                      <span
                        role="img"
                        aria-label="New activity"
                        title="New activity"
                        className="size-1.5 shrink-0 rounded-full bg-accent"
                      />
                    ) : null}
                    <span
                      className="max-w-[4.5rem] shrink-0 truncate text-[11px] text-muted-foreground"
                      title={item.runtimeLabel}
                    >
                      {item.runtimeLabel}
                    </span>
                    <span className="w-10 shrink-0 text-right text-[11px] text-muted-foreground/70">
                      {relativeTime(item.startedAt).replace(' ago', '')}
                    </span>
                  </button>
                ))}
              </section>
            ))}
            {groups.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No conversations found
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
