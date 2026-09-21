import { register } from 'node:module'

// Set before core loads. This process has no HTTP listener or web framework.
process.env.OPENRUN_PROCESS_KIND = 'worker'
register('./resolve-ts.mjs', import.meta.url)
try {
  await import('../src/server/core.ts')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
