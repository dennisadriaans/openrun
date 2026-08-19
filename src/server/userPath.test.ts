import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { describe, it } from 'node:test'
import {
  commonUserBinDirs,
  ensureProcessPathAugmented,
  executableCandidates,
  findOnPath,
} from './userPath.ts'

describe('commonUserBinDirs', () => {
  it('prefers ~/.local/bin on unix when it exists', () => {
    const root = join(tmpdir(), `agentops-path-${process.pid}-${Date.now()}`)
    const localBin = join(root, '.local', 'bin')
    mkdirSync(localBin, { recursive: true })
    try {
      const dirs = commonUserBinDirs('darwin', root, {})
      assert.ok(dirs.includes(localBin))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('includes Windows native-installer and npm dirs when present', () => {
    const root = join(tmpdir(), `agentops-path-win-${process.pid}-${Date.now()}`)
    const localBin = join(root, '.local', 'bin')
    const npm = join(root, 'AppData', 'Roaming', 'npm')
    mkdirSync(localBin, { recursive: true })
    mkdirSync(npm, { recursive: true })
    try {
      const dirs = commonUserBinDirs('win32', root, {
        APPDATA: join(root, 'AppData', 'Roaming'),
        LOCALAPPDATA: join(root, 'AppData', 'Local'),
      })
      assert.ok(dirs.includes(localBin))
      assert.ok(dirs.includes(npm))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips directories that do not exist', () => {
    const root = join(tmpdir(), `agentops-path-missing-${process.pid}-${Date.now()}`)
    const dirs = commonUserBinDirs('linux', root, {})
    assert.deepEqual(
      dirs.filter((d) => d.startsWith(root)),
      [],
    )
  })
})

describe('executableCandidates', () => {
  it('returns the bare name on unix', () => {
    assert.deepEqual(executableCandidates('claude', 'darwin'), ['claude'])
  })

  it('expands PATHEXT on windows', () => {
    const names = executableCandidates('claude', 'win32', '.EXE;.CMD')
    assert.deepEqual(names, ['claude', 'claude.EXE', 'claude.CMD'])
  })

  it('keeps an explicit extension on windows', () => {
    assert.deepEqual(executableCandidates('claude.exe', 'win32', '.EXE'), ['claude.exe'])
  })
})

describe('findOnPath', () => {
  it('finds a binary in a PATH directory', () => {
    const root = join(tmpdir(), `agentops-find-${process.pid}-${Date.now()}`)
    const binDir = join(root, 'bin')
    mkdirSync(binDir, { recursive: true })
    const target = join(binDir, 'fakecli')
    writeFileSync(target, '#!/bin/sh\n')
    if (process.platform !== 'win32') chmodSync(target, 0o755)
    try {
      const found = findOnPath('fakecli', binDir, process.platform)
      assert.equal(found, target)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns empty when missing', () => {
    assert.equal(findOnPath('definitely-not-installed-xyz', '/tmp', 'darwin'), '')
  })
})

describe('ensureProcessPathAugmented', () => {
  it('prepends missing user bins without duplicating', () => {
    const root = join(tmpdir(), `agentops-aug-${process.pid}-${Date.now()}`)
    const localBin = join(root, '.local', 'bin')
    mkdirSync(localBin, { recursive: true })
    const platform = process.platform
    const delim = platform === 'win32' ? ';' : ':'
    const suffix = platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin:/bin'
    try {
      const env: NodeJS.ProcessEnv = { PATH: suffix }
      const once = ensureProcessPathAugmented(env, platform, root)
      assert.ok(once.startsWith(localBin))
      assert.ok(once.endsWith(suffix))

      const twice = ensureProcessPathAugmented(env, platform, root)
      assert.equal(twice, once)
      assert.equal(twice.split(delim).filter((p) => normalize(p) === normalize(localBin)).length, 1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
