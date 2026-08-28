import { defineConfig, type Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { allowRemoteRequest } from './src/lib/loopback.ts'
import { lanAllowedHosts } from './src/server/mobile/lan.ts'

/**
 * Open Run assumes one local user on loopback: there is no authentication on
 * the server functions, and they include writing workspace files, adding a
 * project by absolute path, and starting a chat that spawns a CLI with the
 * user's own credentials. Binding beyond loopback without a guard would hand
 * all of that to anyone on the Wi-Fi.
 *
 * So the mobile feature is opt-in, and when it is on, only `/api/mobile/**` —
 * the one surface that checks a bearer token — answers a non-loopback caller.
 * Everything else gets 403. Loopback is never affected, so the desktop browser
 * behaves exactly as before either way.
 */
const MOBILE_ENABLED = process.env.AGENTOPS_MOBILE === '1'
const DEMO_FLAG = process.env.OPENRUN_DEMO ?? process.env.AGENTOPS_DEMO ?? ''

function remoteAccessGuard(): Plugin {
  return {
    name: 'agentops:remote-access-guard',
    configureServer(server) {
      // Registered before the SSR handler so nothing can answer ahead of it.
      // The decision itself lives in `lib/loopback.ts` and is unit-tested
      // there — this middleware only turns it into a response.
      server.middlewares.use((req, res, next) => {
        const allowed = allowRemoteRequest({
          address: req.socket.remoteAddress,
          url: req.url,
          mobileEnabled: MOBILE_ENABLED,
        })
        if (allowed) return next()

        res.statusCode = 403
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            error: MOBILE_ENABLED
              ? 'Only the mobile API is reachable from other devices.'
              : 'Open Run is not accepting connections from other devices.',
          }),
        )
      })
    },
  }
}

/** Boot unattended work in dev without waiting for the first browser request. */
function automationBootstrap(): Plugin {
  return {
    name: 'openrun:automation-bootstrap',
    configureServer(server) {
      if (DEMO_FLAG.trim()) return
      void server.ssrLoadModule('/src/server/core.ts').catch((error: unknown) => {
        server.config.logger.error(`[scheduler] development bootstrap failed: ${String(error)}`)
      })
    },
  }
}

const config = defineConfig({
  define: {
    'process.env.OPENRUN_DEMO': JSON.stringify(DEMO_FLAG),
    'process.env.AGENTOPS_DEMO': JSON.stringify(process.env.AGENTOPS_DEMO ?? ''),
  },
  resolve: { tsconfigPaths: true },
  server: MOBILE_ENABLED
    ? {
      host: '0.0.0.0',
      // Vite rejects unknown Host headers once it binds beyond loopback, and
      // that rejection looks exactly like "my phone cannot reach my Mac".
      // Never `true` — that would disable the check entirely.
      allowedHosts: lanAllowedHosts(process.env.AGENTOPS_MOBILE_HOSTS),
    }
    : undefined,
  plugins: [
    remoteAccessGuard(),
    automationBootstrap(),
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
