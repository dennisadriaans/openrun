import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Folder,
  FolderGit2,
  FolderPlus,
  House,
  PenLine,
  Search,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as fns from '../fns'
import type { LocalDirEntry } from '../fns'
import { folderNameError } from '../lib/folderName'
import { useAddProject, useCreateLocalFolder } from '../lib/queries'
import { Button, Modal, inputClass } from './ui'

export type AddedProject = {
  id: string
  name: string
}

type Crumb = { name: string; path: string; home?: boolean }

function crumbsFor(dir: string, home: string): Crumb[] {
  const rest = dir === home ? '' : dir.startsWith(`${home}/`) ? dir.slice(home.length + 1) : null
  const out: Crumb[] =
    rest === null ? [{ name: '/', path: '/' }] : [{ name: 'Home', path: home, home: true }]
  let acc = rest === null ? '' : home
  for (const part of (rest === null ? dir : rest).split('/').filter(Boolean)) {
    acc = `${acc}/${part}`
    out.push({ name: part, path: acc })
  }
  return out
}

export function AddProjectModal({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded?: (project: AddedProject) => void
}) {
  const add = useAddProject()
  const createFolder = useCreateLocalFolder()
  // Browsing history, Nautilus style: `history[cursor]` is the folder on screen.
  const [history, setHistory] = useState<string[]>([])
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<LocalDirEntry | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [filter, setFilter] = useState('')
  const [editingPath, setEditingPath] = useState(false)
  const [pathDraft, setPathDraft] = useState('')
  const [newName, setNewName] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const dir = history[cursor]
  const places = useQuery({ queryKey: ['local-places'], queryFn: () => fns.listLocalPlaces() })
  const listing = useQuery({
    queryKey: ['local-directories', dir ?? '', showHidden],
    queryFn: () => fns.listLocalDirectories({ data: { dir, showHidden } }),
  })
  const current = listing.data

  // The first listing resolves $HOME server-side; seed history with it.
  useEffect(() => {
    if (current && history.length === 0) setHistory([current.path])
  }, [current, history.length])

  const navigate = (path: string) => {
    if (!path) return
    setSelected(null)
    setFilter('')
    setNewName(null)
    setEditingPath(false)
    const base = history.slice(0, cursor + 1)
    if (base[base.length - 1] === path) return
    setHistory([...base, path])
    setCursor(base.length)
  }

  const visible = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase()
    if (!current) return []
    if (!needle) return current.entries
    return current.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(needle))
  }, [current, filter])

  const target = selected ?? (current ? { path: current.path, isGitRepo: current.isGitRepo } : null)
  const newFolderParent = current?.path
  const nameError = newName === null || newName === '' ? null : folderNameError(newName)

  const moveSelection = (delta: number) => {
    if (visible.length === 0) return
    const index = visible.findIndex((entry) => entry.path === selected?.path)
    const next = visible[Math.min(visible.length - 1, Math.max(0, index + delta))] ?? visible[0]
    setSelected(next)
    listRef.current
      ?.querySelector(`[data-path="${CSS.escape(next.path)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  const submitNewFolder = async () => {
    const name = (newName ?? '').trim()
    if (!name || nameError || !newFolderParent) return
    const created = await createFolder.mutateAsync({ parent: newFolderParent, name })
    setNewName(null)
    setSelected({ name, path: created.path, isGitRepo: true })
  }

  const submit = async () => {
    if (!target?.isGitRepo) return
    const project = await add.mutateAsync({ mode: 'register', path: target.path })
    onAdded?.({ id: project.id, name: project.name })
    onClose()
  }

  const iconButton =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-tier-tertiary transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <Modal title="Add project" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Back"
            disabled={cursor === 0}
            onClick={() => {
              setSelected(null)
              setCursor((c) => Math.max(0, c - 1))
            }}
            className={iconButton}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Forward"
            disabled={cursor >= history.length - 1}
            onClick={() => {
              setSelected(null)
              setCursor((c) => Math.min(history.length - 1, c + 1))
            }}
            className={iconButton}
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Parent folder"
            disabled={!current?.parent}
            onClick={() => current?.parent && navigate(current.parent)}
            className={iconButton}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>

          {editingPath ? (
            <input
              autoFocus
              value={pathDraft}
              placeholder="/path/to/folder"
              aria-label="Location"
              onChange={(event) => setPathDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  navigate(pathDraft.trim())
                }
                if (event.key === 'Escape') setEditingPath(false)
              }}
              onBlur={() => setEditingPath(false)}
              className={`${inputClass} mono text-[13px]`}
            />
          ) : (
            <div className="scroll-thin flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-md border border-border bg-[var(--bg-chrome)] px-1.5 py-1">
              {current ? (
                crumbsFor(current.path, current.home).map((crumb, index) => (
                  <span key={crumb.path} className="flex shrink-0 items-center">
                    {index > 0 ? <ChevronRight className="h-3 w-3 text-tier-quaternary" /> : null}
                    <button
                      type="button"
                      onClick={() => navigate(crumb.path)}
                      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[13px] transition-colors hover:bg-hover ${
                        crumb.path === current.path ? 'text-foreground' : 'text-tier-secondary'
                      }`}
                    >
                      {crumb.home ? <House className="h-3 w-3" /> : null}
                      <span className="mono">{crumb.name}</span>
                    </button>
                  </span>
                ))
              ) : (
                <span className="px-1 text-[13px] text-tier-quaternary">Loading…</span>
              )}
            </div>
          )}

          <button
            type="button"
            title="Type a path"
            onClick={() => {
              setPathDraft(current?.path ?? '')
              setEditingPath((v) => !v)
            }}
            className={iconButton}
          >
            <PenLine className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={showHidden ? 'Hide hidden folders' : 'Show hidden folders'}
            onClick={() => setShowHidden((v) => !v)}
            className={iconButton}
          >
            {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            title="New folder here"
            disabled={!newFolderParent || createFolder.isPending}
            onClick={() => setNewName((v) => (v === null ? '' : null))}
            className={iconButton}
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex gap-3">
          <div className="hidden w-40 shrink-0 flex-col gap-0.5 sm:flex">
            {(places.data ?? []).map((place) => (
              <button
                key={place.path}
                type="button"
                onClick={() => navigate(place.path)}
                title={place.path}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-hover ${
                  current?.path === place.path ? 'bg-hover text-foreground' : 'text-tier-secondary'
                }`}
              >
                {place.name === 'Home' ? (
                  <House className="h-3.5 w-3.5 shrink-0 text-tier-tertiary" />
                ) : (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-tier-tertiary" />
                )}
                <span className="truncate">{place.name}</span>
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-tier-quaternary" />
              <input
                value={filter}
                placeholder="Filter folders in this directory…"
                aria-label="Filter folders"
                onChange={(event) => setFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    moveSelection(1)
                    listRef.current?.focus()
                  }
                  if (event.key === 'Enter' && visible.length > 0) {
                    event.preventDefault()
                    navigate((selected ?? visible[0]).path)
                  }
                  if (event.key === 'Escape' && filter) {
                    event.preventDefault()
                    setFilter('')
                  }
                }}
                className={`${inputClass} pl-7 text-[13px]`}
              />
              {filter ? (
                <button
                  type="button"
                  aria-label="Clear filter"
                  onClick={() => setFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-tier-quaternary hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            {newName !== null ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={newName}
                  placeholder="new-project"
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void submitNewFolder()
                    }
                    if (event.key === 'Escape') setNewName(null)
                  }}
                  className={`${inputClass} mono text-[13px]`}
                />
                <Button
                  variant="ghost"
                  onClick={() => void submitNewFolder()}
                  disabled={!newName.trim() || !!nameError || createFolder.isPending}
                  title={nameError ?? undefined}
                >
                  {createFolder.isPending ? 'Creating…' : 'Create'}
                </Button>
              </div>
            ) : null}

            {newName !== null ? (
              <p className="mono truncate text-ui-sm text-tier-quaternary" title={newFolderParent}>
                {nameError ?? `in ${newFolderParent} · starts as an empty git repo`}
              </p>
            ) : null}

            <div
              ref={listRef}
              tabIndex={0}
              role="listbox"
              aria-label="Folders"
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  moveSelection(1)
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  moveSelection(-1)
                }
                if (event.key === 'Enter' && selected) {
                  event.preventDefault()
                  navigate(selected.path)
                }
                if (event.key === 'Backspace' && current?.parent) {
                  event.preventDefault()
                  navigate(current.parent)
                }
              }}
              className="scroll-thin h-72 overflow-auto rounded-md border border-border bg-[var(--bg-chrome)] p-1 outline-none focus-visible:border-[var(--base)]"
            >
              {listing.isLoading && !current ? (
                <div className="px-2 py-2 text-ui-sm text-tier-quaternary">Loading folders…</div>
              ) : visible.length > 0 ? (
                visible.map((entry) => (
                  <div
                    key={entry.path}
                    data-path={entry.path}
                    role="option"
                    aria-selected={selected?.path === entry.path}
                    tabIndex={-1}
                    title={entry.path}
                    onClick={() => setSelected(entry)}
                    onDoubleClick={() => navigate(entry.path)}
                    className={`flex cursor-default items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-hover ${
                      selected?.path === entry.path
                        ? 'bg-hover text-foreground'
                        : 'text-tier-secondary'
                    }`}
                  >
                    {entry.isGitRepo ? (
                      <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-[var(--base)]" />
                    ) : (
                      <Folder className="h-3.5 w-3.5 shrink-0 text-tier-tertiary" />
                    )}
                    <span className="mono truncate text-[13px]">{entry.name}</span>
                    {entry.isGitRepo ? (
                      <span className="ml-auto shrink-0 text-ui-sm text-tier-quaternary">git</span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Open ${entry.name}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        navigate(entry.path)
                      }}
                      className={`shrink-0 rounded p-0.5 text-tier-quaternary hover:text-foreground ${
                        entry.isGitRepo ? '' : 'ml-auto'
                      }`}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="px-2 py-2 text-ui-sm text-tier-quaternary">
                  {filter ? `No folders match “${filter}”` : 'No subfolders'}
                </div>
              )}
            </div>
          </div>
        </div>

        {[listing.error, createFolder.error, add.error].map((error, index) =>
          error ? (
            <p
              key={index}
              className="rounded-md border border-border px-3 py-2 text-ui-base text-tier-secondary"
            >
              {error instanceof Error ? error.message : String(error)}
            </p>
          ) : null,
        )}

        <div className="flex items-center gap-3 border-t border-border pt-3">
          <div className="min-w-0 flex-1">
            <p className="mono truncate text-[13px] text-foreground" title={target?.path}>
              {target?.path ?? '—'}
            </p>
            <p className="text-ui-sm text-tier-quaternary">
              {target
                ? target.isGitRepo
                  ? selected
                    ? 'git repo · double-click a folder to open it'
                    : 'git repo · this folder'
                  : 'not a git repo — open a repo folder, or make a new one'
                : ''}
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!target?.isGitRepo || add.isPending}>
            {add.isPending ? 'Adding…' : 'Add project'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
