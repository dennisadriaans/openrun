/**
 * Agent access / permission mode for a chat run.
 * Labels match T3 Code's Access control.
 */
export type RuntimeMode = 'approval-required' | 'auto-accept-edits' | 'full-access'

export const DEFAULT_RUNTIME_MODE: RuntimeMode = 'full-access'

export const RUNTIME_MODES: Array<{
  value: RuntimeMode
  label: string
  description: string
}> = [
  {
    value: 'approval-required',
    label: 'Supervised',
    description: 'Ask before running tools or editing files',
  },
  {
    value: 'auto-accept-edits',
    label: 'Auto-accept edits',
    description: 'Allow file edits without prompting; still ask for risky commands',
  },
  {
    value: 'full-access',
    label: 'Full access',
    description: 'Skip permission prompts for this session',
  },
]

export function isRuntimeMode(value: string | null | undefined): value is RuntimeMode {
  return (
    value === 'approval-required' ||
    value === 'auto-accept-edits' ||
    value === 'full-access'
  )
}

export function parseRuntimeMode(value: string | null | undefined): RuntimeMode {
  return isRuntimeMode(value) ? value : DEFAULT_RUNTIME_MODE
}

export function runtimeModeLabel(mode: RuntimeMode): string {
  return RUNTIME_MODES.find((m) => m.value === mode)?.label ?? mode
}
