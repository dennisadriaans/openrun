/**
 * How Open Run talks to a runtime: parse its own stdout, or speak ACP to it.
 *
 * `cli` (the default, and what every existing runtime row means) spawns the
 * binary with the user's args template and parses whatever JSONL it prints.
 * `acp` spawns the agent in Agent Client Protocol mode and drives it over
 * JSON-RPC instead — no parsing, and tool approvals, plans and tool kinds come
 * from the protocol rather than from inference.
 *
 * The trade AGENTS.md cares about: `cli` keeps the args template authoritative,
 * `acp` does not (the protocol owns the invocation). That is why this is a
 * per-runtime choice and not a global switch.
 *
 * Browser-safe: the Runtimes form uses these helpers to explain the choice and
 * the server uses the same ones to decide which executor path to take.
 */

export type RuntimeTransport = 'cli' | 'acp'

export const DEFAULT_TRANSPORT: RuntimeTransport = 'cli'

export function parseTransport(value: string | null | undefined): RuntimeTransport {
  return value === 'acp' ? 'acp' : DEFAULT_TRANSPORT
}

export function isAcpTransport(value: string | null | undefined): boolean {
  return parseTransport(value) === 'acp'
}

export const TRANSPORT_LABELS: Record<RuntimeTransport, string> = {
  cli: 'CLI (parse stdout)',
  acp: 'Agent Client Protocol',
}

export const TRANSPORT_DESCRIPTIONS: Record<RuntimeTransport, string> = {
  cli: 'Run the command below and parse its JSON output. Your args template is used as written.',
  acp: 'Speak Agent Client Protocol over stdio. Tool approvals, plans and file locations come from the agent; the args template only launches it.',
}

/**
 * Known ways to start each CLI in ACP mode.
 *
 * Some agents speak ACP natively behind a flag; others need a published
 * adapter process. These are suggestions the Runtimes form offers when the user
 * switches a runtime to ACP — the row stays user-editable, because which
 * adapter is installed is a property of the user's machine, not of this app.
 */
export type AcpLaunchPreset = {
  /** Runtime kind this applies to. */
  kind: string
  bin: string
  args: string[]
  /** Shown under the picker so the user knows what needs to be installed. */
  note: string
}

export const ACP_LAUNCH_PRESETS: AcpLaunchPreset[] = [
  {
    kind: 'gemini',
    bin: 'gemini',
    args: ['--experimental-acp'],
    note: 'Gemini CLI speaks ACP natively — no extra install.',
  },
  {
    kind: 'claude',
    bin: 'npx',
    args: ['-y', '@zed-industries/claude-code-acp'],
    note: 'Runs the Claude Code ACP adapter, which uses your existing `claude` login.',
  },
  {
    kind: 'codex',
    bin: 'codex-acp',
    args: [],
    note: 'Needs the separate `codex-acp` server on your PATH.',
  },
]

export function acpLaunchPresetFor(kind: string): AcpLaunchPreset | undefined {
  return ACP_LAUNCH_PRESETS.find((p) => p.kind === kind)
}

/**
 * Why a runtime cannot use the ACP transport, or null when it can.
 *
 * Kept next to the presets so the Runtimes form and the server agree — the
 * server refuses the same combinations the form disables (AGENTS.md gate rule).
 */
export function acpTransportRefusal(input: {
  transport: string | null | undefined
  bin: string
}): string | null {
  if (!isAcpTransport(input.transport)) return null
  if (!input.bin.trim()) return 'Set the command that starts the agent in ACP mode.'
  return null
}
