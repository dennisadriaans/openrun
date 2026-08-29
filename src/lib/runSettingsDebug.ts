/**
 * Read back the settings a turn *actually* launched with, from the argv the
 * runtime receives rather than the automation row — so a stale or dropped
 * setting shows up instead of being echoed back from the same source.
 */
import { parseTransport, type RuntimeTransport } from './acpTransport.ts'
import { parseRuntimeMode, type RuntimeMode } from './runtimeMode.ts'

const MODEL_FLAGS = ['--model', '-m']
const EFFORT_FLAGS = ['--effort', '--reasoning-effort', '--reasoning_effort']
const ACCESS_FLAGS = [
  '--dangerously-skip-permissions',
  '--always-approve',
  '--yolo',
  '--auto',
  '--full-auto',
]
const ACCESS_VALUE_FLAGS = ['--permission-mode', '--sandbox', '--mode']

function flagValue(args: string[], flags: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    for (const flag of flags) {
      if (arg === flag) {
        const next = args[i + 1]
        if (next && !next.startsWith('-')) return next
      }
      if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
    }
  }
  return null
}

/** Codex carries effort as `-c model_reasoning_effort=high`. */
function configValue(args: string[], key: string): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    const candidate =
      arg === '-c' || arg === '--config' ? args[i + 1] : arg.startsWith('-c') ? arg.slice(2) : null
    if (candidate?.startsWith(`${key}=`)) return candidate.slice(key.length + 1)
  }
  return null
}

function accessFlags(args: string[]): string {
  const found: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (ACCESS_FLAGS.includes(arg)) found.push(arg)
    if (ACCESS_VALUE_FLAGS.includes(arg) && args[i + 1]) found.push(`${arg} ${args[i + 1]}`)
    if (arg === '-s' && args[i + 1]) found.push(`--sandbox ${args[i + 1]}`)
  }
  return found.join(' ')
}

export type EffectiveTurnSettings = {
  bin: string
  args: string[]
  /** Normalized transport used by the turn. */
  transport?: string | null
  /** Normalized access mode used by the turn. */
  runtimeMode?: string | null
  /** True for schedule/webhook/repair turns with nobody at the keyboard. */
  unattended?: boolean
  /** Env the child gets on top of process.env (fx carries model/mode here). */
  extraEnv?: Record<string, string> | undefined
  /** Prompt as delivered to the CLI — effort may be injected into it. */
  prompt: string
  branch: string
  cwd: string
}

/**
 * One-line, log-shaped summary. `default` means the flag was never passed and
 * the CLI picks for itself; that is the interesting failure to be able to see.
 */
export function describeEffectiveTurnSettings(input: EffectiveTurnSettings): string {
  const { args, prompt } = input
  const transport: RuntimeTransport = parseTransport(input.transport)
  const runtimeMode: RuntimeMode = parseRuntimeMode(input.runtimeMode)
  const model = flagValue(args, MODEL_FLAGS) ?? input.extraEnv?.FX_MODEL ?? 'default'
  const effortFlag =
    flagValue(args, EFFORT_FLAGS) ?? configValue(args, 'model_reasoning_effort') ?? ''
  const promptEffort = /^ultrathink:/i.test(prompt.trimStart()) ? 'ultrathink (in prompt)' : ''
  const effort = effortFlag || promptEffort || 'default'
  const access =
    accessFlags(args) || input.extraEnv?.FX_PERMISSION_MODE || (transport === 'acp' ? runtimeMode : 'default')

  const parts = [
    `runtime=${input.bin}`,
    `transport=${transport}`,
    `mode=${runtimeMode}`,
    `execution=${input.unattended ? 'unattended' : 'attended'}`,
    `model=${model}`,
    `effort=${effort}`,
    `branch=${input.branch || 'none'}`,
    `cwd=${input.cwd}`,
    `access=${access}`,
  ]
  return `Launched with ${parts.join(' · ')}`
}
