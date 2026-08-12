/**
 * Command preview — "what will actually run".
 *
 * A runtime's argsTemplate is only the starting point: before spawning,
 * `buildTurnCommand` injects a session id, model / effort flags, access-mode
 * flags, and the machine-readable output format, and it *drops* template flags
 * it owns (e.g. `--dangerously-skip-permissions` when the mode is supervised).
 * Until you started a run there was no way to see that final argv.
 *
 * These helpers turn a built turn command into a reviewable preview: which
 * tokens came from your template, which Open Run added, how the prompt reaches
 * the CLI, and what is likely to bite you. Pure and dependency-free so the
 * browser can render it and `node:test` can cover it without a spawn.
 */
import { missingRuntimeBinaryMessage, normalizeBin } from './runtimeBinary.ts'

/** Stand-in for the real prompt, so a preview never dumps prompt text in argv. */
export const PREVIEW_PROMPT = '<prompt>'
/** Stand-in for the per-run session id Open Run generates at spawn time. */
export const PREVIEW_SESSION_ID = '<session-id>'
/** Stand-in for the workspace directory when no workspace is selected yet. */
export const PREVIEW_CWD = '<workspace>'
/** Token the executor swaps for a temp file holding the prompt. */
export const PROMPT_FILE_TOKEN = '{promptFile}'

/** Where an argv token came from. */
export type ArgOrigin = 'template' | 'agentops'

export type PreviewArg = { value: string; origin: ArgOrigin }

/** How the prompt reaches the child process. */
export type PromptChannel = 'stdin' | 'promptFile' | 'argv'

export type CommandPreviewWarningCode =
  | 'prompt-not-delivered'
  | 'prompt-in-argv'
  | 'prompt-duplicated'
  | 'template-args-dropped'
  | 'binary-missing'

export type CommandPreviewWarning = {
  code: CommandPreviewWarningCode
  message: string
}

export type CommandPreview = {
  bin: string
  /** Final argv, each token tagged with where it came from. */
  args: PreviewArg[]
  /** Copy-pasteable command line (same quoting as the run's stored command). */
  commandLine: string
  /** Channels the prompt travels on — empty means it never reaches the CLI. */
  channels: PromptChannel[]
  /** Template tokens the runtime adapter replaced or removed. */
  droppedTemplateArgs: string[]
  /** False when this runtime cannot resume, so follow-ups are one-shot. */
  canResume: boolean
  installed: boolean
  /** Resolved binary path when found on PATH. */
  binaryPath: string
  warnings: CommandPreviewWarning[]
}

/**
 * Longest common subsequence of two token lists, returned as index pairs.
 * Used to align the template against the final argv so injected tokens stand
 * out even when they were spliced into the middle.
 */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const rows = a.length
  const cols = b.length
  // table[i][j] = LCS length of a[i..] and b[j..]
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  )
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }

  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

/**
 * Tag every final argv token as coming from the template or from Open Run, and
 * report the template tokens that did not survive.
 */
export function alignArgs(
  templateArgs: string[],
  finalArgs: string[],
): { args: PreviewArg[]; droppedTemplateArgs: string[] } {
  const pairs = lcsPairs(templateArgs, finalArgs)
  const fromTemplate = new Set(pairs.map(([, j]) => j))
  const keptTemplate = new Set(pairs.map(([i]) => i))

  return {
    args: finalArgs.map((value, index) => ({
      value,
      origin: fromTemplate.has(index) ? 'template' : 'agentops',
    })),
    droppedTemplateArgs: templateArgs.filter((_, index) => !keptTemplate.has(index)),
  }
}

/** Shell-ish quoting identical to the command stored on a run row. */
export function formatCommandLine(bin: string, args: string[]): string {
  const rendered = args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')
  return rendered ? `${bin} ${rendered}` : bin
}

/**
 * Which channels carry the prompt. `argv` is detected by looking for the
 * preview stand-in, so it stays correct for templates that embed `{prompt}`
 * inside a larger token (e.g. `-p={prompt}`).
 */
