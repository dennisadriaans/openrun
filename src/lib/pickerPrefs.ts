/**
 * Persisted last-used composer picker selections (runtime, model, effort,
 * access mode). Backed by localStorage so the New Chat modal, the Agent
 * Instructions task form, and the run composer all open on whatever the user
 * picked last.
 *
 * Model/effort are remembered *per runtime*: switching Claude ⇄ Codex restores
 * the last model chosen for that runtime rather than an invalid cross-runtime
 * slug. Runtime and access mode are single global values.
 */
import { useCallback, useEffect, useState } from 'react'
import { isRuntimeMode, type RuntimeMode } from './runtimeMode.ts'

const KEY = 'agentops:picker'

export type RuntimeModelPref = {
  model?: string
  effort?: string
}

export type PickerPrefs = {
  runtimeId?: string
  runtimeMode?: RuntimeMode
  /** Last model/effort keyed by runtime id. */
  byRuntime?: Record<string, RuntimeModelPref>
}

/** Patch applied via {@link usePickerPrefs}'s `remember`. */
export type PickerPrefsPatch = {
  runtimeId?: string
  runtimeMode?: RuntimeMode
  /** When set alongside a model/effort, scopes them under this runtime. */
  forRuntimeId?: string
  model?: string
  effort?: string
}

function sanitize(raw: unknown): PickerPrefs {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  const out: PickerPrefs = {}
  if (typeof obj.runtimeId === 'string') out.runtimeId = obj.runtimeId
  if (isRuntimeMode(obj.runtimeMode as string)) out.runtimeMode = obj.runtimeMode as RuntimeMode
  if (obj.byRuntime && typeof obj.byRuntime === 'object') {
    const by: Record<string, RuntimeModelPref> = {}
    for (const [id, val] of Object.entries(obj.byRuntime as Record<string, unknown>)) {
      if (!val || typeof val !== 'object') continue
      const v = val as Record<string, unknown>
      const pref: RuntimeModelPref = {}
      if (typeof v.model === 'string') pref.model = v.model
      if (typeof v.effort === 'string') pref.effort = v.effort
      by[id] = pref
    }
    out.byRuntime = by
  }
  return out
}

export function readPickerPrefs(): PickerPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? sanitize(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

function writePickerPrefs(prefs: PickerPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // ignore (private mode / disabled storage)
  }
}

/** Merge a patch into prefs. Exported for testing; use `remember` at runtime. */
export function applyPatch(prev: PickerPrefs, patch: PickerPrefsPatch): PickerPrefs {
  const next: PickerPrefs = { ...prev }
  if (patch.runtimeId !== undefined) next.runtimeId = patch.runtimeId
  if (patch.runtimeMode !== undefined) next.runtimeMode = patch.runtimeMode

  const scope = patch.forRuntimeId ?? patch.runtimeId ?? prev.runtimeId
  if (scope && (patch.model !== undefined || patch.effort !== undefined)) {
    const byRuntime = { ...(prev.byRuntime ?? {}) }
    const current = byRuntime[scope] ?? {}
    byRuntime[scope] = {
      model: patch.model !== undefined ? patch.model : current.model,
      effort: patch.effort !== undefined ? patch.effort : current.effort,
    }
    next.byRuntime = byRuntime
  }
  return next
}

/** Read the remembered model/effort for a runtime, if any. */
export function pickerPrefForRuntime(
  prefs: PickerPrefs,
  runtimeId: string | undefined,
): RuntimeModelPref {
  if (!runtimeId) return {}
  return prefs.byRuntime?.[runtimeId] ?? {}
}

/**
 * Reactive access to persisted picker prefs. `remember` merges a patch and
 * persists synchronously so a value chosen on one surface is visible to the
 * next surface that mounts.
 */
export function usePickerPrefs() {
  const [prefs, setPrefs] = useState<PickerPrefs>(() => readPickerPrefs())

  // Pick up changes made in other tabs / windows.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setPrefs(readPickerPrefs())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const remember = useCallback((patch: PickerPrefsPatch) => {
    setPrefs((prev) => {
      const next = applyPatch(prev, patch)
      writePickerPrefs(next)
      return next
    })
  }, [])

  return { prefs, remember }
}
