/**
 * Pending image attachments in the composer.
 *
 * Files upload as soon as they are dropped, pasted or picked, so pressing Enter
 * never waits on a network round-trip. What the agent gets is the workspace
 * path the upload returned — see `lib/attachments.ts`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_MESSAGE,
  attachmentRefusal,
  formatAttachmentSize,
  isAcceptedImageType,
} from '../../lib/attachments'

export type PendingAttachment = {
  id: string
  name: string
  size: number
  /** Object URL for the local preview; revoked when the entry goes away. */
  previewUrl: string
  /** Workspace-relative path, once the upload lands. */
  path?: string
  error?: string
}

export type AttachmentUploader = (file: File) => Promise<{ path: string }>

export function usePendingAttachments(upload: AttachmentUploader | undefined) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [refusal, setRefusal] = useState('')
  const urls = useRef(new Set<string>())
  // Mirrors `attachments` so a second drop in the same tick counts what the
  // first one added.
  const list = useRef<PendingAttachment[]>([])

  const forget = useCallback((url: string) => {
    if (!urls.current.has(url)) return
    URL.revokeObjectURL(url)
    urls.current.delete(url)
  }, [])

  useEffect(() => {
    list.current = attachments
  }, [attachments])

  useEffect(() => {
    const tracked = urls.current
    return () => {
      for (const url of tracked) URL.revokeObjectURL(url)
      tracked.clear()
    }
  }, [])

  const addFiles = useCallback(
    (files: File[]) => {
      if (!upload || files.length === 0) return
      let count = list.current.length
      const accepted: PendingAttachment[] = []
      let why = ''
      for (const file of files) {
        const refused = attachmentRefusal(file, count)
        if (refused) {
          why = refused
          continue
        }
        const previewUrl = URL.createObjectURL(file)
        urls.current.add(previewUrl)
        const id = `${Date.now().toString(36)}-${count}-${Math.random().toString(36).slice(2, 8)}`
        accepted.push({ id, name: file.name, size: file.size, previewUrl })
        count += 1

        void upload(file)
          .then(({ path }) =>
            setAttachments((rows) => rows.map((row) => (row.id === id ? { ...row, path } : row))),
          )
          .catch((err: unknown) =>
            setAttachments((rows) =>
              rows.map((row) =>
                row.id === id
                  ? { ...row, error: err instanceof Error ? err.message : 'Upload failed' }
                  : row,
              ),
            ),
          )
      }
      setRefusal(why)
      if (accepted.length) {
        list.current = [...list.current, ...accepted]
        setAttachments(list.current)
      }
    },
    [upload],
  )

  const remove = useCallback(
    (id: string) => {
      const row = list.current.find((r) => r.id === id)
      if (row) forget(row.previewUrl)
      list.current = list.current.filter((r) => r.id !== id)
      setAttachments(list.current)
    },
    [forget],
  )

  const clear = useCallback(() => {
    for (const row of list.current) forget(row.previewUrl)
    list.current = []
    setAttachments(list.current)
    setRefusal('')
  }, [forget])

  return {
    attachments,
    refusal,
    addFiles,
    remove,
    clear,
    full: attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE,
    uploading: attachments.some((row) => !row.path && !row.error),
    failed: attachments.some((row) => row.error),
    paths: attachments.flatMap((row) => (row.path ? [row.path] : [])),
  }
}

/** Images a `DataTransfer` carries, ignoring everything else it holds. */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  return Array.from(data.files).filter((file) => isAcceptedImageType(file.type))
}

export function AttachmentButton({
  disabled,
  onFiles,
}: {
  disabled: boolean
  onFiles: (files: File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        aria-label="Attach images"
        title="Attach images"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors enabled:cursor-pointer enabled:hover:bg-muted/60 enabled:hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      >
        <Paperclip className="size-3.5" />
      </button>
    </>
  )
}

export function AttachmentStrip({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[]
  onRemove: (id: string) => void
}) {
  if (attachments.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2 pb-2">
      {attachments.map((row) => (
        <div
          key={row.id}
          className={`group relative h-16 w-16 overflow-hidden rounded-lg border ${
            row.error ? 'border-danger' : 'border-border'
          }`}
          title={row.error ? `${row.name} — ${row.error}` : `${row.name} · ${formatAttachmentSize(row.size)}`}
        >
          <img src={row.previewUrl} alt={row.name} className="h-full w-full object-cover" />
          {!row.path && !row.error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
            </div>
          ) : null}
          {row.error ? (
            <div className="absolute inset-x-0 bottom-0 bg-danger/85 px-1 py-0.5 text-[10px] text-white">
              Failed
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(row.id)}
            aria-label={`Remove ${row.name}`}
            className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/85 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            <X className="size-2.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
