import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  FolderGit2,
  FolderPlus,
  House,
} from 'lucide-react'
import { useState } from 'react'
import * as fns from '../fns'
import type { LocalDirEntry } from '../fns'
import { folderNameError } from '../lib/folderName'
import { useAddProject, useCreateLocalFolder } from '../lib/queries'
import { Button, Field, Modal, inputClass } from './ui'

export type AddedProject = {
  id: string
  name: string
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
  // `root` is the directory the tree is anchored at (driven by Home/Up).
  const [root, setRoot] = useState<string | undefined>(undefined)
  // `selected` is the folder highlighted for adding — its full absolute path.
  const [selected, setSelected] = useState<{ path: string; isGitRepo: boolean } | null>(null)
  // Non-null while the inline "new folder" name input is open.
  const [newName, setNewName] = useState<string | null>(null)

  const listing = useQuery({
    queryKey: ['local-directories', root ?? ''],
    queryFn: () => fns.listLocalDirectories({ data: { dir: root } }),
  })

  const current = listing.data
  const newFolderParent = selected?.path ?? current?.path

  // Empty while the input is untouched — an error before typing reads as a scold.
  const nameError = newName === null || newName === '' ? null : folderNameError(newName)

  const submitNewFolder = async () => {
    const name = (newName ?? '').trim()
    if (!name || nameError || !newFolderParent) return
    const created = await createFolder.mutateAsync({ parent: newFolderParent, name })
    setNewName(null)
    // Anchor at the parent so the folder we just made is visible at depth 0.
    setRoot(newFolderParent)
    setSelected({ path: created.path, isGitRepo: true })
  }

  const submit = async () => {
    if (!selected) return
    const project = await add.mutateAsync({ mode: 'register', path: selected.path })
    onAdded?.({ id: project.id, name: project.name })
    onClose()
  }

  return (
    <Modal title="Add project" onClose={onClose}>
      <div className="space-y-4">
        <Field
          label="Local folder"
          hint={selected?.isGitRepo ? 'git repo' : 'pick a git repo folder, or make a new one'}
        >
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title="Home"
                disabled={!current || current.path === current.home}
                onClick={() => {
                  setRoot(current?.home)
                  setSelected(null)
                }}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-tier-tertiary transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <House className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Parent folder"
                disabled={!current?.parent}
                onClick={() => {
                  if (current?.parent) {
                    setRoot(current.parent)
                    setSelected(null)
                  }
                }}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-tier-tertiary transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="New empty folder here"
                disabled={!newFolderParent || createFolder.isPending}
                onClick={() => setNewName((v) => (v === null ? '' : null))}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-tier-tertiary transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
              <div
                className={`${inputClass} mono truncate text-[13px]`}
                title={selected?.path ?? current?.path ?? undefined}
              >
                {listing.isLoading && !current
                  ? 'Loading…'
                  : (selected?.path ?? current?.path ?? '—')}
              </div>
            </div>

            {newName !== null ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={newName}
                  placeholder="new-project"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void submitNewFolder()
                    }
                    if (e.key === 'Escape') setNewName(null)
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

            {newName !== null && nameError ? (
              <p className="text-ui-sm text-tier-secondary">{nameError}</p>
            ) : newName !== null && newFolderParent ? (
              <p className="mono truncate text-ui-sm text-tier-quaternary" title={newFolderParent}>
                in {newFolderParent} · starts as an empty git repo
              </p>
            ) : null}

            <div className="scroll-thin max-h-72 min-h-[9rem] overflow-auto rounded-md border border-border bg-[var(--bg-chrome)] p-1">
              {listing.isLoading && !current ? (
                <div className="px-2 py-2 text-ui-sm text-tier-quaternary">Loading folders…</div>
              ) : current && current.entries.length > 0 ? (
                current.entries.map((entry) => (
                  <TreeNode
                    key={entry.path}
                    entry={entry}
                    depth={0}
                    selectedPath={selected?.path ?? null}
                    onSelect={(e) => setSelected({ path: e.path, isGitRepo: e.isGitRepo })}
                  />
                ))
              ) : (
                <div className="px-2 py-2 text-ui-sm text-tier-quaternary">No subfolders</div>
              )}
            </div>
          </div>
        </Field>

        {add.isError ? (
          <p className="rounded-md border border-border px-3 py-2 text-ui-base text-tier-secondary">
            {add.error instanceof Error ? add.error.message : String(add.error)}
          </p>
        ) : null}

        {createFolder.isError ? (
          <p className="rounded-md border border-border px-3 py-2 text-ui-base text-tier-secondary">
            {createFolder.error instanceof Error
              ? createFolder.error.message
              : String(createFolder.error)}
          </p>
        ) : null}

        {listing.isError ? (
          <p className="rounded-md border border-border px-3 py-2 text-ui-base text-tier-secondary">
            {listing.error instanceof Error ? listing.error.message : String(listing.error)}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!selected?.isGitRepo || add.isPending}
          >
            {add.isPending ? 'Adding…' : 'Add project'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Tree node — one folder row that lazily loads and expands its children.
// ---------------------------------------------------------------------------

function TreeNode({
  entry,
  depth,
  selectedPath,
  onSelect,
}: {
  entry: LocalDirEntry
  depth: number
  selectedPath: string | null
  onSelect: (entry: LocalDirEntry) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = selectedPath === entry.path

  // Children are fetched only after the node is expanded for the first time.
  const children = useQuery({
    queryKey: ['local-directories', entry.path],
    queryFn: () => fns.listLocalDirectories({ data: { dir: entry.path } }),
    enabled: open,
  })

  const Chevron = open ? ChevronDown : ChevronRight
  const Icon = entry.isGitRepo ? FolderGit2 : Folder

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onSelect(entry)
          setOpen((v) => !v)
        }}
        title={entry.path}
        className={`flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left transition-colors hover:bg-hover ${
          selected ? 'bg-hover text-foreground' : 'text-tier-secondary'
        }`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <Chevron className="h-3.5 w-3.5 shrink-0 text-tier-quaternary" />
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${entry.isGitRepo ? 'text-[var(--base)]' : 'text-tier-tertiary'}`}
        />
        <span className="mono truncate text-[13px]">{entry.name}</span>
        {entry.isGitRepo ? (
          <span className="ml-auto shrink-0 text-ui-sm text-tier-quaternary">git</span>
        ) : null}
      </button>

      {open ? (
        <div>
          {children.isLoading ? (
            <div
              className="py-1 text-ui-sm text-tier-quaternary"
              style={{ paddingLeft: `${(depth + 1) * 14 + 22}px` }}
            >
              Loading…
            </div>
          ) : children.data && children.data.entries.length > 0 ? (
            children.data.entries.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))
          ) : children.isError ? (
            <div
              className="py-1 text-ui-sm text-tier-secondary"
              style={{ paddingLeft: `${(depth + 1) * 14 + 22}px` }}
            >
              {children.error instanceof Error ? children.error.message : 'Failed to read folder'}
            </div>
          ) : (
            <div
              className="py-1 text-ui-sm text-tier-quaternary"
              style={{ paddingLeft: `${(depth + 1) * 14 + 22}px` }}
            >
              Empty
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
