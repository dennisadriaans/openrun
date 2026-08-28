/**
 * Image attachments for the composer.
 *
 * Browser-safe and dependency-free: the same rules run in the drop handler and
 * on the server write path, so the UI refuses a file with the exact message the
 * server would have thrown.
 *
 * An attachment is written into the workspace as a file and referenced from the
 * prompt by its relative path. Every runtime can read a file; only some speak
 * inline image content, so the path is the one thing they all understand.
 */

/** Where attachments land, relative to the workspace root. */
export const ATTACHMENT_DIR = '.openrun/attachments'

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

export const MAX_ATTACHMENTS_PER_MESSAGE = 5

export const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** File input `accept` value and the drop-zone's own check. */
export const ATTACHMENT_ACCEPT = ACCEPTED_IMAGE_TYPES.join(',')

export function isAcceptedImageType(type: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Why this file cannot be attached, or null when it can. */
export function attachmentRefusal(
  file: { type: string; size: number },
  alreadyAttached = 0,
): string | null {
  if (!isAcceptedImageType(file.type)) {
    return 'Only PNG, JPEG, WebP and GIF images can be attached'
  }
  if (file.size <= 0) return 'That image is empty'
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `Images must be under ${formatAttachmentSize(MAX_ATTACHMENT_BYTES)}`
  }
  if (alreadyAttached >= MAX_ATTACHMENTS_PER_MESSAGE) {
    return `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} images per message`
  }
  return null
}

/**
 * A collision-free, traversal-free file name.
 *
 * The original name is only a hint — it is stripped to word characters so a
 * dropped file can never steer the write outside the attachments directory.
 */
export function attachmentFileName(
  originalName: string,
  mimeType: string,
  unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
): string {
  const ext = EXTENSIONS[mimeType] ?? 'png'
  const stem =
    (originalName.split(/[\\/]/).pop() ?? '')
      .replace(/\.[^.]*$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image'
  return `${stem}-${unique}.${ext}`
}

/** Workspace-relative path an attachment file name resolves to. */
export function attachmentPath(fileName: string): string {
  return `${ATTACHMENT_DIR}/${fileName}`
}

const ATTACHMENT_HEADING = 'Attached images (read them from the workspace):'

/**
 * Fold attachment paths into the prompt the agent receives.
 *
 * Kept out of the message body so the user's own words stay first, and so the
 * transcript can lift the list back out with `attachmentPathsIn`.
 */
export function promptWithAttachments(text: string, paths: string[]): string {
  const body = text.trim()
  if (paths.length === 0) return body
  const list = paths.map((path) => `- ${path}`).join('\n')
  return body ? `${body}\n\n${ATTACHMENT_HEADING}\n${list}` : `${ATTACHMENT_HEADING}\n${list}`
}

/** Attachment paths referenced by a stored prompt, in order. */
export function attachmentPathsIn(text: string): string[] {
  const paths: string[] = []
  for (const line of text.split('\n')) {
    const match = line.match(/^-\s+(\.openrun\/attachments\/[^\s]+)$/)
    if (match?.[1]) paths.push(match[1])
  }
  return paths
}

/** The prompt without its attachment block — what the transcript shows. */
export function promptWithoutAttachments(text: string): string {
  const index = text.indexOf(ATTACHMENT_HEADING)
  if (index < 0) return text
  return text.slice(0, index).trimEnd()
}

/** Base64 for the upload RPC, without the data-URL prefix. */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Chunked: spreading a multi-megabyte array into `fromCharCode` overflows the
  // call stack.
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
