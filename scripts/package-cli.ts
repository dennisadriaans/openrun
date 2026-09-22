/** Build the npm CLI package from the same source and version as the web app. */
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const name = '@dennisadriaans/openrun'

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string
  description: string
  homepage: string
  repository: { type: string; url: string }
  bugs: { url: string }
  license: string
  engines: { node: string }
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}
const versions = { ...manifest.dependencies, ...manifest.devDependencies }
for (const workspace of [
  'apps/cli',
  'apps/worker',
  'packages/runtime',
  'packages/domain',
  'packages/contracts',
]) {
  const pkg = JSON.parse(readFileSync(join(root, workspace, 'package.json'), 'utf8'))
  Object.assign(versions, pkg.dependencies, pkg.devDependencies)
}
const require = createRequire(import.meta.url)
const output = join(root, 'dist', 'npm')
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })

const result = await build({
  absWorkingDir: root,
  entryPoints: {
    // The installed launcher finds its worker and MCP helper beside this binary.
    'bin/openrun': 'apps/cli/src/index.ts',
    'bin/worker': 'apps/worker/src/index.ts',
    'bin/mcp-server': 'apps/worker/src/mcp.ts',
  },
  outdir: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  plugins: [
    {
      name: 'bundle-workspace-packages',
      setup(builder) {
        builder.onResolve({ filter: /^@openrun\// }, (args) => ({
          path: require.resolve(args.path),
        }))
      },
    },
  ],
  sourcemap: true,
  metafile: true,
})

// Derive runtime dependencies from emitted imports. In particular, the ACP SDK
// is a development dependency of the app but required by the installed worker.
const dependencies: Record<string, string> = {}
for (const entry of Object.values(result.metafile.outputs)) {
  for (const imported of entry.imports) {
    if (!imported.external || imported.path.startsWith('node:')) continue
    const parts = imported.path.split('/')
    const dependency = parts.slice(0, imported.path.startsWith('@') ? 2 : 1).join('/')
    const version = versions[dependency]
    if (!version || version.startsWith('workspace:'))
      throw new Error(`Missing runtime dependency in package.json: ${dependency}`)
    dependencies[dependency] = version
  }
}

const bin = 'bin/openrun.js'
const executable = join(output, bin)
writeFileSync(
  executable,
  readFileSync(executable, 'utf8').replace(/^#![^\n]*/, '#!/usr/bin/env node'),
)
chmodSync(executable, 0o755)

writeFileSync(
  join(output, 'package.json'),
  `${JSON.stringify(
    {
      name,
      version: manifest.version,
      description: manifest.description,
      homepage: manifest.homepage,
      repository: manifest.repository,
      bugs: manifest.bugs,
      license: manifest.license,
      type: 'module',
      bin: { openrun: bin },
      engines: { node: manifest.engines.node },
      files: ['bin', 'LICENSE', 'NOTICE'],
      publishConfig: { access: 'public' },
      dependencies: Object.fromEntries(
        Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    null,
    2,
  )}\n`,
)

for (const file of ['LICENSE', 'NOTICE']) copyFileSync(join(root, file), join(output, file))
writeFileSync(
  join(output, 'README.md'),
  readFileSync(join(root, 'npm', 'README.md'), 'utf8').replaceAll('NPM_PACKAGE_NAME', name),
)
console.log(`Prepared ${name}@${manifest.version} in ${output}`)
console.log(`Create the tarball: npm pack ${output}`)
