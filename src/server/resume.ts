/**
 * Runtime conversation adapters.
 *
 * Each coding-agent CLI has its own way of (a) being invoked headlessly,
 * (b) identifying a session, and (c) reporting the assistant's answer. This
 * module isolates that per-CLI knowledge so the executor stays generic.
 *
 * Detection is based on the runtime's `bin` rather than its row id, because the
 * Runtimes page lets users create custom entries pointing at the same binaries.
 */
import {
  applyPromptEffort,
  cliEffortValue,
  findModel,
  modelsForKind,
  type RuntimeModelKind,
} from '../lib/models.ts'
import { parseArgsTemplate } from '../lib/argsTemplate.ts'
import { DEFAULT_RUNTIME_MODE, parseRuntimeMode, type RuntimeMode } from '../lib/runtimeMode.ts'
import { isSupervised } from '../lib/supervisedPolicy.ts'
import { buildStreamJsonUserMessage } from '../lib/claudeControl.ts'
import { extractAntigravityAssistantText } from '../lib/agentEvents/antigravity.ts'
import { extractGrokAssistantText } from '../lib/agentEvents/grok.ts'
import { isAcpTransport } from '../lib/acpTransport.ts'
import type { EventRuntimeKind } from '../lib/agentEvents/types.ts'
import type { RuntimeRow } from './db.ts'
import { ensureMachineReadableArgs } from './turnEvents.ts'

const STREAM_JSON = '--input-format'
const PERMISSION_PROMPT_TOOL = '--permission-prompt-tool'
const SKIP_PERMISSIONS = '--dangerously-skip-permissions'
const ALWAYS_APPROVE = '--always-approve'
const PROMPT_FILE_TOKEN = '{promptFile}'

/**
 * Supervised Claude needs a live approval channel: read the turn as
 * stream-json on stdin and route tool permission checks to the stdio control
 * protocol. Idempotent — safe to call on args that already carry the flags.
 */
function applyClaudeSupervisedFlags(args: string[]): string[] {
  const next = [...args]
  if (!next.includes(STREAM_JSON)) {
    next.push('--input-format', 'stream-json')
  }
  if (!next.includes(PERMISSION_PROMPT_TOOL)) {
    next.push('--permission-prompt-tool', 'stdio')
  }
  return next
}

export type RuntimeKind = RuntimeModelKind

export function runtimeKind(bin: string): RuntimeKind {
  const name = bin.split(/[\\/]/).pop() ?? bin
  if (name.includes('claude')) return 'claude'
  if (name.includes('codex')) return 'codex'
  if (name.includes('grok')) return 'grok'
  // Gemini has a model catalog and ACP support, but no headless resume flag of
  // its own — over the CLI transport it stays single-shot (see supportsResume).
  if (name.includes('gemini')) return 'gemini'
  if (name === 'agy' || name.includes('antigravity')) return 'antigravity'
  if (name === 'fx' || name === 'fx.exe') return 'fx'
  return 'generic'
}

/**
 * Antigravity mirrors Claude Code's headless *flags* (`--output-format
 * stream-json`, `--dangerously-skip-permissions`, `--model`, `--effort`), but
 * not its stdout: `agy` emits `{event:'init'|'step_update'|'result'}` envelopes
 * with no `type` field, so it needs its own adapter — routing it to Claude's
 * parses every line as nothing and the run reads as an empty response.
 */
export function eventKindFor(kind: RuntimeKind): EventRuntimeKind {
  if (
    kind === 'claude' ||
    kind === 'antigravity' ||
    kind === 'codex' ||
    kind === 'grok' ||
    kind === 'gemini'
  ) {
    return kind
  }
  return 'generic'
}

export type TurnCommand = {
  /** Argv passed to the runtime binary. May contain `{promptFile}`. */
  args: string[]
  /** Text to write to the child's stdin, or null to write nothing. */
  stdin: string | null
  /**
   * When set, the executor writes this to a temp file and substitutes
   * `{promptFile}` in args (Grok and other file-prompt CLIs).
   */
  promptFileContents: string | null
  /** Human-readable command line shown in the UI. */
  display: string
  /** False when this runtime cannot resume a prior session. */
  canResume: boolean
  /**
   * Keep the child's stdin open after writing the prompt. Supervised Claude
   * turns answer `control_request` approvals over stdin, so the executor must
   * not `end()` it immediately (see claudeControl.ts / executor.ts).
   */
  keepStdinOpen: boolean
  /**
   * Prompt text for transports that deliver it as a protocol message rather
   * than on argv/stdin (ACP). Carries the same effort prefix the CLI path uses.
   */
  acpPrompt: string
  /** ACP session to `session/load` before prompting; empty starts a new one. */
  acpSessionId: string
  /** Extra env merged into the child (fx uses FX_MODEL / FX_PERMISSION_MODE). */
  extraEnv?: Record<string, string>
}

