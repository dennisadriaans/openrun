/** cloud capability implementation. */
import { afterSignIn, completeCloudLogin } from '../cloud/index.ts'

export {
  afterSignIn,
  bootCloud,
  completeCloudLogin,
  completeHostedConnect,
  disconnectHostedIntegration,
  getCloudStatus,
  ingestTestEvent,
  listCloudProviders,
  listHostedConnections,
  signOutAndDisconnect,
  skipCloudOnboarding,
  startCloudLogin,
  startHostedConnect,
} from '../cloud/index.ts'

export type { CloudStatus } from '@openrun/domain/cloud/types'

export type { CloudProviderCatalog } from '@openrun/domain/cloud/providers'

/**
 * Finish a control-plane sign-in: exchange the code, then run the one-time
 * post-sign-in work before answering.
 *
 * `completeCloudLogin` alone leaves the account half-initialised — the server
 * function used to call `afterSignIn` itself. A transport must not have to
 * know that, so the two-step is one export.
 */
export async function completeCloudLoginAndFinish(input: { code: string; state: string }) {
  const session = await completeCloudLogin(input)
  await afterSignIn()
  return { email: session.email, userId: session.userId, next: session.next }
}
