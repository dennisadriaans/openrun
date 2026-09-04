/**
 * Known-good headless runtime presets for the Runtimes page gallery.
 *
 * Prefer stdin or `{promptFile}` over embedding `{prompt}` in argv (ARG_MAX /
 * process-list leaks). First-class kinds (claude/codex/grok/agy/fx) get adapters in
 * resume.ts; everything else stays generic (single-shot, raw stdout).
 */
export type RuntimePreset = {
  id: string
  label: string
  bin: string
  argsTemplate: string[]
  promptViaStdin: boolean
  description: string
  canOpenPrs?: boolean
  /** Defaults to the CLI transport; 'acp' launches the agent over ACP. */
  transport?: 'cli' | 'acp'
}

export const RUNTIME_PRESETS: RuntimePreset[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    argsTemplate: [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ],
    promptViaStdin: true,
    description:
      'Anthropic Claude Code CLI in non-interactive print mode. Uses your local `claude` login.',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    bin: 'codex',
    argsTemplate: ['exec', '--json', '--skip-git-repo-check', '-'],
    promptViaStdin: true,
    description: 'OpenAI Codex CLI via `codex exec`. Runs headless against your local Codex login.',
  },
  {
    id: 'grok',
    label: 'Grok CLI',
    bin: 'grok',
    argsTemplate: ['--prompt-file', '{promptFile}', '--output-format', 'streaming-json'],
    promptViaStdin: false,
    description: 'xAI Grok build CLI (headless). Prompt via temp file; resume + models supported.',
  },
  {
    id: 'antigravity',
    label: 'Antigravity CLI',
    bin: 'agy',
    // agy's `-p` takes the prompt as its argument (not stdin); flags must come first.
    argsTemplate: [
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions',
      '-p',
      '{prompt}',
    ],
    promptViaStdin: false,
    description:
      'Google Antigravity CLI (`agy`) headless. Claude-Code-shaped flags and stream-json, so tool calls and follow-up turns work; models come from `agy models`.',
  },
  {
    id: 'fx',
    label: 'fx',
    bin: 'fx',
    argsTemplate: ['acp'],
    promptViaStdin: false,
    transport: 'acp',
    description:
      'Tiny native coding agent from fx.sh, over ACP. Uses your local `fx` login (Vercel or AI Gateway). Follow-up turns, tool statuses, and Supervised approvals come from the protocol; models from `fx models`.',
  },
]

/**
 * Stable display order for runtimes. Builtins follow the preset order above so
 * a DB that acquired them piecemeal (older rows seeded before
 * ensureBuiltinRuntimeSeeds backfilled the rest) ranks them the same as a
 * freshly seeded one; user-added runtimes sort after, by createdAt.
 */
export function runtimeSortRank(id: string): number {
  const i = RUNTIME_PRESETS.findIndex((p) => p.id === id)
  return i === -1 ? RUNTIME_PRESETS.length : i
}

export function compareRuntimesForDisplay<T extends { id: string; createdAt: number }>(
  a: T,
  b: T,
): number {
  return runtimeSortRank(a.id) - runtimeSortRank(b.id) || a.createdAt - b.createdAt
}
