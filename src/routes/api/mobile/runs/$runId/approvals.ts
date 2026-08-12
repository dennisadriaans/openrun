/**
 * Answer a supervised tool-approval prompt.
 *
 * The reason this whole surface exists: without it the executor auto-denies
 * after five minutes. `answered: false` means the prompt was already resolved
 * or timed out — a 200, not an error.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleAnswerApproval, readJson } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/runs/$runId/approvals')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const auth = requireDeviceOp(request, 'approvals.answer')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = await handleAnswerApproval({
          runId: params.runId,
          body: await readJson(request),
        })
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