/** Expand {prompt} / {cwd} placeholders in an argument template token. */
function expandToken(token: string, prompt: string, cwd: string) {
  return token.replaceAll('{prompt}', prompt).replaceAll('{cwd}', cwd)
}

function display(bin: string, args: string[]) {
  return `${bin} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`
}

function needsPromptFile(args: string[]): boolean {
  return args.some((a) => a.includes(PROMPT_FILE_TOKEN))
}

/** Append --model / --effort (or Codex/Grok equivalents) before stdin placeholder. */
function appendModelEffortArgs(
  args: string[],
  kind: RuntimeKind,
  model: string | undefined,
  effort: string | undefined,
): string[] {
  if (!model && !effort) return args
  const catalog = modelsForKind(kind)
  const modelOpt = findModel(catalog, model)
  const next = [...args]

  const stdinIdx = next.lastIndexOf('-')
  const insertAt = stdinIdx >= 0 ? stdinIdx : next.length
  const flags: string[] = []

  if (kind === 'claude' || kind === 'antigravity') {
    if (model) flags.push('--model', model)
    const cliEffort = cliEffortValue(kind, modelOpt, effort ?? '')
    if (cliEffort) flags.push('--effort', cliEffort)
  } else if (kind === 'codex') {
    if (model) flags.push('-m', model)
    const cliEffort = cliEffortValue(kind, modelOpt, effort ?? '')
    if (cliEffort) flags.push('-c', `model_reasoning_effort=${cliEffort}`)
  } else if (kind === 'grok') {
    if (model) flags.push('-m', model)
    const cliEffort = cliEffortValue(kind, modelOpt, effort ?? '')
    if (cliEffort) flags.push('--reasoning-effort', cliEffort)
  }

  next.splice(insertAt, 0, ...flags)
  return next
}

/** Strip known permission / sandbox flags so we can re-apply from RuntimeMode. */
function stripPermissionFlags(args: string[], kind: RuntimeKind): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === SKIP_PERMISSIONS || a === ALWAYS_APPROVE) continue
    if ((kind === 'fx' || kind === 'codex') && (a === '--yolo' || a === '--auto')) continue
    if (a === '-s' && kind === 'codex') {
      i += 1
      continue
    }
    if (a === '--permission-mode' || a === '--sandbox' || a === '--full-auto' || a === '--mode') {
      if (a !== '--full-auto') i += 1
      continue
    }
    if (a.startsWith('-c') && args[i + 1]?.includes('approval_policy')) {
      i += 1
      continue
    }
    out.push(a)
  }
  return out
}

/**
 * Map access mode onto CLI flags.
 * Claude: permission-mode / dangerously-skip-permissions.
 * Codex: sandbox + approval_policy.
 * Grok: --always-approve for full-access.
 */
function applyRuntimeModeFlags(
  args: string[],
  kind: RuntimeKind,
  runtimeMode: RuntimeMode,
): string[] {
  const cleaned = stripPermissionFlags(args, kind)
  const stdinIdx = cleaned.lastIndexOf('-')
  const insertAt = stdinIdx >= 0 ? stdinIdx : cleaned.length
  const flags: string[] = []

  if (kind === 'claude') {
    if (runtimeMode === 'full-access') {
      flags.push(SKIP_PERMISSIONS)
    } else if (runtimeMode === 'auto-accept-edits') {
      flags.push('--permission-mode', 'acceptEdits')
    }
  } else if (kind === 'codex') {
    if (runtimeMode === 'full-access') {
      // `codex exec` dropped `--full-auto`; `--yolo` is the bypass flag now.
      flags.push('--yolo')
    } else if (runtimeMode === 'auto-accept-edits') {
      flags.push('--sandbox', 'workspace-write')
      flags.push('-c', 'approval_policy=on-request')
    }
  } else if (kind === 'grok') {
    if (runtimeMode === 'full-access') {
      flags.push(ALWAYS_APPROVE)
    }
  } else if (kind === 'antigravity') {
    if (runtimeMode === 'full-access') {
      flags.push(SKIP_PERMISSIONS)
    } else if (runtimeMode === 'auto-accept-edits') {
      flags.push('--mode', 'accept-edits')
    }
  } else if (kind === 'fx') {
    if (runtimeMode === 'full-access') {
      flags.push('--yolo')
    } else if (runtimeMode === 'auto-accept-edits') {
      flags.push('--auto')
    }
  }

  if (flags.length === 0) return cleaned
  const next = [...cleaned]
  next.splice(insertAt, 0, ...flags)
  return next
}

