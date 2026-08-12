/**
 * Resolve whether a runtime binary is on PATH (or an explicit file path).
 * Server-only — uses fs PATH walking; keep messages in ../lib/runtimeBinary.
 */
import { accessSync, constants } from 'node:fs'
import { isAbsolute } from 'node:path'
import { assertRuntimeBinaryAvailable, normalizeBin } from '../lib/runtimeBinary.ts'
import { ensureProcessPathAugmented, findOnPath } from './userPath.ts'

/** Check whether a runtime's binary is resolvable on PATH (or as a path). */
export function checkRuntimeInstalled(bin: string): { installed: boolean; path: string } {
  const name = normalizeBin(bin)
  if (!name) return { installed: false, path: '' }

  // Absolute or explicit relative path — check the file itself (which/where
  // is unreliable for paths that already include a separator).
  if (isAbsolute(name) || name.includes('/') || name.includes('\\')) {
    try {
      accessSync(name, constants.F_OK)
      return { installed: true, path: name }
    } catch {
      return { installed: false, path: '' }
    }
  }

  const pathEnv = ensureProcessPathAugmented()
  const resolved = findOnPath(name, pathEnv)
  return { installed: resolved.length > 0, path: resolved }
}

/** Throw before spawn when the runtime binary cannot be resolved. */
export function assertRuntimeOnPath(bin: string): string {
  const { installed } = checkRuntimeInstalled(bin)
  return assertRuntimeBinaryAvailable(bin, installed)
}
