/** Paths shared by the web process, headless worker and CLI. No database boot. */
import { existsSync, renameSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openrunEnv } from '../lib/openrunEnv.ts'

export function openrunHome(): string {
  const fromEnv = openrunEnv('HOME')
  if (fromEnv) return path.resolve(fromEnv)
  const next = path.join(os.homedir(), '.openrun')
  const legacy = path.join(os.homedir(), '.agentops')
  // Move rather than read-through: a fallback that only *reads* the old path
  // dies the instant anything creates the new one, and the user silently loses
  // their session. See `adoptLegacyDatabase` for the same reasoning.
  if (!existsSync(next) && existsSync(legacy)) {
    try {
      renameSync(legacy, next)
    } catch {
      // Cross-device or permissions — keep serving the old path.
      return legacy
    }
  }
  return next
}