export function promptChannels(input: {
  args: string[]
  stdinText: string | null
  promptFileContents: string | null
  promptToken?: string
}): PromptChannel[] {
  const token = input.promptToken ?? PREVIEW_PROMPT
  const channels: PromptChannel[] = []
  if (input.stdinText !== null) channels.push('stdin')
  if (
    input.promptFileContents !== null ||
    input.args.some((a) => a.includes(PROMPT_FILE_TOKEN))
  ) {
    channels.push('promptFile')
  }
  if (input.args.some((a) => a.includes(token))) channels.push('argv')
  return channels
}

const CHANNEL_LABELS: Record<PromptChannel, string> = {
  stdin: 'stdin',
  promptFile: 'a temp prompt file',
  argv: 'a command-line argument',
}

/** e.g. `Prompt is sent on stdin` / `Prompt is never sent`. */
export function promptDeliveryLabel(channels: PromptChannel[]): string {
  if (channels.length === 0) return 'Prompt is never sent to the CLI'
  return `Prompt is sent on ${channels.map((c) => CHANNEL_LABELS[c]).join(' and ')}`
}

/** Everything worth flagging before someone arms this command on a schedule. */
export function commandPreviewWarnings(input: {
  bin: string
  channels: PromptChannel[]
  droppedTemplateArgs: string[]
  installed: boolean
}): CommandPreviewWarning[] {
  const warnings: CommandPreviewWarning[] = []

  if (!input.installed) {
    warnings.push({ code: 'binary-missing', message: missingRuntimeBinaryMessage(input.bin) })
  }

  if (input.channels.length === 0) {
    warnings.push({
      code: 'prompt-not-delivered',
      message:
        'This command never receives the prompt — the CLI would start with no instructions. Turn on “Pipe prompt to stdin”, or put {prompt} / {promptFile} in the args template.',
    })
  }

  if (input.channels.length > 1) {
    warnings.push({
      code: 'prompt-duplicated',
      message: `The prompt is delivered twice (${input.channels
        .map((c) => CHANNEL_LABELS[c])
        .join(' and ')}). Most CLIs only read one — pick a single channel.`,
    })
  }

  if (input.channels.includes('argv')) {
    warnings.push({
      code: 'prompt-in-argv',
      message:
        'The prompt is passed as a command-line argument — long prompts hit the OS argv limit. Prefer stdin or {promptFile}.',
    })
  }

  if (input.droppedTemplateArgs.length > 0) {
    warnings.push({
      code: 'template-args-dropped',
      message: `Open Run replaced or removed ${input.droppedTemplateArgs
        .map((a) => `\`${a}\``)
        .join(', ')} from your args template — it owns those flags (session, model/effort, access mode, output format).`,
    })
  }

  return warnings
}

/**
 * Assemble the preview from a built turn command. Kept separate from the
 * server module so the alignment and warning rules are unit-testable.
 */
export function buildCommandPreview(input: {
  bin: string
  templateArgs: string[]
  finalArgs: string[]
  stdinText: string | null
  promptFileContents: string | null
  canResume: boolean
  installed: boolean
  binaryPath?: string
  promptToken?: string
}): CommandPreview {
  const bin = normalizeBin(input.bin)
  const { args, droppedTemplateArgs } = alignArgs(input.templateArgs, input.finalArgs)
  const channels = promptChannels({
    args: input.finalArgs,
    stdinText: input.stdinText,
    promptFileContents: input.promptFileContents,
    promptToken: input.promptToken,
  })

  return {
    bin,
    args,
    commandLine: formatCommandLine(bin, input.finalArgs),
    channels,
    droppedTemplateArgs,
    canResume: input.canResume,
    installed: input.installed,
    binaryPath: input.binaryPath ?? '',
    warnings: commandPreviewWarnings({
      bin,
      channels,
      droppedTemplateArgs,
      installed: input.installed,
    }),
  }
}
