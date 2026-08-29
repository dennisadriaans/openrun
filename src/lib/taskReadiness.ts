/**
 * The complete readiness explanation for an automation.
 *
 * This is deliberately pure: the server supplies the live facts (workspace,
 * runtime, integration and checks), while the task detail UI can render the
 * same ordered list without inventing a second set of gates.
 */
import { invalidCronMessage } from './cron.ts'
import { parseArgsTemplate } from './argsTemplate.ts'
import { missingNativeSessionMessage } from './nativeSessions.ts'
import { emptyTaskPromptMessage } from './taskPrompt.ts'
import { emptyRuntimeBinaryMessage, missingRuntimeBinaryMessage } from './runtimeBinary.ts'
import { parseRuntimeMode } from './runtimeMode.ts'
import { isSupervised } from './supervisedPolicy.ts'
import { parseTransport } from './acpTransport.ts'
import { missingWorkspaceMessage } from './workspaceRef.ts'
import { workspaceNotReadyMessage } from './workspaceReady.ts'

export type TaskReadinessBlockerId =
  | 'workspace'
  | 'runtime'
  | 'prompt'
  | 'prompt-delivery'
  | 'resume'
  | 'cron'
  | 'one-shot'
  | 'trigger'
  | 'verification-disabled'
  | 'verification-checks'
  | 'unattended'
  | 'supervision'

export type TaskReadinessBlocker = {
  id: TaskReadinessBlockerId
  message: string
}

export type TaskReadinessInput = {
  enabled: boolean | number
  cron: string
  cronValid: boolean
  workspaceValid: boolean
  workspaceReady: boolean
  workspaceStatus?: string | null
  /** False when the selected runtime row was deleted or never existed. */
  runtimeValid?: boolean
  runtimeBlockReason?: string | null
  runtimeInstalled: boolean
  runtimeBin?: string
  promptValid: boolean
  /** False when the runtime has no unambiguous prompt channel. */
  promptDeliveryValid?: boolean
  promptDeliveryReason?: string | null
  resumeSessionId?: string | null
  resumeSessionValid?: boolean
  /** A webhook connection is absent when this is false. */
  triggerReady?: boolean
  triggerBlockReason?: string | null
  verifyEnabled?: boolean | number
  checkCount?: number
  fireOnce?: boolean | number
  scheduledAt?: number
  /** Effective mode for callers that can select a mode for the automation. */
  runtimeMode?: string | null
  /** Shared unattended gate (isolation, physical health, gh, etc.). */
  unattendedBlockedReason?: string | null
  /** Supervised mode is not safe on a schedule or webhook. */
  supervisionBlockedReason?: string | null
}

/**
 * Resolve whether a runtime has exactly one way to receive a task prompt.
 * ACP delivers it through `session/prompt`; CLI runtimes use stdin or one of
 * the explicit template placeholders. Legacy invalid templates are reported as
 * readiness blockers instead of being allowed to fail at fire time.
 */
export function runtimePromptDelivery(input: {
  transport?: string | null
  promptViaStdin: boolean
  argsTemplate: string
}): { valid: boolean; reason: string | null } {
  // Unknown / legacy values intentionally follow the same CLI default as the
  // runtime and preview paths.
  if (parseTransport(input.transport) === 'acp') return { valid: true, reason: null }

  let args: string[]
  try {
    args = parseArgsTemplate(input.argsTemplate)
  } catch (err) {
    return {
      valid: false,
      reason:
        err instanceof Error
          ? `Invalid runtime args template: ${err.message}`
          : 'Invalid runtime args template.',
    }
  }
  const inStdin = input.promptViaStdin
  const inArgs = args.some((arg) => arg.includes('{prompt}') || arg.includes('{promptFile}'))
  if (inStdin && inArgs) {
    return {
      valid: false,
      reason: 'The runtime delivers the prompt on stdin and in its args template.',
    }
  }
  if (!inStdin && !inArgs) {
    return {
      valid: false,
      reason:
        'The runtime never delivers the prompt. Enable stdin or add {prompt} / {promptFile} to its args template.',
    }
  }
  return { valid: true, reason: null }
}

