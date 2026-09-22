/** runs queries and cache updates. */

/** Conversation stays fresh via SSE; avoid window-focus refetches that hitch chat. */
export const CONVERSATION_STALE_MS = 60_000

/** Intent preload of `/runs/$runId` is considered fresh for this long. */
export const RUN_PRELOAD_STALE_MS = 15_000

const WORKSPACE_IDLE_PREFETCH_MS = 400

export { WORKSPACE_IDLE_PREFETCH_MS }
