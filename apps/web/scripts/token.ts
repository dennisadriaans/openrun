/**
 * Print (creating on first use) the Open Run access token; see SECURITY.md.
 * Needed only when binding a non-loopback interface. Run with `pnpm token:print`.
 */
import {
  ACCESS_TOKEN_HEADER,
  ACCESS_TOKEN_QUERY_PARAM,
  DEFAULT_HOST,
} from '@openrun/domain/security/serverAccess'
import { openrunEnv } from '@openrun/domain/cloud/openrunEnv'
import { accessTokenPath, ensureAccessToken } from '@openrun/runtime/security/accessToken'

const token = ensureAccessToken()
const host = openrunEnv('HOST') || DEFAULT_HOST
const port = Number(process.env.PORT || 3000)

console.log(token)
console.error(`\nStored in ${accessTokenPath()} (mode 0600).`)
console.error(`\nSign a browser in once — the cookie it sets covers every later request:`)
console.error(`  http://${host}:${port}/?${ACCESS_TOKEN_QUERY_PARAM}=${token}`)
console.error(`\nScripts and curl send it as the \`${ACCESS_TOKEN_HEADER}\` header instead.`)
console.error(`Set OPENRUN_ACCESS_TOKEN to pin a value of your own.`)
