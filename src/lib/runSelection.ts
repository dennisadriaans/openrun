import { normalizeSelection, selectionState, toggleSelection } from './listSelection.ts'

export type SelectableRun = { id: string; status: string }

export function deletableRunIds(runs: readonly SelectableRun[]): string[] {
  return runs.filter((run) => run.status !== 'running').map((run) => run.id)
}

/** Keep selection scoped to the rows currently visible on the page. */
export function normalizeRunSelection(
  selectedIds: readonly string[],
  visibleRuns: readonly SelectableRun[],
): string[] {
  return normalizeSelection(selectedIds, deletableRunIds(visibleRuns))
}

export function toggleRunSelection(
  selectedIds: readonly string[],
  runId: string,
  checked: boolean,
): string[] {
  return toggleSelection(selectedIds, runId, checked)
}

export function pageSelectionState(
  selectedIds: readonly string[],
  visibleRuns: readonly SelectableRun[],
): { ids: string[]; checked: boolean; indeterminate: boolean } {
  return selectionState(selectedIds, deletableRunIds(visibleRuns))
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