/**
 * Flags the resume hardcodes for each kind — anything else from the user's
 * argsTemplate is preserved on follow-ups (MCP dirs, custom agents, etc.).
 */
function isResumeOwnedFlag(arg: string, next: string | undefined, kind: RuntimeKind): boolean {
  if (
    arg === '-p' ||
    arg === '--single' ||
    arg === '--verbose' ||
    arg === '--json' ||
    arg === '--yolo' ||
    arg === '--auto' ||
    arg === '--no-save' ||
    arg === '--no-color' ||
    arg === 'ask' ||
    arg === '--skip-git-repo-check' ||
    arg === '--resume' ||
    arg === '-r' ||
    arg === '--conversation' ||
    arg === '--continue' ||
    arg === '-c' ||
    arg === 'exec' ||
    arg === 'resume' ||
    arg === '--last' ||
    arg === '-' ||
    arg === SKIP_PERMISSIONS ||
    arg === ALWAYS_APPROVE ||
    arg === '--full-auto' ||
    arg === '--yolo' ||
    arg === STREAM_JSON ||
    arg === 'stream-json' ||
    arg === PERMISSION_PROMPT_TOOL ||
    arg === 'stdio'
  ) {
    return true
  }
  if (arg === '--output-format' || arg === '--model' || arg === '-m' || arg === '--effort') {
    return true
  }
  if (arg === '--reasoning-effort' || arg === '--session-id' || arg === '-s') return true
  if (arg === '--prompt-file' || arg === '--permission-mode' || arg === '--sandbox') return true
  if (arg === '--resume-id' || arg === '--continue-recovery') return true
  if (kind === 'antigravity' && (arg === '--mode' || arg === '--conversation')) return true
  if (arg.startsWith('-c') && next?.includes('model_reasoning_effort')) return true
  if (arg.startsWith('-c') && next?.includes('approval_policy')) return true
  if (kind === 'claude' && (arg === next || next === undefined) && arg === '{prompt}') return true
  if (arg === '{prompt}' || arg === PROMPT_FILE_TOKEN) return true
  // Values that follow known flags are owned when the previous token was owned —
  // handled by the caller walking pairs.
  return false
}

function extractPreservedTemplateArgs(template: string[], kind: RuntimeKind): string[] {
  const preserved: string[] = []
  for (let i = 0; i < template.length; i++) {
    const a = template[i]!
    const next = template[i + 1]
    if (isResumeOwnedFlag(a, next, kind)) {
      // Skip flag + its value when the flag takes an argument.
      if (
        a === '--output-format' ||
        a === '--model' ||
        a === '-m' ||
        a === '--effort' ||
        a === '--reasoning-effort' ||
        a === '--session-id' ||
        a === '-s' ||
        a === '--prompt-file' ||
        a === '--permission-mode' ||
        a === '--sandbox' ||
        a === '--resume' ||
        a === '-r' ||
        a === '--resume-id' ||
        a === '--conversation' ||
        a === '--mode' ||
        a === PERMISSION_PROMPT_TOOL ||
        a === STREAM_JSON ||
        (a === '-c' && next)
      ) {
        i += 1
      }
      continue
    }
    preserved.push(a)
  }
  return preserved
}

function mergePreservedArgs(base: string[], preserved: string[]): string[] {
  if (preserved.length === 0) return base
  const next = [...base]
  const stdinIdx = next.lastIndexOf('-')
  const insertAt = stdinIdx >= 0 ? stdinIdx : next.length
  next.splice(insertAt, 0, ...preserved)
  return next
}

