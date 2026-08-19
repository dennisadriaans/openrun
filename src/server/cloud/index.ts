/**
 * Control-plane client: session, login, outbound relay.
 *
 * Safe to boot when unsigned — startCloudRelay no-ops without a session.
 */
import { restartCloudRelay, startCloudRelay, stopCloudRelay } from './relay.ts'
import { signOutCloud } from './login.ts'
import { forgetCloudProviders } from './providers.ts'

export { getCloudStatus } from './status.ts'
export { skipCloudOnboarding } from './onboarding.ts'
export {
  completeCloudLogin,
  configuredCloudUrl,
  startCloudLogin,
  startHostedConnect,
  signOutCloud,
} from './login.ts'
export { restartCloudRelay, startCloudRelay, stopCloudRelay } from './relay.ts'
export { listCloudProviders } from './providers.ts'
export {
  completeHostedConnect,
  disconnectHostedIntegration,
  ingestTestEvent,
  listHostedConnections,
} from './hosted.ts'

export function bootCloud(): void {
  try {
    void startCloudRelay()
  } catch (err) {
    console.error('[cloud] boot failed', err)
  }
}

export async function signOutAndDisconnect(): Promise<void> {
  stopCloudRelay()
  signOutCloud()
  forgetCloudProviders()
}

export async function afterSignIn(): Promise<void> {
  // Signing in usually means the machine just came online, or is pointed at a
  // different control plane than the cached answer came from.
  forgetCloudProviders()
  await restartCloudRelay()
}
