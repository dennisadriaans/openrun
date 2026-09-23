import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  cliBaseline,
  cliCommits,
  cliTag,
  cliVersionFromTag,
  cliWorkspaces,
  npmDistTag,
  planCliRelease,
  readCliReleaseConfig,
  renderCliNotes,
  uncoveredWorkspaces,
  validateCliVersion,
} from './cli.ts'
import { extractRelease } from './notes.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const config = readCliReleaseConfig({
  release: {
    package: '@scope/openrun',
    tagPrefix: 'cli-v',
    paths: ['apps/cli', 'packages/domain', 'npm'],
  },
})

const commit = (subject: string, sha = subject) => ({ sha, subject })

test('the release config is validated and cannot share the app tag namespace', () => {
  assert.throws(() => readCliReleaseConfig({}), /release/)
  assert.throws(
    () => readCliReleaseConfig({ release: { package: 'x', tagPrefix: 'v', paths: ['apps/cli'] } }),
    /tagPrefix/,
  )
  assert.deepEqual(cliWorkspaces(config), ['apps/cli', 'packages/domain'])
})

test('CLI tags round-trip and ignore app tags', () => {
  assert.equal(cliTag(config, '0.4.0'), 'cli-v0.4.0')
  assert.equal(cliTag(config, 'v0.4.0'), 'cli-v0.4.0')
  assert.equal(cliVersionFromTag(config, 'cli-v1.2.3-beta.1'), '1.2.3-beta.1')
  assert.equal(cliVersionFromTag(config, 'v1.2.3'), null)
  assert.equal(cliVersionFromTag(config, 'cli-vnext'), null)
})

test('the baseline is the newest CLI tag, else the app tag the CLI last shipped from', () => {
  assert.deepEqual(
    cliBaseline({
      config,
      tags: ['v0.4.0', 'cli-v0.4.1', 'cli-v0.10.0', 'cli-v0.9.0'],
      manifestVersion: '0.4.1',
    }),
    { tag: 'cli-v0.10.0', version: '0.10.0', legacy: false },
  )
  assert.deepEqual(
    cliBaseline({ config, tags: ['v0.2.1', 'v0.3.0', 'v0.4.0'], manifestVersion: '0.3.0' }),
    { tag: 'v0.3.0', version: '0.3.0', legacy: true },
  )
  assert.deepEqual(cliBaseline({ config, tags: [], manifestVersion: '0.1.0' }), {
    tag: null,
    version: '0.1.0',
    legacy: false,
  })
})

test('release commits of either track never count toward a CLI release', () => {
  const kept = cliCommits([
    commit('chore(release): v0.4.0'),
    commit('chore(release): cli-v0.4.0'),
    commit('feat(cli): add home'),
    commit('chore(deps): bump esbuild'),
  ])
  assert.deepEqual(
    kept.map((c) => c.subject),
    ['feat(cli): add home', 'chore(deps): bump esbuild'],
  )
})

test('a legacy baseline is bumped, not republished', () => {
  const baseline = { tag: 'v0.3.0', version: '0.3.0', legacy: true }
  const plan = planCliRelease({
    config,
    baseline,
    commits: [commit('feat(cli): add home (#141)'), commit('chore(release): v0.4.0')],
  })
  assert.equal(plan.next, '0.4.0')
  assert.equal(plan.tag, 'cli-v0.4.0')
  assert.equal(plan.total, 1)
  assert.match(plan.reason, /cli-v0\.3\.0 → cli-v0\.4\.0/)
})

test('nothing CLI-facing means no CLI release', () => {
  const plan = planCliRelease({
    config,
    baseline: { tag: 'cli-v0.4.0', version: '0.4.0', legacy: false },
    commits: [commit('docs: tidy'), commit('chore(release): v0.5.0')],
  })
  assert.equal(plan.releasable, false)
  assert.equal(plan.tag, null)
  assert.match(plan.reason, /since cli-v0\.4\.0/)
})

test('a first CLI release publishes the manifest version as-is', () => {
  const plan = planCliRelease({
    config,
    baseline: { tag: null, version: '0.1.0', legacy: false },
    commits: [commit('feat: start')],
  })
  assert.equal(plan.tag, 'cli-v0.1.0')
})

test('operator versions must move forward', () => {
  const shipped = { tag: 'cli-v0.4.0', version: '0.4.0', legacy: false }
  assert.equal(validateCliVersion('0.4.1', shipped), null)
  assert.match(validateCliVersion('0.4.0', shipped) ?? '', /not newer/)
  assert.match(validateCliVersion('0.3.9', shipped) ?? '', /not newer/)
  assert.match(validateCliVersion('v0.5.0', shipped) ?? '', /SemVer/)
  assert.equal(validateCliVersion('0.1.0', { tag: null, version: '0.1.0', legacy: false }), null)
})

test('prereleases never take the latest dist-tag', () => {
  assert.equal(npmDistTag('0.5.0'), 'latest')
  assert.equal(npmDistTag('0.5.0-beta.1'), 'next')
})

test('notes carry the summary, compare the CLI tags, and read back for publish', () => {
  const baseline = { tag: 'cli-v0.4.0', version: '0.4.0', legacy: false }
  const plan = planCliRelease({ config, baseline, commits: [commit('fix(cli): quote paths (#9)')] })
  const notes = renderCliNotes({
    config,
    plan,
    version: '0.4.1',
    baseline,
    summary: '- You no longer lose quoted paths.',
    repoUrl: 'https://github.com/o/r',
    date: '2026-09-23',
  })
  assert.match(notes, /^## v0\.4\.1 — 2026-09-23\n\n- You no longer lose quoted paths\.\n/)
  assert.match(notes, /compare\/cli-v0\.4\.0\.\.\.cli-v0\.4\.1/)
  assert.match(extractRelease(notes, '0.4.1') ?? '', /quote paths/)
})

test('every workspace the CLI bundles is a release path', () => {
  const manifests = new Map<string, { dir: string; deps: string[] }>()
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(join(ROOT, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = `${group}/${entry.name}`
      let pkg: { name?: string; dependencies?: Record<string, string> }
      try {
        pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'))
      } catch {
        continue
      }
      if (pkg.name) manifests.set(pkg.name, { dir, deps: Object.keys(pkg.dependencies ?? {}) })
    }
  }

  const bundled = new Set<string>()
  const visit = (name: string) => {
    const pkg = manifests.get(name)
    if (!pkg || bundled.has(pkg.dir)) return
    bundled.add(pkg.dir)
    for (const dep of pkg.deps) visit(dep)
  }
  visit('@openrun/cli')

  const real = readCliReleaseConfig(
    JSON.parse(readFileSync(join(ROOT, 'apps/cli/package.json'), 'utf8')),
  )
  assert.ok(bundled.size > 1)
  assert.deepEqual(uncoveredWorkspaces(real, [...bundled]), [])
})
