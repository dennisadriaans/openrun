/** chat queries and cache updates. */
import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'
import {
  applyRunLiveEvent,
  applyRunLiveEventToRunRow,
  type ConversationCacheSlice,
} from '@openrun/domain/live/applyRunLiveEvent'
import { newMessageId } from '@openrun/domain/runs/messageId'

export function useSendMessage(runId: string) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: {
      prompt: string
      runtimeId?: string
      model?: string
      effort?: string
      runtimeMode?: string
      userMessageId: string
      assistantMessageId: string
      /** The agent is working: this message joins the run's queue. */
      queue?: boolean
      /** Interrupt the working agent so the queue starts now. */
      force?: boolean
    }) => fns.postMessage({ data: { runId, ...input } }),
    onMutate: async (vars) => {
      const convKey = ['conversation', runId] as const
      const runKey = ['run', runId] as const
      await qc.cancelQueries({ queryKey: convKey })
      const previous = qc.getQueryData<ConversationCacheSlice>(convKey)
      // A queued message is not a turn — it shows in the queue strip until the
      // server's `queue_changed` frame replaces this optimistic entry.
      if (vars.queue) {
        if (previous) {
          qc.setQueryData<ConversationCacheSlice>(convKey, {
            ...previous,
            queued: [
              ...(previous.queued ?? []),
              {
                id: vars.userMessageId,
                runId,
                prompt: vars.prompt.trim(),
                model: vars.model ?? '',
                effort: vars.effort ?? '',
                runtimeMode: vars.runtimeMode ?? '',
                runtimeId: vars.runtimeId ?? '',
                queuedAt: Date.now(),
              },
            ],
          })
        }
        return { previous }
      }
      const turnStarted = {
        type: 'turn_started' as const,
        userMessageId: vars.userMessageId,
        assistantMessageId: vars.assistantMessageId,
        prompt: vars.prompt.trim(),
        createdAt: Date.now(),
      }
      const base: ConversationCacheSlice = previous ?? {
        run: { id: runId, status: 'idle', stdout: '', stderr: '', exitCode: null },
        messages: [],
        canFollowUp: true,
      }
      const result = applyRunLiveEvent(base, turnStarted)
      if (result.action === 'patch') qc.setQueryData(convKey, result.data)
      const runCached = qc.getQueryData<{
        id: string
        status: string
        stdout: string
        stderr: string
        exitCode: number | null
      }>(runKey)
      if (runCached) {
        const runResult = applyRunLiveEventToRunRow(runCached, turnStarted)
        if (runResult.action === 'patch') qc.setQueryData(runKey, runResult.data)
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(['conversation', runId], context.previous)
      } else {
        qc.removeQueries({ queryKey: ['conversation', runId] })
      }
    },
    onSuccess: (data, vars, context) => {
      // The server parked a message the client thought it was sending (a
      // stale idea of the run's status) — the optimistic turn never happened.
      if (data?.queued && !vars.queue) {
        void qc.refetchQueries({ queryKey: ['conversation', runId] })
        return
      }
      if (!context?.previous) {
        void qc.refetchQueries({ queryKey: ['conversation', runId] })
      }
    },
  })

  type FollowUpInput = {
    prompt: string
    /** Set only when this turn hands the chat to a different runtime. */
    runtimeId?: string
    model?: string
    effort?: string
    runtimeMode?: string
    /** The run is busy — park this message instead of starting a turn. */
    queue?: boolean
    /** Interrupt the running turn so the queue is delivered now. */
    force?: boolean
  }

  const mutate = useCallback(
    (input: FollowUpInput, opts?: Parameters<typeof mutation.mutate>[1]) =>
      mutation.mutate(sendFollowUpVars(input), opts),
    [mutation.mutate],
  )
  const mutateAsync = useCallback(
    (input: FollowUpInput, opts?: Parameters<typeof mutation.mutateAsync>[1]) =>
      mutation.mutateAsync(sendFollowUpVars(input), opts),
    [mutation.mutateAsync],
  )

  return { ...mutation, mutate, mutateAsync }
}

function sendFollowUpVars(input: {
  prompt: string
  runtimeId?: string
  model?: string
  effort?: string
  runtimeMode?: string
  queue?: boolean
  force?: boolean
}) {
  return {
    ...input,
    userMessageId: newMessageId(),
    assistantMessageId: newMessageId(),
  }
}

/**
 * Manual handles on the follow-up queue. The `queue_changed` frame is what
 * normally updates the strip; the invalidation covers a dropped stream.
 */
export function useQueuedMessageActions(runId: string) {
  const qc = useQueryClient()
  const settle = () => {
    void qc.invalidateQueries({ queryKey: ['conversation', runId] })
  }
  const drop = useMutation({
    mutationFn: (input: { id: string }) => fns.dequeueMessage({ data: input }),
    onSuccess: settle,
  })
  const clear = useMutation({
    mutationFn: () => fns.clearQueuedMessages({ data: { runId } }),
    onSuccess: settle,
  })
  const flush = useMutation({
    mutationFn: () => fns.flushQueuedMessages({ data: { runId } }),
    onSuccess: settle,
  })
  return { drop, clear, flush }
}

/**
 * Re-run the project's checks against a finished run. Results stream in over
 * the run's live channel; the invalidation is the safety net for a dropped one.
 */
export function useRerunChecks(runId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => fns.rerunRunChecks({ data: { runId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversation', runId] })
      void qc.invalidateQueries({ queryKey: ['run', runId] })
    },
  })
}

/** Allow or deny a pending supervised tool approval on a live run. */
export function useAnswerApproval(runId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      requestId: string
      /** ACP option id from the prompt's own button list. */
      optionId?: string
      decision?: 'allow' | 'deny'
      message?: string
    }) => fns.answerApproval({ data: { runId, ...input } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversation', runId] })
      void qc.invalidateQueries({ queryKey: ['run', runId] })
    },
  })
}
