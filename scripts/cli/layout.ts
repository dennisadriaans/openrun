import { stripVTControlCharacters } from 'node:util'
import type { HomeOverview, OverviewRow } from './session.ts'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
function cells(value: string): number {
  if (/\p{Extended_Pictographic}/u.test(value)) return 2
  const code = value.codePointAt(0) ?? 0
  if (code < 32 || /^(?:\p{Mark}|\p{Format})+$/u.test(value)) return 0
  return code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      code >= 0x20000)
    ? 2
    : 1
}

export function cellWidth(text: string): number {
  return [...segmenter.segment(stripVTControlCharacters(text))].reduce(
    (n, part) => n + cells(part.segment),
    0,
  )
}

/** A footer is exactly one terminal row, including with wide Unicode text. */
export function fitLine(text: string, width: number, pad = false): string {
  const clean = stripVTControlCharacters(text).replace(/[\r\n\t]/g, ' ')
  const limit = Math.max(0, Math.floor(width))
  if (!limit) return ''
  if (cellWidth(clean) <= limit) return pad ? clean + ' '.repeat(limit - cellWidth(clean)) : clean
  let result = ''
  let used = 0
  for (const { segment } of segmenter.segment(clean)) {
    const size = cells(segment)
    if (used + size > limit - 1) break
    result += segment
    used += size
  }
  return `${result}…${pad ? ' '.repeat(limit - used - 1) : ''}`
}

export function overviewTable(view: HomeOverview, width: number): string {
  const metrics = [
    ['Scheduled', view.scheduled],
    ['Runs today', view.runs],
    ['Active runs', view.running],
    ['Integrations', view.integrations],
  ] as const
  if (width < 52) {
    const half = Math.max(1, Math.floor((width - 2) / 2))
    return [0, 2]
      .map((index) =>
        metrics
          .slice(index, index + 2)
          .map(([label, count]) => fitLine(`${label} ${count ?? '—'}`, half, true))
          .join('  '),
      )
      .join('\n')
  }
  const column = Math.floor((width - 9) / 4)
  return [
    metrics.map(([label]) => fitLine(label, column, true)).join(' │ '),
    metrics.map(([, value]) => fitLine(String(value ?? '—'), column, true)).join(' │ '),
  ].join('\n')
}

export function activityTable(rows: OverviewRow[], width: number): string {
  if (width < 45)
    return rows
      .flatMap((row) => [fitLine(row.prompt, width), fitLine(`  ${row.when}`, width)])
      .join('\n')
  const stateWidth = Math.min(32, Math.floor(width * 0.4))
  return rows
    .map(
      (row) =>
        `${fitLine(row.when, stateWidth, true)}  ${fitLine(row.prompt, width - stateWidth - 2)}`,
    )
    .join('\n')
}
