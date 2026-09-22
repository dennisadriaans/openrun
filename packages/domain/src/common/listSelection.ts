/**
 * Checkbox selection over a list of rows. Runs and Automations both let you
 * tick rows and delete the lot, so the state lives here once.
 */

/** Keep selection scoped to the rows currently visible and still selectable. */
export function normalizeSelection(
  selectedIds: readonly string[],
  selectableIds: readonly string[],
): string[] {
  const selectable = new Set(selectableIds)
  const normalized = [...new Set(selectedIds)].filter((id) => selectable.has(id))
  if (
    normalized.length === selectedIds.length &&
    normalized.every((id, i) => id === selectedIds[i])
  ) {
    // Returning the existing state lets React bail out even when a demo or
    // refetch supplies a fresh visible-rows array on every render.
    return selectedIds as string[]
  }
  return normalized
}

export function toggleSelection(
  selectedIds: readonly string[],
  id: string,
  checked: boolean,
): string[] {
  const selected = new Set(selectedIds)
  if (checked) selected.add(id)
  else selected.delete(id)
  return [...selected]
}

export function selectionState(
  selectedIds: readonly string[],
  selectableIds: readonly string[],
): { ids: string[]; checked: boolean; indeterminate: boolean } {
  const ids = [...selectableIds]
  const selected = new Set(selectedIds)
  const selectedCount = ids.filter((id) => selected.has(id)).length
  return {
    ids,
    checked: ids.length > 0 && selectedCount === ids.length,
    indeterminate: selectedCount > 0 && selectedCount < ids.length,
  }
}
