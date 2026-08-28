/**
 * Which transcript rows a settled turn hides behind its "Worked for 15s" row.
 *
 * Browser-safe and pure so the rules can be tested without rendering: the
 * component layer maps `turn_events` to `{ id, kind }` and asks here what to
 * draw. Fold shape follows the t3code timeline (MIT, T3 Tools Inc.).
 */

export type TurnRowKind = 'text' | 'work' | 'edit'

export type TurnRow = { id: string; kind: TurnRowKind }

/** Consecutive tool rows past this count collapse behind a "+N" toggle. */
export const MAX_VISIBLE_WORK_ROWS = 5

export type TurnFoldPlan = {
  /** True when there is work worth folding away. */
  foldable: boolean
  /** Rows hidden while the fold is closed. */
  hiddenIds: Set<string>
}

/**
 * A settled turn folds tool calls, thoughts, and in-progress commentary.
 * File-edit hunks stay in the response as change cards, next to the answer.
 *
 * A turn still running folds its work too — the working line is the whole
 * status; the steps behind it only ever show once the fold is opened.
 */
export function planTurnFold(rows: TurnRow[], settled: boolean): TurnFoldPlan {
  const empty: TurnFoldPlan = { foldable: false, hiddenIds: new Set() }
  if (!rows.some((row) => row.kind === 'work')) return empty

  if (!settled) {
    const workIds = new Set(rows.filter((row) => row.kind === 'work').map((row) => row.id))
    return { foldable: true, hiddenIds: workIds }
  }

  let terminalTextId: string | null = null
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!
    if (row.kind === 'text') {
      terminalTextId = row.id
      break
    }
  }

  const hiddenIds = new Set(
    rows.filter((row) => row.id !== terminalTextId && row.kind !== 'edit').map((row) => row.id),
  )
  if (hiddenIds.size === 0) return empty
  return { foldable: true, hiddenIds }
}

/**
 * A fold opens in two steps: `partial` shows the tail of the hidden work,
 * `all` replays the turn.
 */
export type TurnFoldStage = 'closed' | 'partial' | 'all'

/**
 * Rows to draw for a fold stage. `moreCount` is how many rows the `partial`
 * stage holds back — it stays the same once expanded so the toggle keeps its
 * label and position across clicks.
 */
export function foldedRows<T extends { id: string }>(
  rows: T[],
  plan: TurnFoldPlan,
  stage: TurnFoldStage,
  max: number = MAX_VISIBLE_WORK_ROWS,
): { visible: T[]; moreCount: number } {
  if (!plan.foldable) return { visible: rows, moreCount: 0 }

  const hidden = rows.filter((row) => plan.hiddenIds.has(row.id))
  const moreCount = Math.max(0, hidden.length - max)
  if (stage === 'all') return { visible: rows, moreCount }
  if (stage === 'closed') {
    return { visible: rows.filter((row) => !plan.hiddenIds.has(row.id)), moreCount }
  }

  const kept = new Set(hidden.slice(-max).map((row) => row.id))
  return {
    visible: rows.filter((row) => !plan.hiddenIds.has(row.id) || kept.has(row.id)),
    moreCount,
  }
}

/** Oldest rows of a long tool run hide first — the recent tail stays visible. */
export function workOverflow<T extends { id: string }>(
  entries: T[],
  max: number = MAX_VISIBLE_WORK_ROWS,
): { hidden: T[]; visible: T[] } {
  if (entries.length <= max) return { hidden: [], visible: entries }
  return { hidden: entries.slice(0, -max), visible: entries.slice(-max) }
}
