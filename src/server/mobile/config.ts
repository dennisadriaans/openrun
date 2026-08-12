/**
 * Whether the mobile surface is switched on.
 *
 * Off by default and read from one place, because turning it on does two
 * things at once: it exposes `/api/mobile/**` and it makes the dev server bind
 * beyond loopback (see the guard in `vite.config.ts`, which reads the same env
 * var directly — it cannot import this module, since Vite config is evaluated
 * outside the app graph).
 *
 * Upgrading Open Run must never expose anything on its own. That is why this
 * is opt-in rather than "on when a device is paired".
 */

export const MOBILE_ENV_VAR = 'AGENTOPS_MOBILE'

/** Extra hostnames the dev server should accept, e.g. a tunnel host. */
export const MOBILE_HOSTS_ENV_VAR = 'AGENTOPS_MOBILE_HOSTS'

export function mobileEnabled(): boolean {
  return process.env[MOBILE_ENV_VAR] === '1'
}

/** Command that turns the feature on, shown verbatim on the Devices page. */
export const MOBILE_ENABLE_HINT = 'AGENTOPS_MOBILE=1 pnpm dev'