function fxProcessEnv(
  model: string | undefined,
  runtimeMode: RuntimeMode,
): Record<string, string> | undefined {
  const extraEnv: Record<string, string> = {}
  if (model) extraEnv.FX_MODEL = model
  if (runtimeMode === 'full-access') extraEnv.FX_PERMISSION_MODE = 'yolo'
  else if (runtimeMode === 'auto-accept-edits') extraEnv.FX_PERMISSION_MODE = 'auto'
  else if (runtimeMode === 'approval-required') extraEnv.FX_PERMISSION_MODE = 'ask'
  return Object.keys(extraEnv).length > 0 ? extraEnv : undefined
}

function appendNamedFlag(args: string[], flag: string, value: string): string[] {
  const next = [...args]
  const idx = next.indexOf(flag)
  if (idx >= 0) {
    const current = next[idx + 1]
    if (current && !current.startsWith('-')) {
      next[idx + 1] = value
    } else {
      next.splice(idx + 1, 0, value)
    }
    return next
  }
  next.push(flag, value)
  return next
}

function ensureFxAskArgs(args: string[]): string[] {
  const next = args.length === 0 ? ['ask'] : [...args]
  if (!next.includes('ask')) next.unshift('ask')
  if (!next.includes('--json')) {
    const i = next.indexOf('ask')
    next.splice(i >= 0 ? i + 1 : 0, 0, '--json')
  }
  return next
}

/**
 * Build the command for one conversation turn.
 *
 * First turns use the runtime's configured argsTemplate so the Runtimes page
 * stays authoritative. Follow-up turns swap in the CLI's resume invocation,
 * preserving unknown template flags.
 */
