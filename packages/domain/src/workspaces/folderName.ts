/**
 * Name rules for a folder created from the Add Project picker.
 *
 * Browser-safe and dependency-free on purpose: the same module runs in the
 * modal (to disable Create and say why) and on the server write path (to refuse
 * the mkdir), so the two cannot drift. The rules exist because that mkdir runs
 * with the app user's own filesystem rights — a separator or `..` would let the
 * picker write outside the folder the user is looking at.
 */

/** Human-readable reason the name is unusable, or null when it is fine. */
export function folderNameError(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'A folder name is required'
  if (trimmed === '.' || trimmed === '..') return `Invalid folder name: ${trimmed}`
  if (/[/\\]/.test(trimmed)) return 'A folder name cannot contain a path separator'
  if (/\0/.test(trimmed)) return 'A folder name cannot contain a null byte'
  return null
}

export function assertFolderName(name: string): string {
  const err = folderNameError(name)
  if (err) throw new Error(err)
  return name.trim()
}
