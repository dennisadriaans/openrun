/**
 * Public cloud status for the UI. Never includes tokens.
 */
import type { CloudStatus } from '../../lib/cloud/types.ts'
import { configuredCloudUrl } from './login.ts'
import { cloudRelayStatus } from './relay.ts'
import { readCloudSession, readMachineId, readOnboarding } from './session.ts'

export function getCloudStatus(): CloudStatus {
  const session = readCloudSession()
  return {
    cloudUrl: configuredCloudUrl(),
    signedIn: Boolean(session),
    email: session?.email ?? null,
    userId: session?.userId ?? null,
    machineId: session?.machineId || readMachineId(),
    relay: cloudRelayStatus(),
    onboardingSkipped: readOnboarding().skipped,
  }
}
