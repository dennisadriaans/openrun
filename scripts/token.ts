/**
 * Print (creating on first use) the Open Run access token.
 *
 * Run with `pnpm token:print`. Needed only when binding a non-loopback interface —
 * a default install is protected by the operating system and has no token at
 * all. See SECURITY.md.
 */
import {
  ACCESS_TOKEN_HEADER,
  ACCESS_TOKEN_QUERY_PARAM,
  DEFAULT_HOST,
} from '../src/lib/serverAccess.ts'
import { openrunEnv } from '../src/lib/openrunEnv.ts'
import { accessTokenPath, ensureAccessToken } from '../src/server/accessToken.ts'

const token = ensureAccessToken()
const host = openrunEnv('HOST') || DEFAULT_HOST
const port = Number(process.env.PORT || 3000)

console.log(token)
console.error(`\nStored in ${accessTokenPath()} (mode 0600).`)
console.error(`\nSign a browser in once — the cookie it sets covers every later request:`)
console.error(`  http://${host}:${port}/?${ACCESS_TOKEN_QUERY_PARAM}=${token}`)
console.error(`\nScripts and curl send it as the \`${ACCESS_TOKEN_HEADER}\` header instead.`)
console.error(`Set OPENRUN_ACCESS_TOKEN to pin a value of your own.`)
