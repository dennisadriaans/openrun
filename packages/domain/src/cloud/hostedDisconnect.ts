/**
 * How the laptop treats a control-plane DELETE of a hosted connection.
 *
 * A 200 still drops the local row when Atlassian refused to delete the hook
 * (`remoteRemoved: false`): delivery already stopped on the Worker, and keeping
 * the local row would trap the user on a connection they cannot use. The
 * warning is what the UI shows so they can tidy the leftover webhook by hand.
 */

export type HostedDisconnectBody = {
  error?: string
  remoteError?: string
  remoteRemoved?: boolean
}

export type HostedDisconnectDecision = {
  dropLocal: boolean
  error?: string
  warning?: string
}

export function hostedDisconnectDecision(
  status: number,
  body: HostedDisconnectBody,
): HostedDisconnectDecision {
  if (status === 404) return { dropLocal: true }
  if (status === 401) {
    return { dropLocal: false, error: 'Sign in to Open Run first, then disconnect again.' }
  }
  if (status >= 200 && status < 300) {
    if (body.remoteRemoved === false) {
      return {
        dropLocal: true,
        warning:
          body.remoteError ||
          'The webhook could not be removed at the vendor. Disconnect it there if events keep arriving.',
      }
    }
    return { dropLocal: true }
  }
  return {
    dropLocal: false,
    error: body.error || `The control plane refused to disconnect (${status}).`,
  }
}
