/**
 * Vite wrapper so `pnpm dev -- --demo` (or OPENRUN_DEMO=1) can overlay
 * sample Runs and Automations without writing the real DB.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const demo = argv.includes('--demo')
const viteArgs = argv.filter((arg) => arg !== '--demo')
if (demo) process.env.OPENRUN_DEMO = '1'

const hasPort = viteArgs.some((arg) => arg === '--port' || arg.startsWith('--port='))
const args = ['dev', ...(hasPort ? [] : ['--port', '3000']), ...viteArgs]

if ((process.env.OPENRUN_DEMO ?? '').trim()) {
  console.info('[demo] overlaying sample Runs and Automations (nothing written to the DB)')
}

const viteJs = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/vite/bin/vite.js')
const child = spawn(process.execPath, [viteJs, ...args], {
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 1)
})
