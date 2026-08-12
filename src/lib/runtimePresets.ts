/**
 * Known-good headless runtime presets for the Runtimes page gallery.
 *
 * Prefer stdin or `{promptFile}` over embedding `{prompt}` in argv (ARG_MAX /
 * process-list leaks). First-class kinds (claude/codex/grok) get adapters in
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
    description:
      'xAI Grok build CLI (headless). Prompt via temp file; resume + models supported.',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    bin: 'gemini',
    // `-p` enables headless; YOLO auto-approves tools. Prefer short prompts —
    // this CLI has no prompt-file flag, so large `{prompt}` values hit ARG_MAX.
    argsTemplate: ['-p', '{prompt}', '-y', '-o', 'text'],
    promptViaStdin: false,
    description:
      'Google Gemini CLI headless (`-p` + YOLO). Single-shot — no resume over this transport. Keep prompts short: no prompt-file support.',
  },
  {
    id: 'gemini-acp',
    label: 'Gemini CLI (ACP)',
    bin: 'gemini',
    argsTemplate: ['--experimental-acp'],
    promptViaStdin: false,
    transport: 'acp',
    description:
      'Gemini CLI over the Agent Client Protocol: real tool statuses, plans, file locations, follow-up turns and Supervised approvals.',
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
