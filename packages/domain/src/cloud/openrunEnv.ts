/**
 * Read an Open Run env var, falling back to the pre-rebrand `AGENTOPS_*` name.
 */
export function openrunEnv(suffix: string): string {
  return (process.env[`OPENRUN_${suffix}`] ?? process.env[`AGENTOPS_${suffix}`] ?? '').trim()
}