/** Whether this task has a trigger with no human watching it. */
export function hasUnattendedTrigger(
  input: Pick<TaskReadinessInput, 'cron' | 'fireOnce'> & { webhookIntegrationId?: string | null },
): boolean {
  return Boolean(input.cron.trim() || input.webhookIntegrationId?.trim() || input.fireOnce)
}

/**
 * Return every blocker that applies, in the order a user can fix them.
 * Manual-only tasks do not need AFK verification or unattended-policy checks.
 */
export function taskReadinessBlockers(
  input: TaskReadinessInput & { webhookIntegrationId?: string | null },
): TaskReadinessBlocker[] {
  const blockers: TaskReadinessBlocker[] = []
  const unattended = hasUnattendedTrigger(input)

  if (!input.workspaceValid) {
    blockers.push({ id: 'workspace', message: missingWorkspaceMessage() })
  } else if (!input.workspaceReady) {
    blockers.push({
      id: 'workspace',
      message: workspaceNotReadyMessage(input.workspaceStatus),
    })
  }

  if (input.runtimeValid === false) {
    blockers.push({
      id: 'runtime',
      message:
        input.runtimeBlockReason?.trim() ||
        'Runtime not found for this automation. Pick an available runtime before running it.',
    })
  } else if (!input.runtimeInstalled) {
    blockers.push({
      id: 'runtime',
      message: input.runtimeBin?.trim()
        ? missingRuntimeBinaryMessage(input.runtimeBin)
        : emptyRuntimeBinaryMessage(),
    })
  }

  if (!input.promptValid) {
    blockers.push({ id: 'prompt', message: emptyTaskPromptMessage() })
  } else if (input.promptDeliveryValid === false) {
    blockers.push({
      id: 'prompt-delivery',
      message:
        input.promptDeliveryReason?.trim() ||
        'The runtime has no valid prompt delivery channel. Enable stdin or add {prompt} / {promptFile} to its args template.',
    })
  }

  if ((input.resumeSessionId ?? '').trim() && input.resumeSessionValid === false) {
    blockers.push({ id: 'resume', message: missingNativeSessionMessage() })
  }

  if (input.cron.trim() && !input.cronValid) {
    blockers.push({ id: 'cron', message: invalidCronMessage(input.cron) })
  }

  if (input.fireOnce) {
    if (!input.cron.trim()) {
      blockers.push({
        id: 'one-shot',
        message: 'A one-shot automation needs a valid schedule before it can fire.',
      })
    } else if (!input.cronValid || !(input.scheduledAt && input.scheduledAt > 0)) {
      blockers.push({
        id: 'one-shot',
        message:
          'One-shot automation has no valid absolute fire time. Pick a future time and save it again.',
      })
    }
  }

  if (input.webhookIntegrationId?.trim() && input.triggerReady === false) {
    blockers.push({
      id: 'trigger',
      message:
        input.triggerBlockReason?.trim() ||
        'The selected webhook connection is unavailable. Pick an enabled connection before running this automation.',
    })
  }

  const verificationEnabled = input.verifyEnabled !== false && input.verifyEnabled !== 0
  if (unattended && !verificationEnabled) {
    blockers.push({
      id: 'verification-disabled',
      message:
        'Verification is disabled. Enable project checks before leaving a scheduled or webhook automation unattended.',
    })
  }
  if (unattended && (input.checkCount ?? 0) === 0) {
    blockers.push({
      id: 'verification-checks',
      message:
        'No verification checks are configured for this project. Add at least one check before leaving this automation unattended.',
    })
  }

  if (unattended && input.unattendedBlockedReason?.trim()) {
    const message = input.unattendedBlockedReason.trim()
    const duplicate = blockers.some(
      (blocker) =>
        blocker.message === message ||
        message.toLowerCase().includes(blocker.message.toLowerCase()),
    )
    if (!duplicate) blockers.push({ id: 'unattended', message })
  }
  if (unattended && input.supervisionBlockedReason?.trim()) {
    blockers.push({ id: 'supervision', message: input.supervisionBlockedReason.trim() })
  } else if (unattended && isSupervised(parseRuntimeMode(input.runtimeMode))) {
    blockers.push({
      id: 'supervision',
      message:
        'Supervised runs need someone to answer approval prompts, so they cannot run on a schedule or webhook. Use Full access or Auto-accept edits for unattended automations.',
    })
  }

  return blockers
}
