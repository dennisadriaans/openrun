/**
 * Runtime-binary helpers shared by TaskForm / Planner (browser) and the
 * spawn path (server). Kept dependency-free so the client never pulls in
 * `which` / `spawnSync` — PATH resolution stays on the server.
 */

/** Trim; empty means "no binary configured". */
export function normalizeBin(bin: string | null | undefined): string {
  return (bin ?? '').trim()
}

/** Developer-facing error when a runtime has no binary name. */
export function emptyRuntimeBinaryMessage(): string {
  return 'Runtime binary is empty — set a binary name on the Runtimes page.'
}

/** Developer-facing error when a runtime binary is not on PATH. */
export function missingRuntimeBinaryMessage(bin: string): string {
  const name = normalizeBin(bin) || '(empty)'
  return `Runtime binary "${name}" was not found on PATH. Install the CLI, fix the binary name on the Runtimes page, or pick another installed runtime.`
}

/**
 * Throw when the binary name is blank or not resolvable on PATH.
 * Returns the trimmed binary name on success.
 */
export function assertRuntimeBinaryAvailable(
  bin: string | null | undefined,
  installed: boolean,
): string {
  const name = normalizeBin(bin)
  if (!name) throw new Error(emptyRuntimeBinaryMessage())
  if (!installed) throw new Error(missingRuntimeBinaryMessage(name))
  return name
}
