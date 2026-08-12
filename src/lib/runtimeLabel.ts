/**
 * Human-facing runtime name for run list rows.
 *
 * Automations / Upcoming already decorate tasks with `runtimeLabel`. Run
 * summaries historically exposed only `runtimeId`, so Dashboard Recent and
 * Run History showed opaque ids next to labeled upcoming rows.
 */

/** Prefer the runtime's display label; fall back to id so orphan rows still identify. */
export function resolveRuntimeLabel(
  label: string | null | undefined,
  runtimeId?: string | null,
): string {
  const name = (label ?? '').trim()
  if (name) return name
  const id = (runtimeId ?? '').trim()
  if (id) return id
  return 'Unknown runtime'
}
