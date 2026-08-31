/**
 * Write an adopted CLI chat into a run's transcript.
 *
 * The rows are the ordinary ones — a `messages` pair per turn plus its
 * `turn_events` — so chat renders an imported conversation exactly like one Open
 * Run executed itself, and a later follow-up simply appends to it.
 *
 * Nothing here spawns anything: importing is a read of the CLI's own session
 * file, independent of whether that session can still be resumed.
 */
import { getDb } from './db.ts'
import { readNativeTranscript } from './nativeTranscript.ts'
import { resumedNativeChatStub, type NativeSessionKind } from '../lib/nativeSessions.ts'
import { omittedTurnsNote, trimTranscript } from '../lib/nativeTranscript.ts'

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export type NativeImportResult = {
  /** Turns actually written; 0 means only the "resumed" note landed. */
  turns: number
  /** Timestamp of the oldest imported message, for the run's startedAt. */
  startedAt: number
}

export type ImportTimestampInput = { sourceAt?: number | null }

function validSourceTimestamp(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.trunc(value)
}

/**
 * Allocate unique message/event timestamps before the adoption boundary.
 *
 * Valid source timestamps retain their relative order and their millisecond
 * values whenever there is room. Missing, duplicate, decreasing, or invalid
 * values are clamped to the next available millisecond. If a source timestamp
 * lies in the future, the complete sequence is shifted backwards as one unit;
 * this preserves its spacing while keeping every imported row before `before`.
 */
export function allocateImportTimestamps(
  rows: readonly ImportTimestampInput[],
  before: number,
): number[] {
  if (!Number.isFinite(before)) throw new Error('Native transcript import needs a finite boundary.')
  if (rows.length === 0) return []

  const boundary = Math.trunc(before)
  const limit = boundary - 1
  const firstSourceIndex = rows.findIndex((row) => validSourceTimestamp(row.sourceAt) !== undefined)
  const firstSource =
    firstSourceIndex >= 0 ? validSourceTimestamp(rows[firstSourceIndex]?.sourceAt) : undefined
  let clock = firstSource === undefined ? limit - rows.length : firstSource - firstSourceIndex - 1

  const raw: number[] = []
  for (const row of rows) {
    const source = validSourceTimestamp(row.sourceAt)
    const wanted = source ?? clock + 1
    clock = Math.max(clock + 1, wanted)
    raw.push(clock)
  }

  const shift = Math.min(0, limit - clock)
  const allocated = raw.map((value) => value + shift)
  for (let i = 0; i < allocated.length; i += 1) {
    const value = allocated[i]!
    if (!Number.isSafeInteger(value) || value >= boundary) {
      throw new Error('Native transcript import produced an invalid timestamp sequence.')
    }
    if (i > 0 && value <= allocated[i - 1]!) {
      throw new Error('Native transcript import produced an ambiguous timestamp sequence.')
    }
  }
  return allocated
}

/**
 * Import `sessionId`'s transcript into `runId`, newest turns first if it does
 * not all fit. Always writes the provenance note, so a runtime with no reader
 * (or a transcript we could not parse) behaves as it did before.
 *
 * `before` is the timestamp the caller's own next row will use — everything
 * written here sorts strictly ahead of it.
 */
export function importNativeTranscript(input: {
  runId: string
  cwd: string
  kind: NativeSessionKind
  sessionId: string
  label: string
  before: number
}): NativeImportResult {
  const { turns, dropped, droppedEvents } = trimTranscript(
    readNativeTranscript(input.cwd, input.kind, input.sessionId),
  )

  const db = getDb()
  const insertMessage = db.prepare(
    `INSERT INTO messages (id, runId, role, content, stdout, stderr, status, exitCode, diffSummary, usage, sourceProvider, sourceUrl, sourceLabel, createdAt, finishedAt)
     VALUES (@id, @runId, @role, @content, '', '', @status, NULL, '', @usage, '', '', '', @createdAt, @finishedAt)`,
  )
  const insertEvent = db.prepare(
    `INSERT INTO turn_events (id, messageId, runId, seq, kind, payload, createdAt)
     VALUES (@id, @messageId, @runId, @seq, @kind, @payload, @createdAt)`,
  )

  const timestampRows: ImportTimestampInput[] = []
  timestampRows.push({})
  if (dropped > 0 || droppedEvents > 0) timestampRows.push({})
  for (const turn of turns) {
    if (turn.prompt) timestampRows.push({ sourceAt: turn.promptAt })
    if (turn.events.length > 0) {
      timestampRows.push({ sourceAt: turn.endedAt })
      for (const _event of turn.events) timestampRows.push({ sourceAt: turn.endedAt })
    }
  }
  const timestamps = allocateImportTimestamps(timestampRows, input.before)
  let timestampIndex = 0
  const seenTimestamps = new Set<number>()
  const at = (): number => {
    const createdAt = timestamps[timestampIndex++]
    if (createdAt === undefined || seenTimestamps.has(createdAt)) {
      throw new Error('Native transcript import produced an ambiguous timestamp sequence.')
    }
    seenTimestamps.add(createdAt)
    return createdAt
  }

  const note = (text: string) => {
    const createdAt = at()
    insertMessage.run({
      id: newId('msg'),
      runId: input.runId,
      role: 'system',
      content: text,
      status: 'success',
      usage: '',
      createdAt,
      finishedAt: createdAt,
    })
  }

  const write = db.transaction(() => {
    note(resumedNativeChatStub(input.kind, input.label))
    if (dropped > 0 || droppedEvents > 0) note(omittedTurnsNote(dropped, droppedEvents))

    for (const turn of turns) {
      if (turn.prompt) {
        const createdAt = at()
        insertMessage.run({
          id: newId('msg'),
          runId: input.runId,
          role: 'user',
          content: turn.prompt,
          status: 'success',
          usage: '',
          createdAt,
          finishedAt: createdAt,
        })
      }
      if (turn.events.length === 0) continue

      const messageId = newId('msg')
      const createdAt = at()
      insertMessage.run({
        id: messageId,
        runId: input.runId,
        role: 'assistant',
        // Chat reads assistant text back out of the events, as it does live.
        content: '',
        status: 'success',
        usage: turn.usage ? JSON.stringify(turn.usage) : '',
        createdAt,
        finishedAt: createdAt,
      })
      turn.events.forEach((event, seq) => {
        const eventCreatedAt = at()
        insertEvent.run({
          id: newId('ev'),
          messageId,
          runId: input.runId,
          seq,
          kind: event.kind,
          payload: JSON.stringify(event.payload),
          createdAt: eventCreatedAt,
        })
      })
    }
  })
  write()

  return { turns: turns.length, startedAt: timestamps[0] ?? input.before - 1 }
}
