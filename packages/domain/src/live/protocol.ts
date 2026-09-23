/** Server heartbeat period. Both SSE factories import this; do not duplicate. */
export const SERVER_PING_MS = 15_000
/** Silence past this means the socket is dead even if the browser disagrees. */
export const STALE_AFTER_MS = SERVER_PING_MS * 3 - 5_000
