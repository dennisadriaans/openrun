/**
 * Everything the desktop Devices page needs in one call: whether the feature
 * is on, where a phone should point, and who is already paired.
 */
import { apnsConfigured } from './apns'
import { MOBILE_ENABLE_HINT, MOBILE_ENV_VAR, mobileEnabled } from './config'
import { activePairing, listDevices } from './devices'
import { lanBaseUrls } from './lan'
import { mobileScopeSummary, DEFAULT_MOBILE_SCOPE } from '../../lib/mobileScope'

/** Port the dev server listens on; matches the `--port` in package.json. */
function serverPort(): number {
  const fromEnv = Number(process.env.PORT ?? '')
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 3000
}

export function mobileStatus() {
  const enabled = mobileEnabled()
  const pairing = enabled ? activePairing() : null
  return {
    enabled,
    envVar: MOBILE_ENV_VAR,
    enableHint: MOBILE_ENABLE_HINT,
    /** Empty when the feature is off — we do not advertise reachable addresses. */
    baseUrls: enabled ? lanBaseUrls(serverPort()) : [],
    apnsConfigured: apnsConfigured(),
    devices: enabled ? listDevices() : [],
    /** Non-null while a code is still redeemable, so the modal can resume it. */
    pairingExpiresAt: pairing?.expiresAt ?? null,
    scope: mobileScopeSummary(DEFAULT_MOBILE_SCOPE),
  }
}
