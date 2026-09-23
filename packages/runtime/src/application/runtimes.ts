/** runtimes capability implementation. */
import { assertArgsTemplate } from '@openrun/domain/runtimes/argsTemplate'
import { hasWorkspaceId } from '@openrun/domain/workspaces/workspaceRef'
import type { ModelOption } from '@openrun/domain/runtimes/models'
import { cachedModelsForBin } from '../runtimes/modelCatalog.ts'
import { compareRuntimesForDisplay, RUNTIME_PRESETS } from '@openrun/domain/runtimes/runtimePresets'
import { acpTransportRefusal, parseTransport } from '@openrun/domain/runtimes/acpTransport'
import {
  missingNativeSessionMessage,
  nativeResumeKindFor,
  nativeResumeNotSupportedMessage,
} from '@openrun/domain/runtimes/nativeSessions'
import {
  forgetDeletedRuntimeId,
  getDb,
  rememberDeletedRuntimeId,
  type RuntimeRow,
} from '../storage/db.ts'
import { unattendedVerificationRefusal } from '../execution/unattendedPreflight.ts'
import { assertRuntimeOnPath, checkRuntimeInstalled } from '../runtimes/runtimePath.ts'
import {
  previewRuntimeCommand,
  type PreviewCommandInput,
  type PreviewCommandResult,
} from '../runtimes/commandPreview.ts'
import { resolveWorkspacePath } from '../workspaces/workspaces.ts'
import { nativeSessionExists } from '../runtimes/nativeSessions.ts'
import { id } from './id.ts'

/**
 * A runtime plus the models its installed binary currently offers. Carried on
 * the runtime rather than fetched separately so every model picker in the app
 * (new run, automation form, project defaults) gets the live catalog from a
 * request it was already making.
 */
export type RuntimeWithModels = RuntimeRow & { models: ModelOption[] }

export function listRuntimes(): RuntimeWithModels[] {
  const rows = getDb()
    .prepare('SELECT * FROM runtimes ORDER BY createdAt ASC')
    .all() as RuntimeRow[]
  return rows
    .sort(compareRuntimesForDisplay)
    .map((r) => ({ ...r, models: cachedModelsForBin(r.bin) }))
}

/**
 * Runtimes with their PATH status folded in.
 *
 * The Runtimes page always needs both, and asking for them separately made the
 * server function do the join itself. The contract dispatches straight to a
 * `core.ts` export, so the join belongs here — the facade is the only place
 * allowed to compose.
 */
export function listRuntimesWithStatus(): Array<
  RuntimeWithModels & { installed: boolean; path: string }
> {
  return listRuntimes().map((r) => ({ ...r, ...checkRuntimeInstalled(r.bin) }))
}

export function getRuntime(runtimeId: string): RuntimeRow | undefined {
  return getDb().prepare('SELECT * FROM runtimes WHERE id = ?').get(runtimeId) as
    | RuntimeRow
    | undefined
}

export type RuntimeInput = {
  id?: string
  label: string
  bin: string
  argsTemplate: string
  promptViaStdin: boolean
  description: string
  enabled: boolean
  /** Allow the agent to open its own PR during a run (ticket 05). */
  canOpenPrs?: boolean
  /** 'cli' (parse stdout) or 'acp' (speak Agent Client Protocol). */
  transport?: string
}

export function upsertRuntime(input: RuntimeInput): RuntimeRow {
  assertArgsTemplate(input.argsTemplate)
  const transport = parseTransport(input.transport)
  const refusal = acpTransportRefusal({ transport, bin: input.bin })
  if (refusal) throw new Error(refusal)
  const db = getDb()
  const rid = input.id ?? id('rt')
  const existing = db.prepare('SELECT createdAt FROM runtimes WHERE id = ?').get(rid) as
    | { createdAt: number }
    | undefined
  db.prepare(
    `INSERT INTO runtimes (id, label, bin, argsTemplate, promptViaStdin, description, enabled, canOpenPrs, transport, createdAt)
     VALUES (@id, @label, @bin, @argsTemplate, @promptViaStdin, @description, @enabled, @canOpenPrs, @transport, @createdAt)
     ON CONFLICT(id) DO UPDATE SET
       label=@label, bin=@bin, argsTemplate=@argsTemplate,
       promptViaStdin=@promptViaStdin, description=@description, enabled=@enabled,
       canOpenPrs=@canOpenPrs, transport=@transport`,
  ).run({
    id: rid,
    label: input.label,
    bin: input.bin,
    argsTemplate: input.argsTemplate,
    promptViaStdin: input.promptViaStdin ? 1 : 0,
    description: input.description,
    enabled: input.enabled ? 1 : 0,
    canOpenPrs: input.canOpenPrs ? 1 : 0,
    transport,
    createdAt: existing?.createdAt ?? Date.now(),
  })
  forgetDeletedRuntimeId(rid)
  return getRuntime(rid)!
}