export function buildTurnCommand(input: {
  runtime: RuntimeRow
  prompt: string
  cwd: string
  sessionId: string
  isFollowUp: boolean
  model?: string
  effort?: string
  runtimeMode?: RuntimeMode | string
  /** When false, leave the template's output format alone (planner cheap path). */
  machineReadable?: boolean
}): TurnCommand {
  const { runtime, cwd, sessionId, isFollowUp } = input
  const kind = runtimeKind(runtime.bin)
  const model = input.model?.trim() || undefined
  const effort = input.effort?.trim() || undefined
  const runtimeMode = parseRuntimeMode(input.runtimeMode ?? DEFAULT_RUNTIME_MODE)
  const prompt = applyPromptEffort(input.prompt, effort ?? '', { isFollowUp })
  const supervisedClaude = kind === 'claude' && isSupervised(runtimeMode)
  const template = parseArgsTemplate(runtime.argsTemplate)
  const machineReadable = input.machineReadable !== false
  const extraEnv = kind === 'fx' ? fxProcessEnv(model, runtimeMode) : undefined

  // ACP runtimes: the args template only launches the agent (`gemini
  // --experimental-acp`, `fx acp`, an adapter process, …). Everything the
  // branches below fight over — output format, resume flags, permission flags,
  // prompt delivery — is the protocol's job once the process is up. fx is the
  // exception that still takes `--model` on the launch line so a picker change
  // overrides the model stored in a loaded session.
  if (isAcpTransport(runtime.transport)) {
    let args = template.map((t) => expandToken(t, prompt, cwd))
    if (kind === 'fx' && model) args = appendNamedFlag(args, '--model', model)
    return {
      args,
      stdin: null,
      promptFileContents: null,
      display: display(runtime.bin, args),
      canResume: true,
      keepStdinOpen: false,
      acpPrompt: prompt,
      acpSessionId: isFollowUp ? sessionId : '',
      extraEnv,
    }
  }

  if (!isFollowUp) {
    let args = template.map((t) => expandToken(t, prompt, cwd))

    if ((kind === 'claude' || kind === 'grok') && sessionId) {
      args.push('--session-id', sessionId)
    }

    args = appendModelEffortArgs(args, kind, model, effort)
    args = applyRuntimeModeFlags(args, kind, runtimeMode)
    if (machineReadable) {
      args = ensureMachineReadableArgs(args, kind)
      if (kind === 'fx') args = ensureFxAskArgs(args)
    }

    const promptFileContents = needsPromptFile(args) ? prompt : null

    if (supervisedClaude) {
      args = applyClaudeSupervisedFlags(args)
      return {
        args,
        stdin: buildStreamJsonUserMessage(prompt),
        promptFileContents: null,
        display: display(runtime.bin, args),
        canResume: true,
        keepStdinOpen: true,
        acpPrompt: prompt,
        acpSessionId: '',
        extraEnv,
      }
    }

    return {
      args,
      stdin: runtime.promptViaStdin ? prompt : null,
      promptFileContents,
      display: display(runtime.bin, args),
      canResume: kind !== 'generic',
      keepStdinOpen: false,
      acpPrompt: prompt,
      acpSessionId: '',
      extraEnv,
    }
  }

  const preserved = extractPreservedTemplateArgs(
    template.map((t) => expandToken(t, prompt, cwd)),
    kind,
  )

  if (kind === 'claude') {
    if (!sessionId) return notResumable(runtime.bin)
    let args = ['-p', '--output-format', 'stream-json', '--verbose', '--resume', sessionId]
    args = ensureMachineReadableArgs(args, 'claude')
    args = mergePreservedArgs(args, preserved)
    args = appendModelEffortArgs(args, kind, model, effort)
    args = applyRuntimeModeFlags(args, kind, runtimeMode)
    if (supervisedClaude) {
      args = applyClaudeSupervisedFlags(args)
      return {
        args,
        stdin: buildStreamJsonUserMessage(prompt),
        promptFileContents: null,
        display: display(runtime.bin, args),
        canResume: true,
        keepStdinOpen: true,
        acpPrompt: prompt,
        acpSessionId: '',
      }
    }
    return {
      args,
      stdin: prompt,
      promptFileContents: null,
      display: display(runtime.bin, args),
      canResume: true,
      keepStdinOpen: false,
      acpPrompt: prompt,
      acpSessionId: sessionId,
    }
  }

  if (kind === 'antigravity') {
    // `--conversation <id>` is the by-id resume; `--continue` picks the most
    // recent one for the cwd, which is right when the id never surfaced.
    // agy's `-p` consumes the next argv token as the prompt — flags first.
    let args = sessionId
      ? ['--output-format', 'stream-json', '--conversation', sessionId, '-p', prompt]
      : ['--output-format', 'stream-json', '--continue', '-p', prompt]
    args = mergePreservedArgs(args, preserved)
    args = appendModelEffortArgs(args, kind, model, effort)
    args = applyRuntimeModeFlags(args, kind, runtimeMode)
    return {
      args,
      stdin: null,
      promptFileContents: null,
      display: display(runtime.bin, args),
      canResume: true,
      keepStdinOpen: false,
      acpPrompt: prompt,
      acpSessionId: sessionId,
    }
  }

  if (kind === 'codex') {
    let args = sessionId
      ? ['exec', '--json', 'resume', sessionId, '--skip-git-repo-check', '-']
      : ['exec', '--json', 'resume', '--last', '--skip-git-repo-check', '-']
    args = mergePreservedArgs(args, preserved)
    args = appendModelEffortArgs(args, kind, model, effort)
    args = applyRuntimeModeFlags(args, kind, runtimeMode)
    return {
      args,
      stdin: prompt,
      promptFileContents: null,
      display: display(runtime.bin, args),
      canResume: true,
      keepStdinOpen: false,
      acpPrompt: prompt,
      acpSessionId: sessionId,
    }
  }

  if (kind === 'grok') {
    if (!sessionId) return notResumable(runtime.bin)
    let args = [
      '--resume',
      sessionId,
      '--prompt-file',
      PROMPT_FILE_TOKEN,
      '--output-format',
      'streaming-json',
    ]
    args = mergePreservedArgs(args, preserved)
    args = appendModelEffortArgs(args, kind, model, effort)
    args = applyRuntimeModeFlags(args, kind, runtimeMode)
    args = ensureMachineReadableArgs(args, kind)
    return {
      args,
      stdin: null,
      promptFileContents: prompt,
      display: display(runtime.bin, args),
      canResume: true,
      keepStdinOpen: false,
      acpPrompt: prompt,
      acpSessionId: sessionId,
    }
  }

  if (kind === 'fx') {
    if (!sessionId) return notResumable(runtime.bin)
    let args = ['ask', '--json', '--resume', sessionId]
    args = mergePreservedArgs(args, preserved)
    args = applyRuntimeModeFlags(args, kind, runtimeMode)
    return {
      args,
      stdin: prompt,
      promptFileContents: null,
      display: display(runtime.bin, args),
      canResume: true,
      keepStdinOpen: false,
      acpPrompt: prompt,
      acpSessionId: sessionId,
      extraEnv,
    }
  }

  return notResumable(runtime.bin)
}

