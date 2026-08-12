/**
 * Print (creating on first use) the Open Run access token.
 *
 * Run with `pnpm token`. Needed only when binding a non-loopback interface —
 * a default install is protected by the operating system and has no token at
 * all. See SECURITY.md.
 */
import { accessTokenPath, ensureAccessToken } from '../src/server/accessToken.ts'

const token = ensureAccessToken()

console.log(token)
console.error(`\nStored in ${accessTokenPath()} (mode 0600).`)
console.error(`Send it as the \`x-agentops-token\` header, or set`)
console.error(`AGENTOPS_ACCESS_TOKEN to pin a value of your own.`)
