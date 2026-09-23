/**
 * First-run choice. Signing in is the default path; skipping is remembered so
 * the welcome screen asks once, not on every boot.
 */
import { readOnboarding, writeOnboarding } from './session.ts'

export function skipCloudOnboarding(): { skipped: boolean } {
  writeOnboarding({ skipped: true, seenAt: Date.now() })
  return { skipped: readOnboarding().skipped }
}
