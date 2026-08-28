/**
 * Writing composer image attachments into a run workspace.
 *
 * The file has to live inside the workspace: a sandboxed CLI may only read
 * below its own cwd, so an image parked in a temp directory is invisible to
 * half the runtimes. To keep the repo clean it goes under `.openrun/` and that
 * directory is added to `.git/info/exclude` — local-only, so the user's own
 * `.gitignore` is never touched and the Files Changed panel stays quiet.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import {
  ATTACHMENT_DIR,
  MAX_ATTACHMENT_BYTES,
  attachmentFileName,
  attachmentPath,
  attachmentRefusal,
} from '../lib/attachments.ts'

export type SavedAttachment = {
  /** Workspace-relative POSIX path, as referenced from the prompt. */
  path: string
  fileName: string
  size: number
  mimeType: string
}

const SAFE_ATTACHMENT = /^\.openrun\/attachments\/[A-Za-z0-9._-]+$/

function excludeAttachments(cwd: string): void {
  const res = spawnSync('git', ['-C', cwd, 'rev-parse', '--git-path', 'info/exclude'], {
    encoding: 'utf8',
  })
  if (res.status !== 0) return
  const relative = res.stdout.trim()
  if (!relative) return
  const file = resolve(cwd, relative)
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (current.split('\n').some((line) => line.trim() === '.openrun/')) return
  mkdirSync(dirname(file), { recursive: true })
  if (current) appendFileSync(file, current.endsWith('\n') ? '.openrun/\n' : '\n.openrun/\n')
  else writeFileSync(file, '.openrun/\n')
}

export function saveAttachment(input: {
  cwd: string
  name: string
  mimeType: string
  /** Raw base64, no data-URL prefix. */
  data: string
}): SavedAttachment {
  const bytes = Buffer.from(input.data, 'base64')
  const refusal = attachmentRefusal({ type: input.mimeType, size: bytes.byteLength })
  if (refusal) throw new Error(refusal)
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('That image is too large')

  const fileName = attachmentFileName(input.name, input.mimeType)
  const dir = join(input.cwd, ...ATTACHMENT_DIR.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, fileName), bytes)
  excludeAttachments(input.cwd)

  return {
    path: attachmentPath(fileName),
    fileName,
    size: bytes.byteLength,
    mimeType: input.mimeType,
  }
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** Read an attachment back for display; refuses anything outside the directory. */
export function readAttachment(cwd: string, path: string): { bytes: Buffer; mimeType: string } {
  if (!SAFE_ATTACHMENT.test(path)) throw new Error('Not an attachment path')
  const file = join(cwd, ...path.split('/'))
  const root = resolve(cwd)
  if (!resolve(file).startsWith(root + sep)) throw new Error('Not an attachment path')
  if (!existsSync(file)) throw new Error('Attachment not found')
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return { bytes: readFileSync(file), mimeType: MIME_BY_EXT[ext] ?? 'application/octet-stream' }
}
