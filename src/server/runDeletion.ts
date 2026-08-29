import type Database from 'better-sqlite3'

/** Keep a malformed request from turning into an unbounded SQLite operation. */
export const MAX_RUN_DELETE_COUNT = 100

/** Normalize and validate the user-controlled batch before opening a transaction. */
export function normalizeRunDeleteIds(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error('Run IDs must be an array')
  if (input.length === 0) throw new Error('At least one run ID is required')
  if (input.length > MAX_RUN_DELETE_COUNT) {
    throw new Error(`Cannot delete more than ${MAX_RUN_DELETE_COUNT} runs at once`)
  }

  const ids: string[] = []
  const seen = new Set<string>()
  for (const id of input) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('Run IDs must be non-empty strings')
    }
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

/**
 * Delete terminal runs as one all-or-nothing transaction. Every row is loaded
 * and guarded before the first DELETE, so a missing or running id leaves the
 * whole request untouched.
 */
export function deleteRunsInTransaction(db: Database.Database, input: unknown): void {
  const ids = normalizeRunDeleteIds(input)
  const load = db.prepare('SELECT status FROM runs WHERE id = ?')
  const remove = db.prepare('DELETE FROM runs WHERE id = ?')

  const deleteAll = db.transaction(() => {
    const rows = ids.map((id) => load.get(id) as { status: string } | undefined)
    if (rows.some((row) => !row)) throw new Error('Run not found')
    if (rows.some((row) => row?.status === 'running')) {
      throw new Error('Cancel the run before deleting it')
    }
    for (const id of ids) remove.run(id)
  })

  deleteAll()
}
