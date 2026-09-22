/** Enforce the workspace dependency direction before code reaches a browser or worker. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

type Import = { specifier: string; typeOnly: boolean; dynamic: boolean }
type Manifest = {
  name: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, string>
}
type Node = { type?: string; [key: string]: unknown }

export function sourceImports(source: string): Import[] {
  const found: Import[] = []
  const tree = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    createImportExpressions: true,
  })
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const node = value as Node
    const declaration = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration']
    const dynamic = node.type === 'ImportExpression'
    const typeImport = node.type === 'TSImportType'
    if (declaration.includes(node.type ?? '') || dynamic || typeImport) {
      const literal = (typeImport ? node.argument : node.source) as { value?: unknown } | undefined
      if (typeof literal?.value === 'string') {
        const specifiers = node.specifiers as Node[] | undefined
        const typeOnly =
          typeImport ||
          node.importKind === 'type' ||
          node.exportKind === 'type' ||
          Boolean(specifiers?.length && specifiers.every((item) => item.importKind === 'type'))
        found.push({ specifier: literal.value, typeOnly, dynamic })
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'comments', 'leadingComments', 'trailingComments', 'tokens'].includes(key))
        continue
      if (Array.isArray(child)) child.forEach(visit)
      else if (child && typeof child === 'object') visit(child)
    }
  }
  visit(tree)
  return found
}

const normalize = (file: string) => file.split(sep).join('/')
const workspaceOf = (file: string) => /^(?:apps|packages)\/[^/]+/.exec(file)?.[0]
const dependencyName = (specifier: string) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!

export function boundaryRefusal(file: string, imported: Import): string | undefined {
  const workspace = workspaceOf(file)
  const { specifier, typeOnly, dynamic } = imported
  if (!workspace) return
  const isDomain = workspace === 'packages/domain'
  const isContract = workspace === 'packages/contracts'
  if ((isDomain || isContract) && specifier.startsWith('node:'))
    return 'portable packages cannot import Node APIs'
  if (specifier.startsWith('.')) {
    const target = normalize(join(dirname(file), specifier))
    if (workspaceOf(target) !== workspace)
      return 'use a declared package export across workspace boundaries'
  }
  if (!specifier.startsWith('@openrun/')) return
  const dependency = dependencyName(specifier)
  const allowed: Record<string, string[]> = {
    'packages/domain': ['@openrun/domain'],
    'packages/contracts': ['@openrun/contracts', '@openrun/domain'],
    'packages/runtime': ['@openrun/runtime', '@openrun/domain', '@openrun/contracts'],
    'apps/cli': ['@openrun/cli', '@openrun/domain', '@openrun/contracts', '@openrun/runtime'],
    'apps/worker': ['@openrun/worker', '@openrun/domain', '@openrun/contracts', '@openrun/runtime'],
    'apps/web': ['@openrun/web', '@openrun/domain', '@openrun/contracts', '@openrun/runtime'],
  }
  if (!allowed[workspace]?.includes(dependency))
    return `${workspace} cannot depend on ${dependency}`
  if (workspace === 'apps/web' && dependency === '@openrun/runtime' && !typeOnly) {
    const serverOnly =
      file.startsWith('apps/web/src/routes/api/') ||
      file.startsWith('apps/web/scripts/') ||
      ['apps/web/src/server.ts', 'apps/web/vite.config.ts'].includes(file)
    const lazyBoundary = ['apps/web/src/start.ts', 'apps/web/src/fns/index.ts'].includes(file)
    if (!serverOnly && !(lazyBoundary && dynamic))
      return 'web components reach the runtime through lazy server functions'
  }
}

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', '.tanstack', '.build', 'vendor'].includes(entry.name)) return []
    const full = join(dir, entry.name)
    return entry.isDirectory() ? filesIn(full) : /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

export function checkArchitecture(root: string): string[] {
  const manifests = new Map<string, Manifest>()
  for (const parent of ['apps', 'packages']) {
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      const workspace = `${parent}/${entry.name}`
      const manifest = join(root, workspace, 'package.json')
      if (entry.isDirectory() && existsSync(manifest))
        manifests.set(workspace, JSON.parse(readFileSync(manifest, 'utf8')))
    }
  }
  const problems: string[] = []
  const features = new Map<string, string[]>()
  for (const [workspace, manifest] of manifests) {
    for (const [name, target] of Object.entries(manifest.exports ?? {})) {
      if (!existsSync(join(root, workspace, target)) || target.includes('.test.'))
        problems.push(`${manifest.name}${name}: invalid public export ${target}`)
    }
    for (const absolute of filesIn(join(root, workspace))) {
      const file = normalize(relative(root, absolute))
      if (file.endsWith('.test.ts') || file.endsWith('routeTree.gen.ts')) continue
      const source = readFileSync(absolute, 'utf8')
      const feature = file.startsWith('packages/runtime/src/application/')
      const dependencies: string[] = []
      for (const imported of sourceImports(source)) {
        const refusal = boundaryRefusal(file, imported)
        if (refusal) problems.push(`${file}: ${imported.specifier} — ${refusal}`)
        const spec = imported.specifier
        if (!spec.startsWith('.') && !spec.startsWith('node:') && !spec.startsWith('#')) {
          const name = dependencyName(spec)
          if (
            name !== manifest.name &&
            !manifest.dependencies?.[name] &&
            !manifest.devDependencies?.[name]
          )
            problems.push(`${file}: undeclared dependency ${name}`)
        }
        if (feature && !imported.typeOnly && !imported.dynamic && spec.startsWith('.')) {
          const target = normalize(join(dirname(file), spec))
          if (target.startsWith('packages/runtime/src/application/')) dependencies.push(target)
        }
      }
      if (feature) features.set(file, dependencies)
    }
  }
  // Features may compose lower-level features, but must not form a new facade cycle.
  const done = new Set<string>()
  const visit = (file: string, trail: string[]) => {
    if (trail.includes(file)) {
      problems.push(`capability cycle: ${[...trail.slice(trail.indexOf(file)), file].join(' → ')}`)
      return
    }
    if (done.has(file)) return
    for (const target of features.get(file) ?? []) visit(target, [...trail, file])
    done.add(file)
  }
  for (const file of features.keys()) visit(file, [])
  return problems
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkArchitecture(resolve(import.meta.dirname, '..'))
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  } else console.log('Workspace dependencies, public exports and capability boundaries are valid.')
}
