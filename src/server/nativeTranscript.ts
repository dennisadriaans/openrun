/**
 * Read one saved CLI chat off disk, in full.
 *
 * The parsing lives in `lib/nativeTranscript.ts` (pure, testable); this module
 * only locates the file. Kinds without a reader return no turns, and the caller
 * falls back to the one-line "resumed" note.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { NativeSessionKind } from '../lib/nativeSessions.ts'
import {
  parseClaudeTranscript,
  supportsTranscriptImport,
  type TranscriptTurn,
} from '../lib/nativeTranscript.ts'
import { claudeSessionFile } from './nativeSessions.ts'

export function readNativeTranscript(
  cwd: string,
  kind: NativeSessionKind,
  sessionId: string,
): TranscriptTurn[] {
  const id = sessionId.trim()
  if (!id || !cwd.trim() || !supportsTranscriptImport(kind)) return []
  const file = claudeSessionFile(cwd, id)
  if (!file || !existsSync(file)) return []
  try {
    return parseClaudeTranscript(readFileSync(file, 'utf8'))
  } catch {
    // An unreadable or half-written transcript is not worth failing a run over.
    return []
  }
}
