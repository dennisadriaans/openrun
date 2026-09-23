/** Verify the published layout with the same behavioral suite as source checkouts. */
import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const scratch = mkdtempSync(join(tmpdir(), 'openrun-package-'))
const install = join(scratch, 'install')
mkdirSync(install)
try {
  const { stdout } = await exec(
    'npm',
    ['pack', join(root, 'dist/npm'), '--json', '--pack-destination', scratch],
    { cwd: scratch },
  )
  const [{ filename }] = JSON.parse(stdout) as { filename: string }[]
  await exec(
    'npm',
    [
      'install',
      '--prefix',
      install,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(scratch, filename!),
    ],
    { cwd: scratch, maxBuffer: 4 * 1024 * 1024 },
  )
  const installed = join(install, 'node_modules/@dennisadriaans/openrun')
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  assert.ok(
    Object.keys(manifest.dependencies).every((name) => !name.startsWith('@openrun/')),
    'internal packages must be bundled',
  )
  assert.ok(!manifest.dependencies.react, 'the CLI must not install the web framework')
  const env = {
    ...process.env,
    OPENRUN_TEST_CLI_ENTRY: join(installed, 'bin/openrun.js'),
    OPENRUN_TEST_WORKER_ENTRY: join(installed, 'bin/worker.js'),
  }
  const result = await exec(
    process.execPath,
    ['--experimental-strip-types', '--test', 'apps/cli/src/runtime/local.test.ts'],
    { cwd: root, env, maxBuffer: 4 * 1024 * 1024 },
  )
  process.stdout.write(result.stdout)
  const mcp = spawnSync(process.execPath, [join(installed, 'bin/mcp-server.js')], {
    cwd: scratch,
    env: {
      ...process.env,
      OPENRUN_APP_DIR: installed,
      OPENRUN_HOME: join(scratch, 'mcp-state'),
      OPENRUN_CLOUD_URL: 'off',
    },
    input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`,
    encoding: 'utf8',
    timeout: 10_000,
  })
  assert.equal(mcp.status, 0, mcp.stderr)
  assert.ok(JSON.parse(mcp.stdout.trim()).result.tools.length > 0)
  console.log('Installed CLI, worker, scheduling, integrations and MCP helper passed.')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
