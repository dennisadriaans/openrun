/**
 * Control-plane client: session, login, outbound relay.
 *
 * Safe to boot when unsigned — startCloudRelay no-ops without a session.
 */
import { restartCloudRelay, startCloudRelay, stopCloudRelay } from './relay.ts'
import { signOutCloud } from './login.ts'

export { getCloudStatus } from './status.ts'
export { skipCloudOnboarding } from './onboarding.ts'
export {
  completeCloudLogin,
  configuredCloudUrl,
  startCloudLogin,
  startJiraConnect,
  signOutCloud,
} from './login.ts'
export { restartCloudRelay, startCloudRelay, stopCloudRelay } from './relay.ts'
export { completeHostedJiraConnect, ingestTestEvent } from './hosted.ts'

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
}

export async function afterSignIn(): Promise<void> {
  await restartCloudRelay()
}
