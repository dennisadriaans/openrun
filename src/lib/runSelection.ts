export type SelectableRun = { id: string; status: string }

export function deletableRunIds(runs: readonly SelectableRun[]): string[] {
  return runs.filter((run) => run.status !== 'running').map((run) => run.id)
}

/** Keep selection scoped to the rows currently visible on the page. */
export function normalizeRunSelection(
  selectedIds: readonly string[],
  visibleRuns: readonly SelectableRun[],
): string[] {
  const visible = new Set(deletableRunIds(visibleRuns))
  const normalized = [...new Set(selectedIds)].filter((id) => visible.has(id))
  if (
    normalized.length === selectedIds.length &&
    normalized.every((id, i) => id === selectedIds[i])
  ) {
    // Returning the existing state lets React bail out even when a demo or
    // refetch supplies a fresh visible-runs array on every render.
    return selectedIds as string[]
  }
  return normalized
}

export function toggleRunSelection(
  selectedIds: readonly string[],
  runId: string,
  checked: boolean,
): string[] {
  const selected = new Set(selectedIds)
  if (checked) selected.add(runId)
  else selected.delete(runId)
  return [...selected]
}

export function pageSelectionState(
  selectedIds: readonly string[],
  visibleRuns: readonly SelectableRun[],
): { ids: string[]; checked: boolean; indeterminate: boolean } {
  const ids = deletableRunIds(visibleRuns)
  const selected = new Set(selectedIds)
  const selectedCount = ids.filter((id) => selected.has(id)).length
  return {
    ids,
    checked: ids.length > 0 && selectedCount === ids.length,
    indeterminate: selectedCount > 0 && selectedCount < ids.length,
  }
}

export function normalizeRunPage(page: number, total: number, pageSize: number): number {
  const totalPages = Math.max(1, Math.ceil(Math.max(0, total) / pageSize))
  return Math.min(Math.max(1, Math.trunc(page)), totalPages)
}

export function runPageNormalizationTarget(input: {
  page: number
  total: number
  pageSize: number
  countReady: boolean
  rowsLoaded: boolean
  rowCount: number
}): number | null {
  if (!input.countReady) return null

  const validPage = normalizeRunPage(input.page, input.total, input.pageSize)
  if (input.page !== validPage) return validPage

  // A successful count can briefly race a freshly refetched empty page after
  // deleting its last row. Step back while the count catches up.
  if (input.page > 1 && input.rowsLoaded && input.rowCount === 0) return input.page - 1
  return null
}
