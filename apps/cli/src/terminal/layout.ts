import { stripVTControlCharacters } from 'node:util'
import type { ActivityItem, HomeOverview, RunChanges, StatusCard } from '../session/session.ts'
import { relativeTime } from './schedule.ts'

/** "2 files +12 −3", or "No file changes" — the same words in Activity and Review. */
export function changeSummary(changes: RunChanges): string {
  if (!changes.files) return 'No file changes'
  return `${changes.files} file${changes.files === 1 ? '' : 's'} +${changes.additions} −${changes.deletions}`
}

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim()

export type ActivityColumns = { status: number; time: number }
export type ActivityCells = { status: string; time: string; prompt: string; changes: string }

/** Shared column widths, so a list of one-line rows reads as a table. */
export function activityColumns(items: ActivityItem[]): ActivityColumns {
  const widest = (values: string[], cap: number) =>
    Math.min(cap, Math.max(0, ...values.map((value) => cellWidth(clean(value)))))
  return {
    status: widest(
      items.map((item) => item.status),
      12,
    ),
    time: widest(
      items.map((item) => item.time || '—'),
      14,
    ),
  }
}

/**
 * One terminal row. The prompt gives up space first; on a narrow panel the
 * changes and then the time go, so the prompt never shrinks to nothing.
 */
export function activityCells(
  item: ActivityItem,
  columns: ActivityColumns,
  width: number,
): ActivityCells {
  const room = 8
  let changes = item.changes ? changeSummary(item.changes) : ''
  let time = fitLine(clean(item.time || '—'), columns.time, true)
  const status = fitLine(clean(item.status), columns.status, true)
  const used = () =>
    cellWidth(status) +
    (time ? cellWidth(time) + 2 : 0) +
    2 +
    (changes ? cellWidth(changes) + 2 : 0)
  if (width - used() < room) changes = ''
  if (width - used() < room) time = ''
  return { status, time, prompt: fitLine(clean(item.prompt), width - used()), changes }
}

/** Neither side of the chat | Activity split shrinks below this many columns. */
export const minPaneWidth = 24
/** How far Ctrl+Shift+←/→ moves the divider. */
export const splitStep = 0.05

export type SplitColumns = { chat: number; activity: number }

/**
 * Chat and Activity widths for a row `width` columns wide, with one column
 * between them for the divider. `ratio` is chat's share; the minimum width
 * wins over it, and a row too narrow for two minimums splits evenly.
 */
export function splitColumns(ratio: number, width: number): SplitColumns {
  const room = Math.max(0, Math.floor(width) - 1)
  const share = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0.5
  const low = Math.min(minPaneWidth, Math.floor(room / 2))
  const chat = Math.min(room - low, Math.max(low, Math.round(room * share)))
  return { chat, activity: room - chat }
}

/**
 * The ratio a divider dragged to column `x` asks for. `left` is where the row
 * starts; the result is clamped the same way `splitColumns` would lay it out.
 */
export function splitAt(x: number, left: number, width: number): number {
  return settledSplit((x - left) / splitRoom(width), width)
}

/** One Ctrl+Shift+←/→ step from where the divider is drawn now, not from a clamped ratio. */
export function stepSplit(ratio: number, width: number, direction: -1 | 1): number {
  return settledSplit(settledSplit(ratio, width) + direction * splitStep, width)
}

const splitRoom = (width: number): number => Math.max(1, Math.floor(width) - 1)
const settledSplit = (ratio: number, width: number): number =>
  splitColumns(ratio, width).chat / splitRoom(width)

/** A glyph that reads without color: done, failed, working, waiting. */
export function statusIcon(status: string): string {
  if (/\b(?:failed|error|blocked)\b/i.test(status)) return '✗'
  if (/\b(?:cancelled|canceled)\b/i.test(status)) return '–'
  if (/\b(?:queued|pending|paused)\b/i.test(status)) return '○'
  if (/\b(?:running|preparing|starting)\b/i.test(status)) return '●'
  return '✓'
}

/** "in 10 seconds · claude-sonnet-5 · low effort": the quiet line under a chat card. */
export function cardDetail(card: StatusCard, status = card.status, now = Date.now()): string {
  const waiting = /^scheduled$/i.test(status)
  return [
    ...(waiting && card.at ? [relativeTime(card.at, now)] : []),
    ...(card.repeats ? [card.repeats] : []),
    card.model || 'default model',
    ...(card.effort ? [`${card.effort} effort`] : []),
  ].join(' · ')
}

/** The transcript form of a card, and what a one-shot command prints. */
export function cardText(card: StatusCard): string {
  return `${card.status} ${card.title}${card.time ? ` · ${card.time}` : ''}\n${cardDetail(card)}`
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
