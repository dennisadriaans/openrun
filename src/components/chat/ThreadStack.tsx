import { useNavigate } from '@tanstack/react-router'
import { GitBranch } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { relativeTime } from '../../lib/format'
import { useConversationNavigationRuns } from '../../lib/queries'
import { adjacentThreadId, groupThreadLensRuns } from '../../lib/threadLens'
import { truncateNavTitle } from '../../lib/truncateLabel.ts'
import {
  NavigationItem,
  NavigationMenu,
  NavigationSearch,
  NavigationSectionLabel,
} from '../workspace/NavigationPicker'
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
  }, [open])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
        return
      }
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
    <div className="relative min-w-0">
      {/*
        The wallet-card edges peek above the trigger to hint at the other
        conversations in this worktree; the trigger itself is the shared
        breadcrumb dropdown chrome.
      */}
      {appearance === 'stack' && currentThreads.length > 1 ? (
        <>
          <span className="pointer-events-none absolute inset-x-2 -top-1.5 h-4 rounded-md border border-border/40 bg-elevated/50" />
          {currentThreads.length > 2 ? (
            <span className="pointer-events-none absolute inset-x-1 -top-0.5 h-4 rounded-md border border-border/60 bg-elevated/80" />
          ) : null}
        </>
      ) : null}
      <NavigationMenu
        label={truncateNavTitle(title)}
        title={title}
        icon={
          <ProviderIcon kind={runtimeKind(runtimeId, runtimeLabel)} className="size-3.5 shrink-0" />
        }
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}
        triggerClassName="relative max-w-44 sm:max-w-56"
        trailing={
          hasUnreadCurrentThread ? (
            <span
              role="img"
              aria-label="New activity in another conversation"
              title="New activity in another conversation"
              className="size-1.5 shrink-0 rounded-full bg-accent"
            />
          ) : null
        }
        header={
          <NavigationSearch
            inputRef={inputRef}
            value={query}
            onChange={setQuery}
            placeholder="Search this worktree..."
            ariaLabel="Search conversations"
            shortcut="⌘K"
          />
        }
      >
        {(close) => (
          <div className="max-h-[min(30rem,65vh)] overflow-y-auto">
            {groups.map((group) => (
              <section key={group.key} className="not-first:mt-1">
                {query.trim() || group.kind !== 'current' ? (
                  <NavigationSectionLabel>
                    {group.kind === 'workspace' ? (
                      <GitBranch className="size-3 shrink-0" aria-hidden="true" />
                    ) : null}
                    <span className="min-w-0 truncate">{group.label}</span>
                    {group.runs.some((item) => item.unread) ? (
                      <span
                        aria-label="New activity in this worktree"
                        title="New activity in this worktree"
                        className="size-1.5 shrink-0 rounded-full bg-accent"
                      />
                    ) : null}
                  </NavigationSectionLabel>
                ) : null}
                {group.runs.map((item) => (
                  <NavigationItem
                    key={item.id}
                    label={item.chatTitle}
                    icon={
                      <ProviderIcon
                        kind={runtimeKind(item.runtimeId, item.runtimeLabel)}
                        className="size-3.5 shrink-0"
                      />
                    }
                    active={item.id === runId}
                    unread={item.unread}
                    meta={
                      <>
                        <span
                          className="max-w-[4.5rem] shrink-0 truncate text-[11px] text-muted-foreground"
                          title={item.runtimeLabel}
                        >
                          {item.runtimeLabel}
                        </span>
                        <span className="w-10 shrink-0 text-right text-[11px] text-muted-foreground/70">
                          {relativeTime(item.startedAt).replace(' ago', '')}
                        </span>
                      </>
                    }
                    onSelect={() => select(item.id)}
                    onClick={(event) => {
                      close()
                      select(item.id, event.metaKey || event.ctrlKey)
                    }}
                  />
                ))}
              </section>
            ))}
            {groups.length === 0 ? (
              <p className="px-3 py-8 text-center text-[12.5px] text-muted-foreground">
                No conversations found
              </p>
            ) : null}
          </div>
        )}
      </NavigationMenu>
    </div>
  )
}
