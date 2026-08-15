/**
 * CodeMirror-backed file editor with an inline diff view.
 *
 * "Edit" shows the working-tree content and can save it back; "Diff" shows a
 * merge view of the on-disk file against the version last loaded from the
 * server, so unsaved edits are visible before committing to them.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { AlertTriangle, Columns2, FileCode, Loader2, Pencil, Save, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as fns from '../../fns'
import {
  languageForPath,
  workspaceEditorTheme,
  workspaceSyntaxHighlighting,
} from '../../lib/editorTheme'

type Mode = 'edit' | 'diff'

/** Read-only merge view comparing saved content against the live buffer. */
function DiffView({
  original,
  modified,
  path,
}: {
  original: string
  modified: string
  path: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const extensions = useMemo(
    () => [
      workspaceEditorTheme,
      workspaceSyntaxHighlighting,
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
      ...languageForPath(path),
    ],
    [path],
  )

  useEffect(() => {
    if (!host.current) return
    const view = new MergeView({
      a: { doc: original, extensions },
      b: { doc: modified, extensions },
      parent: host.current,
      collapseUnchanged: { margin: 3, minSize: 6 },
      highlightChanges: true,
    })
    return () => view.destroy()
  }, [original, modified, extensions])

  return <div ref={host} className="h-full overflow-auto text-[12.5px]" />
}

export function FileEditor({
  runId,
  path,
  onClose,
}: {
  runId: string
  path: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<Mode>('edit')
  const [draft, setDraft] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  const file = useQuery({
    queryKey: ['workspace-file', runId, path],
    queryFn: () => fns.readWorkspaceFile({ data: { runId, path } }),
    staleTime: 0,
  })

  // Reset the buffer whenever a different file (or fresh content) arrives.
  const saved = file.data?.content ?? ''
  useEffect(() => {
    setDraft(saved)
    setSaveError(null)
    setMode('edit')
  }, [saved, path])

  const save = useMutation({
    mutationFn: (content: string) => fns.writeWorkspaceFile({ data: { runId, path, content } }),
    onSuccess: () => {
      setSaveError(null)
      // Refresh the file and any diff/status views that depend on it.
      qc.invalidateQueries({ queryKey: ['workspace-file', runId, path] })
      qc.invalidateQueries({ queryKey: ['conversation', runId] })
    },
    onError: (err: unknown) => {
      setSaveError(err instanceof Error ? err.message : String(err))
    },
  })

  const readOnly = file.data?.readOnly ?? false
  const dirty = !readOnly && draft !== saved

  // Cmd/Ctrl+S saves without leaving the editor.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty && !save.isPending) save.mutate(draft)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dirty, draft, save])

  const extensions = useMemo(
    () => [workspaceSyntaxHighlighting, EditorView.lineWrapping, ...languageForPath(path)],
    [path],
  )

  const fileName = path.slice(path.lastIndexOf('/') + 1)

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-elevated">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="mono min-w-0 flex-1 truncate text-[12px] text-foreground" title={path}>
          {fileName}
          {dirty ? <span className="ml-1.5 text-[var(--modified)]">●</span> : null}
        </span>

        {!readOnly ? (
          <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5">
            {(
              [
                ['edit', 'Edit', Pencil],
                ['diff', 'Diff', Columns2],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                title={label}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                  mode === id
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {!readOnly ? (
          <button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(draft)}
            title="Save (Ctrl/Cmd+S)"
            className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-[var(--bg-luminous-quaternary)] px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-[var(--bg-luminous-tertiary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {save.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save
          </button>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          title="Close file — back to the tree"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-[var(--bg-luminous-quaternary)] hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {saveError ? (
        <div className="flex shrink-0 items-start gap-1.5 border-b border-[var(--danger)]/25 bg-[var(--danger)]/10 px-3 py-1.5 text-[11.5px] text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{saveError}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {file.isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : file.isError ? (
          <div className="p-4 text-[12.5px] text-[var(--danger)]">
            {file.error instanceof Error ? file.error.message : 'Failed to open file'}
          </div>
        ) : readOnly ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
            <FileCode className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-[12.5px] text-muted-foreground">
              {file.data?.reason ?? 'This file cannot be opened.'}
            </p>
          </div>
        ) : mode === 'diff' ? (
          <DiffView original={saved} modified={draft} path={path} />
        ) : (
          <CodeMirror
            value={draft}
            onChange={setDraft}
            extensions={extensions}
            theme={workspaceEditorTheme}
            height="100%"
            className="h-full"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: true,
              highlightActiveLineGutter: true,
              autocompletion: false,
              bracketMatching: true,
              closeBrackets: true,
              searchKeymap: true,
            }}
          />
        )}
      </div>
    </div>
  )
}
