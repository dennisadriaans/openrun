/**
 * Lazy workspace file tree.
 *
 * Each directory fetches its children only when expanded, so opening a large
 * repository never blocks on a full recursive walk.
 */
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder, FolderOpen, Loader2 } from 'lucide-react'
import * as fns from '../../fns'
import type { FileEntry } from '../../server/files'
import { FileTypeIcon } from '../FileTypeIcon'

function useDirectory(runId: string, dir: string, enabled: boolean) {
  return useQuery({
    queryKey: ['workspace-files', runId, dir],
    queryFn: () => fns.listWorkspaceFiles({ data: { runId, dir } }),
    enabled,
    staleTime: 15_000,
  })
}

function Entry({
  entry,
  runId,
  depth,
  selectedPath,
  onSelect,
  changedPaths,
  expandedDirs,
  onToggleDir,
}: {
  entry: FileEntry
  runId: string
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
  changedPaths: Set<string>
  expandedDirs: Set<string>
  onToggleDir: (dir: string) => void
}) {
  const expanded = expandedDirs.has(entry.path)
  const isDir = entry.kind === 'directory'
  const isSelected = !isDir && selectedPath === entry.path
  const isChanged = changedPaths.has(entry.path)

  // Indent via padding so the whole row stays a full-width hit target.
  const indent = { paddingLeft: `${depth * 12 + 8}px` }

  return (
    <>
      <button
        type="button"
        style={indent}
        onClick={() => (isDir ? onToggleDir(entry.path) : onSelect(entry.path))}
        title={entry.path}
        className={`flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[12.5px] transition-colors ${
          isSelected
            ? 'bg-secondary text-foreground'
            : 'text-muted-foreground hover:bg-[var(--bg-luminous-quaternary)] hover:text-foreground'
        }`}
      >
        {isDir ? (
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isDir ? (
          expanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--blue)]/70" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--blue)]/70" />
          )
        ) : (
          <FileTypeIcon path={entry.path} className="h-3.5 w-3.5" />
        )}
        <span className={`min-w-0 flex-1 truncate ${isChanged ? 'text-[var(--modified)]' : ''}`}>
          {entry.name}
        </span>
        {isChanged ? (
          <span className="size-1.5 shrink-0 rounded-full bg-[var(--modified)]" />
        ) : null}
      </button>

      {isDir && expanded ? (
        <DirectoryChildren
          runId={runId}
          dir={entry.path}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
          changedPaths={changedPaths}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
        />
      ) : null}
    </>
  )
}

function DirectoryChildren({
  runId,
  dir,
  depth,
  selectedPath,
  onSelect,
  changedPaths,
  expandedDirs,
  onToggleDir,
}: {
  runId: string
  dir: string
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
  changedPaths: Set<string>
  expandedDirs: Set<string>
  onToggleDir: (dir: string) => void
}) {
  const { data, isLoading, isError } = useDirectory(runId, dir, true)

  if (isLoading) {
    return (
      <div
        style={{ paddingLeft: `${depth * 12 + 26}px` }}
        className="flex items-center gap-1.5 py-1 text-[11.5px] text-muted-foreground/60"
      >
        <Loader2 className="h-3 w-3 animate-spin" /> Loading…
      </div>
    )
  }
  if (isError) {
    return (
      <div
        style={{ paddingLeft: `${depth * 12 + 26}px` }}
        className="py-1 text-[11.5px] text-[var(--danger)]"
      >
        Failed to read folder
      </div>
    )
  }

  const entries = data?.entries ?? []
  if (entries.length === 0) {
    return (
      <div
        style={{ paddingLeft: `${depth * 12 + 26}px` }}
        className="py-1 text-[11.5px] text-muted-foreground/50"
      >
        Empty
      </div>
    )
  }

  return (
    <>
      {entries.map((entry) => (
        <Entry
          key={entry.path}
          entry={entry}
          runId={runId}
          depth={depth}
          selectedPath={selectedPath}
          onSelect={onSelect}
          changedPaths={changedPaths}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
        />
      ))}
    </>
  )
}

export function FileTree({
  runId,
  selectedPath,
  onSelect,
  changedPaths,
  expandedDirs,
  onToggleDir,
}: {
  runId: string
  selectedPath: string | null
  onSelect: (path: string) => void
  /** Paths with uncommitted changes, highlighted in the tree. */
  changedPaths?: Set<string>
  /** Owned by the parent so expansion survives the tree unmounting behind the editor. */
  expandedDirs: Set<string>
  onToggleDir: (dir: string) => void
}) {
  return (
    <div className="py-1">
      <DirectoryChildren
        runId={runId}
        dir=""
        depth={0}
        selectedPath={selectedPath}
        onSelect={onSelect}
        changedPaths={changedPaths ?? new Set()}
        expandedDirs={expandedDirs}
        onToggleDir={onToggleDir}
      />
    </div>
  )
}
