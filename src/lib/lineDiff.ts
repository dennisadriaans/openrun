/**
 * Line diff for text an agent supplies directly.
 *
 * `lib/diff.ts` parses what git already computed. An `Edit` tool call carries
 * only `old_string` / `new_string`, so the transcript has to compute the hunk
 * itself to render the same +/− rows the git panel shows.
 *
 * Pure and dependency-free — it runs in the client bundle.
 */
import type { DiffLine } from './diff.ts'

/** Above this many lines per side the LCS table costs more than it's worth. */
const MAX_LCS_LINES = 800

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function replaceAll(oldLines: string[], newLines: string[]): DiffLine[] {
  const out: DiffLine[] = []
  oldLines.forEach((content, i) => {
    out.push({ type: 'delete', oldNumber: i + 1, newNumber: null, content })
  })
  newLines.forEach((content, i) => {
    out.push({ type: 'add', oldNumber: null, newNumber: i + 1, content })
  })
  return out
}

/**
 * Longest common subsequence over whole lines, walked back into typed rows.
 *
 * Line numbers are relative to the two snippets — an `Edit` hunk has no file
 * offset, and the panel renders them as the local position in the change.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  if (oldLines.length === 0 && newLines.length === 0) return []
  if (oldLines.length === 0 || newLines.length === 0) return replaceAll(oldLines, newLines)
  if (oldLines.length > MAX_LCS_LINES || newLines.length > MAX_LCS_LINES) {
    return replaceAll(oldLines, newLines)
  }

  const rows = oldLines.length
  const cols = newLines.length
  // table[i][j] = LCS length of oldLines[i:] and newLines[j:]
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  )
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i]![j] =
        oldLines[i] === newLines[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (oldLines[i] === newLines[j]) {
      out.push({ type: 'context', oldNumber: i + 1, newNumber: j + 1, content: oldLines[i]! })
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ type: 'delete', oldNumber: i + 1, newNumber: null, content: oldLines[i]! })
      i++
    } else {
      out.push({ type: 'add', oldNumber: null, newNumber: j + 1, content: newLines[j]! })
      j++
    }
  }
  while (i < rows) {
    out.push({ type: 'delete', oldNumber: i + 1, newNumber: null, content: oldLines[i]! })
    i++
  }
  while (j < cols) {
    out.push({ type: 'add', oldNumber: null, newNumber: j + 1, content: newLines[j]! })
    j++
  }
  return out
}

export type LineDiffStats = { additions: number; deletions: number }

export function lineDiffStats(lines: DiffLine[]): LineDiffStats {
  let additions = 0
  let deletions = 0
  for (const line of lines) {
    if (line.type === 'add') additions++
    else if (line.type === 'delete') deletions++
  }
  return { additions, deletions }
}

/**
 * Drop long runs of unchanged lines, keeping `context` lines around each
 * change. Returns the kept rows and how many were elided before each one.
 */
export function collapseContext(
  lines: DiffLine[],
  context = 3,
): Array<{ line: DiffLine; skippedBefore: number }> {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((line, i) => {
    if (line.type === 'context') return
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) {
      keep[k] = true
    }
  })

  const out: Array<{ line: DiffLine; skippedBefore: number }> = []
  let skipped = 0
  lines.forEach((line, i) => {
    if (!keep[i]) {
      skipped++
      return
    }
    out.push({ line, skippedBefore: skipped })
    skipped = 0
  })
  return out
}