function notResumable(bin: string): TurnCommand {
  return {
    args: [],
    stdin: null,
    promptFileContents: null,
    display: bin,
    canResume: false,
    keepStdinOpen: false,
    acpPrompt: '',
    acpSessionId: '',
  }
}

/**
 * Whether follow-up chat is possible for a runtime at all.
 *
 * Over ACP the answer is always yes — `session/load` is part of the protocol.
 * Over the CLI transport it depends on the binary having a resume flag we know
 * how to build, which Gemini and generic runtimes do not.
 */
export function supportsResume(bin: string, transport?: string | null): boolean {
  if (isAcpTransport(transport)) return true
  const kind = runtimeKind(bin)
  return kind !== 'generic' && kind !== 'gemini'
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * Recover a session id from CLI output. Codex prints one in its startup banner
 * ("session id: <uuid>") and in its JSONL events; Claude/Grok assign up front.
 */
export function extractSessionId(stdout: string): string | null {
  const trimmedAll = stdout.trim()
  if (trimmedAll.startsWith('{') && trimmedAll.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmedAll) as Record<string, unknown>
      const fromObject = sessionIdFromObject(obj)
      if (fromObject) return fromObject
    } catch {
      // Fall through to the line scanner.
    }
  }

  const labelled = stdout.match(
    new RegExp(`(?:session[_ -]?id|thread[_ -]?id)"?\\s*[:=]\\s*"?(${UUID.source})`, 'i'),
  )
  if (labelled?.[1]) return labelled[1]

  const labelledAny = stdout.match(
    /(?:session[_ -]?id|thread[_ -]?id)"?\s*[:=]\s*"?([A-Za-z0-9._:-]+)/i,
  )
  if (labelledAny?.[1] && labelledAny[1] !== 'null') return labelledAny[1]

  for (const line of stdout.split('\n').slice(0, 20)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      const fromObject = sessionIdFromObject(obj)
      if (fromObject) return fromObject
    } catch {
      // Not JSON — ignore.
    }
  }
  return null
}

function sessionIdFromObject(obj: Record<string, unknown>): string | null {
  for (const key of ['session_id', 'sessionId', 'thread_id', 'conversation_id']) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

/**
 * Extract the assistant's readable answer from a turn's raw stdout.
 *
 * Runtimes configured with `--output-format text` already print exactly that,
 * so the common path is a passthrough. JSON and JSONL outputs are unwrapped so
 * the chat bubble shows prose instead of a wall of envelope.
 */
export function parseAssistantText(stdout: string): string {
  const trimmed = stdout.trim()
  if (!trimmed) return ''

  const grok = extractGrokAssistantText(trimmed)
  if (grok !== null) return grok

  // `agy` envelopes carry no `type`, so the generic JSONL scan below finds
  // nothing in them and would return an empty answer.
  const antigravity = extractAntigravityAssistantText(trimmed)
  if (antigravity !== null) return antigravity

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      const direct = obj.result ?? obj.output ?? obj.text ?? obj.content ?? obj.message
      if (typeof direct === 'string') return direct.trim()
    } catch {
      // Fall through to the raw text.
    }
  }

  if (trimmed.startsWith('{')) {
    const texts: string[] = []
    for (const line of trimmed.split('\n')) {
      const l = line.trim()
      if (!l.startsWith('{')) continue
      try {
        const obj = JSON.parse(l) as Record<string, unknown>
        const type = String(obj.type ?? '')
        if (type === 'result' && typeof obj.result === 'string') {
          texts.push(obj.result)
          continue
        }
        const item = obj.item as Record<string, unknown> | undefined
        if (item && item.type === 'agent_message' && typeof item.text === 'string') {
          texts.push(item.text)
        }
        if ((type === 'assistant' || type === 'message') && typeof obj.text === 'string') {
          texts.push(obj.text)
        }
        if (typeof obj.content === 'string' && (type === 'assistant' || type === 'response')) {
          texts.push(obj.content)
        }
      } catch {
        // Not JSON — ignore.
      }
    }
    if (texts.length > 0) return texts.join('\n\n').trim()
    // JSONL with no extractable assistant text — avoid the envelope wall.
    return ''
  }

  return trimmed
}
