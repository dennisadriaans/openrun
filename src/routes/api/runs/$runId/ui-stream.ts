/**
 * A run's transcript in the AI SDK UI Message Stream format.
 *
 * Read-only and finite: it replays what the run has produced so far and closes.
 * The app's own live tail is `/api/runs/$runId/stream` — this endpoint exists so
 * anything that already speaks the UI Message Stream protocol (`useChat`, other
 * tooling) can read an Open Run run without knowing our event vocabulary.
 *
 * See `lib/uiMessageStream.ts` for the mapping and why it is a projection
 * rather than a second source of truth.
 */
import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '#/server/db'
import { listMessages, listTurnEventsForMessage } from '#/server/executor'
import {
  UI_MESSAGE_STREAM_HEADERS,
  encodeUiSseFrame,
  runToUiChunks,
} from '#/lib/uiMessageStream.ts'

export const Route = createFileRoute('/api/runs/$runId/ui-stream')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const runId = params.runId
        const run = getDb().prepare('SELECT id FROM runs WHERE id = ?').get(runId) as
          | { id: string }
          | undefined
        if (!run) return new Response('Run not found', { status: 404 })

        const messages = listMessages(runId).map((m) => ({
          id: m.id,
          role: m.role as string,
          events: listTurnEventsForMessage(m.id),
        }))

        const body =
          runToUiChunks(messages).map(encodeUiSseFrame).join('') + encodeUiSseFrame('[DONE]')

        return new Response(body, { headers: UI_MESSAGE_STREAM_HEADERS })
      },
    },
  },
})
