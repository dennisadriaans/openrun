import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Only the terminal renderer needs FFI. The scheduler always stays on Node. */
export async function launchTerminalRuntime(entry: string, argv: string[]): Promise<boolean> {
  if (process.versions.bun) return false
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
  const nodeSupportsFfi = major > 26 || (major === 26 && minor >= 4)
  if (nodeSupportsFfi && process.execArgv.includes('--experimental-ffi')) return false
  const binary = nodeSupportsFfi ? process.execPath : 'bun'
  const args = nodeSupportsFfi ? [...process.execArgv, '--experimental-ffi'] : []
  const child = spawn(binary, [...args, fileURLToPath(entry), ...argv], {
    stdio: 'inherit',
    env: { ...process.env, OPENRUN_NODE_EXECUTABLE: process.execPath },
  })
  const interrupt = () => child.kill('SIGINT')
  const terminate = () => child.kill('SIGTERM')
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  try {
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', () =>
        reject(
          new Error(
            'The OpenTUI interface needs Bun 1.3+ (https://bun.sh) or Node.js 26.4+. Install one and run openrun again. Script commands with --yes or --json still use Node.js 22.12+.',
          ),
        ),
      )
      child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 1)))
    })
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
  }
  return true
}
