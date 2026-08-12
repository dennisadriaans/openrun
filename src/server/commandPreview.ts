/**
 * Build the command a runtime *would* spawn, without spawning it.
 *
 * Uses the same `buildTurnCommand` the executor calls, so the preview cannot
 * drift from what actually runs — only the prompt, session id and (when no
 * workspace is picked) the cwd are swapped for readable stand-ins.
 *
 * Server-only: it reaches for PATH resolution and workspace paths. The shaping
 * and warning rules live in ../lib/commandPreview.ts.
 */
import { applyPromptEffort } from '../lib/models'
import { parseArgsTemplate } from '../lib/argsTemplate'
import {
  PREVIEW_CWD,
  PREVIEW_PROMPT,
  PREVIEW_SESSION_ID,
  buildCommandPreview,
  type CommandPreview,
} from '../lib/commandPreview'
import { emptyRuntimeBinaryMessage, normalizeBin } from '../lib/runtimeBinary'
import { DEFAULT_RUNTIME_MODE } from '../lib/runtimeMode'
import { buildTurnCommand, runtimeKind } from './resume'
import { checkRuntimeInstalled } from './runtimePath'
import { resolveWorkspacePath } from './workspaces'
import type { RuntimeRow } from './db'

export type PreviewCommandInput = {
  /** Runtime binary — draft value while editing, so it may be empty/unknown. */
  bin: string
  /** Draft args template (JSON array); invalid values return an error, not a throw. */
  argsTemplate: string
  promptViaStdin: boolean
  /** Resolve the real spawn directory for `{cwd}` when a workspace is picked. */
  workspaceId?: string
  model?: string
  effort?: string
  runtimeMode?: string
  /** Preview the resume invocation instead of the first turn. */
  isFollowUp?: boolean
}

export type PreviewCommandResult = {
  preview: CommandPreview | null
  /** Set when the draft cannot produce a command at all (bad template / no binary). */
  error: string | null
}

/** Substitute the same tokens `buildTurnCommand` expands, for alignment. */
function expandToken(token: string, prompt: string, cwd: string): string {
  return token.replaceAll('{prompt}', prompt).replaceAll('{cwd}', cwd)
}

function previewCwd(workspaceId: string | undefined): string {
  if (!workspaceId || !workspaceId.trim()) return PREVIEW_CWD
  try {
    return resolveWorkspacePath(workspaceId)
  } catch {
    // Missing / not-ready workspace is already surfaced by the run gates; the
    // preview just falls back to the placeholder instead of failing.
    return PREVIEW_CWD
  }
}

/**
 * Resolve a draft runtime into the exact argv, stdin and prompt-file plan the
 * executor would use. Never spawns and never touches the run tables.
 */
export function previewRuntimeCommand(input: PreviewCommandInput): PreviewCommandResult {
  const bin = normalizeBin(input.bin)
  if (!bin) return { preview: null, error: emptyRuntimeBinaryMessage() }

  let templateTokens: string[]
  try {
    templateTokens = parseArgsTemplate(input.argsTemplate)
  } catch (err) {
    return { preview: null, error: err instanceof Error ? err.message : String(err) }
  }

  const kind = runtimeKind(bin)
  const effort = input.effort?.trim() ?? ''
  const isFollowUp = input.isFollowUp === true
  const cwd = previewCwd(input.workspaceId)

  const runtime: RuntimeRow = {
    id: 'preview',
    label: 'preview',
    bin,
    argsTemplate: input.argsTemplate,
    promptViaStdin: input.promptViaStdin ? 1 : 0,
    description: '',
    enabled: 1,
    canOpenPrs: 0,
    // The preview is about the CLI argv, so it always previews the CLI path —
    // an ACP runtime's argv only launches the agent and is shown verbatim.
    transport: 'cli',
    createdAt: 0,
  }

  let turn: ReturnType<typeof buildTurnCommand>
  try {
    turn = buildTurnCommand({
      runtime,
      prompt: PREVIEW_PROMPT,
      cwd,
      // Claude and Grok get their session id up front; generic runtimes ignore it.
      sessionId: kind === 'generic' ? '' : PREVIEW_SESSION_ID,
      isFollowUp,
      model: input.model,
      effort,
      runtimeMode: input.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    })
  } catch (err) {
    return { preview: null, error: err instanceof Error ? err.message : String(err) }
  }

  // A non-resumable runtime returns an empty follow-up command; say so instead
  // of rendering a bare binary with a "prompt never sent" warning.
  if (isFollowUp && !turn.canResume) {
    return {
      preview: null,
      error: `The "${bin}" runtime cannot resume a conversation — every turn starts a fresh session.`,
    }
  }

  // `buildTurnCommand` expands the template against the effort-adjusted prompt;
  // mirror that here so alignment marks unchanged tokens as template-owned.
  const promptToken = applyPromptEffort(PREVIEW_PROMPT, effort, { isFollowUp })
  const templateArgs = templateTokens.map((t) => expandToken(t, promptToken, cwd))
  const { installed, path } = checkRuntimeInstalled(bin)

  return {
    error: null,
    preview: buildCommandPreview({
      bin,
      templateArgs,
      finalArgs: turn.args,
      stdinText: turn.stdin,
      promptFileContents: turn.promptFileContents,
      canResume: turn.canResume,
      installed,
      binaryPath: path,
      promptToken,
    }),
  }
}
