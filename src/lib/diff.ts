/**
 * Unified-diff parser.
 *
 * Turns `git diff` text into hunks of typed lines that the diff viewer renders
 * in either split or unified layout. Pure and dependency-free so it can run in
 * the client bundle.
 *
 * Approach adapted from the t3code diff viewer (MIT, T3 Tools Inc.).
 */

export type DiffLineType = 'context' | 'add' | 'delete'

export type DiffLine = {
  type: DiffLineType
  /** Line number in the old file, null for additions. */
  oldNumber: number | null
  /** Line number in the new file, null for deletions. */
  newNumber: number | null
  content: string
}

export type DiffHunk = {
  header: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export type ParsedDiff = {
  hunks: DiffHunk[]
  additions: number
  deletions: number
  /** True when git reported a binary file instead of text hunks. */
  binary: boolean
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

export function parseUnifiedDiff(raw: string): ParsedDiff {
  const result: ParsedDiff = { hunks: [], additions: 0, deletions: 0, binary: false }
  if (!raw) return result

  // git diff output ends with a newline; that trailing empty string is an
  // artifact of the split, not a context line in the file.
  const lines = raw.split('\n')
  if (lines.at(-1) === '') lines.pop()

  let hunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      result.binary = true
      continue
    }

    const header = line.match(HUNK_HEADER)
    if (header) {
      oldLine = Number(header[1])
      newLine = Number(header[3])
      hunk = {
        header: (header[5] ?? '').trim(),
        oldStart: oldLine,
        newStart: newLine,
        lines: [],
      }
      result.hunks.push(hunk)
      continue
    }

    // Everything before the first hunk header is file metadata.
    if (!hunk) continue

    // "\ No newline at end of file" annotates the previous line.
    if (line.startsWith('\\')) continue

    const marker = line[0]
    const content = line.slice(1)

    if (marker === '+') {
      hunk.lines.push({ type: 'add', oldNumber: null, newNumber: newLine++, content })
      result.additions++
    } else if (marker === '-') {
      hunk.lines.push({ type: 'delete', oldNumber: oldLine++, newNumber: null, content })
      result.deletions++
    } else if (marker === ' ' || line === '') {
      hunk.lines.push({ type: 'context', oldNumber: oldLine++, newNumber: newLine++, content })
    }
  }

  return result
}

/**
 * A row in the split (side-by-side) view. Deletions and additions inside the
 * same change block are paired up so edits line up horizontally.
 */
export type SplitRow = {
  left: DiffLine | null
  right: DiffLine | null
}

export function toSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0

  while (i < hunk.lines.length) {
    const line = hunk.lines[i]!

    if (line.type === 'context') {
      rows.push({ left: line, right: line })
      i++
      continue
    }

    // Collect the contiguous block of deletions then additions, and zip them.
    const deletions: DiffLine[] = []
    const additions: DiffLine[] = []
    while (i < hunk.lines.length && hunk.lines[i]!.type === 'delete') deletions.push(hunk.lines[i++]!)
    while (i < hunk.lines.length && hunk.lines[i]!.type === 'add') additions.push(hunk.lines[i++]!)

    const pairs = Math.max(deletions.length, additions.length)
    for (let p = 0; p < pairs; p++) {
      rows.push({ left: deletions[p] ?? null, right: additions[p] ?? null })
    }
  }

  return rows
}

