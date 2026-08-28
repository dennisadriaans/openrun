/**
 * Serve a composer image attachment back to the transcript.
 *
 * Attachments are written into the run workspace (see `server/attachments.ts`)
 * so the agent can read them; the browser needs the bytes too, and only this
 * route is allowed to hand out a file from inside a workspace by path.
 */
import { createFileRoute } from '@tanstack/react-router'
import { readAttachment } from '#/server/attachments.ts'
import { getDb } from '#/server/db'

export const Route = createFileRoute('/api/runs/$runId/attachment')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const path = new URL(request.url).searchParams.get('path')
        if (!path) return new Response('Missing path', { status: 400 })

        const run = getDb().prepare('SELECT cwd FROM runs WHERE id = ?').get(params.runId) as
          | { cwd: string }
          | undefined
        if (!run?.cwd) return new Response('Run not found', { status: 404 })

        try {
          const { bytes, mimeType } = readAttachment(run.cwd, path)
          return new Response(new Uint8Array(bytes), {
            headers: {
              'content-type': mimeType,
              'cache-control': 'private, max-age=31536000, immutable',
            },
          })
        } catch (err) {
          return new Response(err instanceof Error ? err.message : 'Not found', { status: 404 })
        }
      },
    },
  },
})
