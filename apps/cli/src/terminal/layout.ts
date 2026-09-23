import { stripVTControlCharacters } from 'node:util'
import type { ActivityItem, HomeOverview, RunChanges } from '../session/session.ts'

/** "2 files +12 −3", or "No file changes" — the same words in Activity and Review. */
export function changeSummary(changes: RunChanges): string {
  if (!changes.files) return 'No file changes'
  return `${changes.files} file${changes.files === 1 ? '' : 's'} +${changes.additions} −${changes.deletions}`
}

/** One inline summary per activity item; the renderer wraps it to fit. */
export function activityLine(item: ActivityItem): string {
  return [
    item.status,
    `${item.time || '—'}${item.nextTime ? ` (next ${item.nextTime})` : ''}`,
    item.model === undefined ? '—' : item.model || 'Default model',
    item.effort === undefined ? '—' : `${item.effort || 'default'} effort`,
    item.prompt,
    ...(item.changes ? [changeSummary(item.changes)] : []),
  ]
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .join(' · ')
}

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
  const lines: string[] = []
  let line = ''
  for (const [label, count] of metrics) {
    const metric = fitLine(`${label}: ${count ?? '—'}`, width)
    if (line && cellWidth(`${line}   ${metric}`) > width) {
      lines.push(line)
      line = ''
    }
    line = line ? `${line}   ${metric}` : metric
  }
  if (line) lines.push(line)
  return lines.join('\n')
}
