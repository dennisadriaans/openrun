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
import { getDb } from './db'
import { readNativeTranscript } from './nativeTranscript'
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
  const { turns, dropped } = trimTranscript(
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

  const first = turns[0]?.promptAt ?? 0
  const limit = input.before - 1
  // Source timestamps, kept strictly increasing so `ORDER BY createdAt` cannot
  // interleave a turn, and capped so the caller's next row still comes last.
  let clock = (first > 0 ? first : input.before) - 2
  const at = (ms: number): number => {
    const wanted = Number.isFinite(ms) && ms > 0 ? ms : 0
    clock = Math.min(Math.max(clock + 1, wanted), limit)
    return clock
  }

  const note = (text: string) => {
    const createdAt = at(0)
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
    if (dropped > 0) note(omittedTurnsNote(dropped))

    for (const turn of turns) {
      if (turn.prompt) {
        const createdAt = at(turn.promptAt)
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
      const createdAt = at(turn.endedAt)
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
        insertEvent.run({
          id: newId('ev'),
          messageId,
          runId: input.runId,
          seq,
          kind: event.kind,
          payload: JSON.stringify(event.payload),
          createdAt,
        })
      })
    }
  })
  write()

  return { turns: turns.length, startedAt: first > 0 ? first : input.before }
}
