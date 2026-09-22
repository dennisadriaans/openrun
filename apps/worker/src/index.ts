// Set before core loads. This process has no HTTP listener or web framework.
export {}
process.env.OPENRUN_PROCESS_KIND = 'worker'
try {
  await import('@openrun/runtime/core')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
