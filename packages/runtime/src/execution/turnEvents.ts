/**
 * Server-side entry point for turn-event parsing.
 *
 * The parsing itself lives in `lib/agentEvents/` — one adapter per CLI, all of
 * them pure and browser-safe so `node:test` can exercise the real parse path
 * without spawning anything. This module is the seam the executor imports, kept
 * so `server/` code never reaches into an adapter directly and picks up a
 * runtime-specific import by accident.
 */
import type { TurnEventKind, TurnEventPayload, TurnEventRow } from '@openrun/domain/chat/turnEvents'
import { isPlainCliOutput } from '@openrun/domain/runtimes/cliOutputFormat'

export type { TurnEventKind, TurnEventPayload, TurnEventRow }
export { isPlainCliOutput }

export {
  AssistantDeltaCoalescer,
  LineBuffer,
  assistantTextFromEvents,
  ensureMachineReadableArgs,
  hasEventAdapter,
  parseAcpSessionUpdate,
  parseTurnEventLine,
  ClaudeStdoutIngest,
} from '@openrun/domain/chat/agentEvents/index'

export type { EventRuntimeKind, ParsedTurnEvent } from '@openrun/domain/chat/agentEvents/index'