export function deleteRuntime(runtimeId: string) {
  getDb().prepare('DELETE FROM runtimes WHERE id = ?').run(runtimeId)
  rememberDeletedRuntimeId(runtimeId)
}

/** PATH status for gallery presets, keyed by binary name. */
export function listPresetBinStatus(): Array<{ bin: string; installed: boolean; path: string }> {
  const seen = new Set<string>()
  const out: Array<{ bin: string; installed: boolean; path: string }> = []
  for (const preset of RUNTIME_PRESETS) {
    if (seen.has(preset.bin)) continue
    seen.add(preset.bin)
    out.push({ bin: preset.bin, ...checkRuntimeInstalled(preset.bin) })
  }
  return out
}

export { checkRuntimeInstalled }

export { previewRuntimeCommand }

export type { PreviewCommandInput, PreviewCommandResult }

/**
 * Preview the command for a saved runtime by id (e.g. tooling / scratchpad),
 * without round-tripping the runtime's bin / template through the client.
 */
export function previewRuntimeCommandById(input: {
  runtimeId: string
  workspaceId?: string
  model?: string
  effort?: string
  runtimeMode?: string
  isFollowUp?: boolean
}): PreviewCommandResult {
  const runtime = getRuntime(input.runtimeId)
  if (!runtime) return { preview: null, error: 'Runtime not found' }
  return previewRuntimeCommand({
    bin: runtime.bin,
    argsTemplate: runtime.argsTemplate,
    promptViaStdin: runtime.promptViaStdin === 1,
    transport: runtime.transport,
    workspaceId: input.workspaceId,
    model: input.model,
    effort: input.effort,
    runtimeMode: input.runtimeMode,
    isFollowUp: input.isFollowUp,
  })
}

/** Refuse arming when the task's CLI binary is blank or missing from PATH. */
function assertTaskRuntimeOnPath(runtimeId: string): void {
  const runtime = getRuntime(runtimeId)
  if (!runtime) throw new Error('Runtime not found for task')
  assertRuntimeOnPath(runtime.bin)
}

/** Unattended verification must be enabled and have a project check. */
function assertUnattendedVerificationConfigured(
  workspaceId: string,
  verifyEnabled: number | boolean = true,
): void {
  const refusal = unattendedVerificationRefusal({ workspaceId, verifyEnabled })
  if (refusal) throw new Error(refusal)
}

function nativeSessionValidForTask(task: {
  resumeSessionId: string
  cwd: string
  workspaceId: string
  runtimeId: string
}): boolean {
  const id = task.resumeSessionId.trim()
  if (!id) return true
  const runtime = getRuntime(task.runtimeId)
  const kind = nativeResumeKindFor(runtime ?? {})
  if (!kind) return false
  let cwd = task.cwd.trim()
  if (!cwd && hasWorkspaceId(task.workspaceId)) {
    try {
      cwd = resolveWorkspacePath(task.workspaceId)
    } catch {
      return false
    }
  }
  if (!cwd) return false
  return nativeSessionExists(cwd, kind, id)
}

function assertNativeResume(input: {
  resumeSessionId: string
  runtimeId: string
  cwd: string
}): void {
  const id = input.resumeSessionId.trim()
  if (!id) return
  const runtime = getRuntime(input.runtimeId)
  const kind = nativeResumeKindFor(runtime ?? {})
  if (!kind) throw new Error(nativeResumeNotSupportedMessage())
  if (!nativeSessionExists(input.cwd, kind, id)) throw new Error(missingNativeSessionMessage(kind))
}

// Internal collaborators; the public facade exports only the API surface.
export {
  nativeSessionValidForTask,
  assertTaskRuntimeOnPath,
  assertNativeResume,
  assertUnattendedVerificationConfigured,
}
