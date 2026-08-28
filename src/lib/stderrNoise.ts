/**
 * Separate a CLI's chatter on stderr from an actual failure.
 *
 * Coding CLIs log recoverable events at ERROR level: an MCP server the user
 * never signed into, a websocket the CLI reconnects on its own. A turn that
 * finished fine still carries those lines, and the chat surfaces any stderr as
 * a red log — so a successful answer looks broken.
 *
 * Filtering is by known line, never by severity: an unrecognized error stays
 * visible. The raw run log (`runs.$runId`) is unfiltered by design.
 */

const BENIGN_PATTERNS: RegExp[] = [
  // An MCP server that needs an OAuth sign-in the user has not done. The CLI
  // drops that one server and runs with the rest.
  /rmcp::transport::worker: worker quit with fatal:/,
  // Codex's streaming socket dropping; it redials and the turn completes.
  /codex_api::endpoint::responses_websocket: failed to connect to websocket/,
]

export function isBenignStderrLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  return BENIGN_PATTERNS.some((re) => re.test(t))
}

/**
 * The stderr worth showing: the input minus known-benign lines, or `''` when
 * nothing else remains. Blank lines never keep a block alive on their own.
 */
export function meaningfulStderr(stderr: string | null | undefined): string {
  if (!stderr) return ''
  const kept = stderr.split('\n').filter((line) => !isBenignStderrLine(line))
  return kept.join('\n').trim() ? kept.join('\n') : ''
}
